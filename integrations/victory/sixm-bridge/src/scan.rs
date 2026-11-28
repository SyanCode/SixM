//! A memory search in the manner of Cheat Engine, over the title's writable memory: a first search for a
//! value or a range, then searches among its results (equal to, between, changed, unchanged, increased,
//! decreased), and the paths of pointers that lead to an address from the title's image, so that a find
//! still holds at the next start. Only reads; writing goes through the module's orders.
//!
//! Platform-free: the memory is a [`Space`], the process's own on Windows, a buffer in the tests.

use crate::profile::Kind;

/// Readable memory: its writable regions and checked reads.
pub trait Space {
    /// `(start, end)` of each region to search, in increasing order.
    fn regions(&self) -> Vec<(u64, u64)>;
    /// Fills `buf` from `at`, or false.
    fn read(&self, at: u64, buf: &mut [u8]) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Test {
    Exact(f64),
    Between(f64, f64),
    Changed,
    Unchanged,
    Increased,
    Decreased,
}

impl Test {
    pub fn parse(name: &str, a: Option<f64>, b: Option<f64>) -> Option<Test> {
        match name {
            "exact" => Some(Test::Exact(a?)),
            "between" => {
                let (a, b) = (a?, b?);
                Some(Test::Between(a.min(b), a.max(b)))
            }
            "changed" => Some(Test::Changed),
            "unchanged" => Some(Test::Unchanged),
            "increased" => Some(Test::Increased),
            "decreased" => Some(Test::Decreased),
            _ => None,
        }
    }

    /// A first search needs a value to look for.
    pub fn first(self) -> bool {
        matches!(self, Test::Exact(_) | Test::Between(..))
    }
}

const CHUNK: usize = 1 << 20;
/// Results kept at most: 16 bytes each.
pub const MAX_HITS: usize = 2_000_000;

/// The results of a search: addresses and the bytes they had.
pub struct Scan {
    pub kind: Kind,
    hits: Vec<(u64, [u8; 4])>,
}

fn matches(kind: Kind, test: Test, old: &[u8; 4], new: &[u8]) -> bool {
    let v = kind.decode(new);
    if !v.is_finite() {
        return false;
    }
    let same_bytes = old[..kind.size()] == new[..kind.size()];
    let o = kind.decode(old);
    match test {
        // A float is "equal" rounded, as Cheat Engine does: 12.6 is found by 13.
        Test::Exact(x) if kind == Kind::F32 => (v - x).abs() < 0.5,
        Test::Exact(x) => v == x,
        Test::Between(a, b) => (a..=b).contains(&v),
        Test::Changed => !same_bytes,
        Test::Unchanged => same_bytes,
        Test::Increased => v > o,
        Test::Decreased => v < o,
    }
}

impl Scan {
    /// Searches every region for `test` (a value or a range). `progress(done, total)` returns false to stop.
    pub fn first(space: &dyn Space, kind: Kind, test: Test, progress: &mut dyn FnMut(u64, u64) -> bool) -> Result<Scan, String> {
        if !test.first() {
            return Err("a first search looks for a value or a range".into());
        }
        let regions = space.regions();
        let total: u64 = regions.iter().map(|(a, b)| b - a).sum();
        let (size, step) = (kind.size(), kind.size() as u64);
        let mut hits = Vec::new();
        let mut done = 0u64;
        let mut buf = vec![0u8; CHUNK];
        let none = [0u8; 4];
        for (start, end) in regions {
            let mut at = start.next_multiple_of(step);
            while at + step <= end {
                let len = ((end - at) as usize).min(CHUNK) / size * size;
                if space.read(at, &mut buf[..len]) {
                    for (i, v) in buf[..len].chunks_exact(size).enumerate() {
                        if matches(kind, test, &none, v) {
                            if hits.len() == MAX_HITS {
                                return Err(format!("more than {MAX_HITS} results: look for a more precise value"));
                            }
                            let mut b = [0u8; 4];
                            b[..size].copy_from_slice(v);
                            hits.push((at + (i * size) as u64, b));
                        }
                    }
                }
                at += len as u64;
                done += len as u64;
                if !progress(done, total) {
                    return Err("stopped".into());
                }
            }
        }
        Ok(Scan { kind, hits })
    }

    /// Keeps the results that pass `test` now, and their new bytes.
    pub fn next(&mut self, space: &dyn Space, test: Test, progress: &mut dyn FnMut(u64, u64) -> bool) -> Result<(), String> {
        let size = self.kind.size();
        let total = self.hits.len() as u64;
        let mut b = [0u8; 4];
        let mut kept = 0;
        for i in 0..self.hits.len() {
            let (at, old) = self.hits[i];
            if space.read(at, &mut b[..size]) && matches(self.kind, test, &old, &b[..size]) {
                self.hits[kept] = (at, b);
                kept += 1;
            }
            if i % 65536 == 65535 && !progress(i as u64, total) {
                return Err("stopped".into());
            }
        }
        self.hits.truncate(kept);
        Ok(())
    }

    pub fn count(&self) -> usize {
        self.hits.len()
    }

    /// The first `n` results with their value now.
    pub fn sample(&self, space: &dyn Space, n: usize) -> Vec<(u64, f64)> {
        let size = self.kind.size();
        let mut b = [0u8; 4];
        self.hits
            .iter()
            .take(n)
            .map(|&(at, old)| (at, if space.read(at, &mut b[..size]) { self.kind.decode(&b) } else { self.kind.decode(&old) }))
            .collect()
    }
}

/// Paths from the title's image to `target`, as profile chains (`a, b, …`: `[[base + a] + b] + …`), one
/// or two pointers deep, each offset at most `max_offset`. `image`: the title's `(base, end)`.
pub fn pointer_paths(space: &dyn Space, image: (u64, u64), target: u64, max_offset: u64, limit: usize) -> Vec<Vec<u64>> {
    let (base, end) = image;
    let mut out = Vec::new();
    let qwords = |start: u64, stop: u64, f: &mut dyn FnMut(u64, u64) -> bool| {
        let mut buf = vec![0u8; CHUNK];
        let mut at = start.next_multiple_of(8);
        while at + 8 <= stop {
            let len = ((stop - at) as usize).min(CHUNK) / 8 * 8;
            if space.read(at, &mut buf[..len]) {
                for (i, q) in buf[..len].chunks_exact(8).enumerate() {
                    let q = u64::from_le_bytes(q.try_into().unwrap());
                    if !f(at + (i * 8) as u64, q) {
                        return;
                    }
                }
            }
            at += len as u64;
        }
    };
    let regions = space.regions();
    let in_image: Vec<(u64, u64)> = regions.iter().filter(|(a, b)| *a < end && *b > base).map(|&(a, b)| (a.max(base), b.min(end))).collect();
    // One pointer: in the image, a pointer a little before the target.
    for &(a, b) in &in_image {
        qwords(a, b, &mut |at, q| {
            if q <= target && target - q <= max_offset {
                out.push(vec![at - base, target - q]);
            }
            out.len() < limit
        });
    }
    // Two: blocks anywhere that point a little before the target, then the image pointing a little before those.
    let mut near: Vec<(u64, u64)> = Vec::new(); // (where, offset to the target)
    for &(a, b) in &regions {
        qwords(a, b, &mut |at, q| {
            if q <= target && target - q <= max_offset {
                near.push((at, target - q));
            }
            near.len() < 20_000
        });
    }
    near.sort_unstable();
    for &(a, b) in &in_image {
        if out.len() >= limit {
            break;
        }
        qwords(a, b, &mut |at, p| {
            let from = near.partition_point(|&(h, _)| h < p);
            for &(h, off2) in near[from..].iter().take_while(|&&(h, _)| h - p <= max_offset) {
                let chain = vec![at - base, h - p, off2];
                if !out.contains(&chain) {
                    out.push(chain);
                }
            }
            out.len() < limit
        });
    }
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Memory at address 0x10000 + index, in regions.
    struct Buf {
        bytes: Vec<u8>,
        regions: Vec<(u64, u64)>,
    }
    const AT: u64 = 0x10000;

    impl Space for std::cell::RefCell<Buf> {
        fn regions(&self) -> Vec<(u64, u64)> {
            self.borrow().regions.clone()
        }
        fn read(&self, at: u64, buf: &mut [u8]) -> bool {
            let b = self.borrow();
            let Some(i) = at.checked_sub(AT).map(|i| i as usize) else { return false };
            if i + buf.len() > b.bytes.len() {
                return false;
            }
            buf.copy_from_slice(&b.bytes[i..i + buf.len()]);
            true
        }
    }

    fn set(m: &std::cell::RefCell<Buf>, at: u64, v: &[u8]) {
        let i = (at - AT) as usize;
        m.borrow_mut().bytes[i..i + v.len()].copy_from_slice(v);
    }

    #[test]
    fn first_then_next_searches() {
        let m = std::cell::RefCell::new(Buf { bytes: vec![0; 0x3000], regions: vec![(AT, AT + 0x1000), (AT + 0x2000, AT + 0x3000)] });
        for at in [AT + 0x10, AT + 0x20, AT + 0x2040] {
            set(&m, at, &100.25f32.to_le_bytes());
        }
        set(&m, AT + 0x1800, &100f32.to_le_bytes()); // outside the regions
        let mut s = Scan::first(&m, Kind::F32, Test::Exact(100.0), &mut |_, _| true).unwrap();
        assert_eq!(s.count(), 3);
        set(&m, AT + 0x10, &150f32.to_le_bytes());
        set(&m, AT + 0x20, &50f32.to_le_bytes());
        let mut t = Scan::first(&m, Kind::F32, Test::Between(40.0, 200.0), &mut |_, _| true).unwrap();
        t.next(&m, Test::Changed, &mut |_, _| true).unwrap();
        assert_eq!(t.count(), 0, "nothing moved since");
        s.next(&m, Test::Increased, &mut |_, _| true).unwrap();
        assert_eq!(s.sample(&m, 10), [(AT + 0x10, 150.0)]);
        let mut u = Scan::first(&m, Kind::I32, Test::Exact(0.0), &mut |_, _| true);
        assert!(u.as_ref().is_ok_and(|u| u.count() > 900));
        u.as_mut().unwrap().next(&m, Test::Unchanged, &mut |_, _| true).unwrap();
        assert!(Scan::first(&m, Kind::U8, Test::Changed, &mut |_, _| true).is_err(), "a first search needs a value");
        assert!(Scan::first(&m, Kind::U8, Test::Exact(0.0), &mut |_, _| false).is_err(), "stopped");
    }

    #[test]
    fn finds_pointer_paths() {
        // The image at AT .. AT+0x1000, a heap block at AT+0x2000.
        let m = std::cell::RefCell::new(Buf { bytes: vec![0; 0x3000], regions: vec![(AT, AT + 0x1000), (AT + 0x2000, AT + 0x3000)] });
        let target = AT + 0x2190;
        set(&m, AT + 0x2100, &(AT + 0x2180).to_le_bytes()); // heap: a pointer 0x10 before the target
        set(&m, AT + 0x40, &(AT + 0x20f0).to_le_bytes()); // image: a pointer 0x10 before that one
        let paths = pointer_paths(&m, (AT, AT + 0x1000), target, 0x100, 8);
        assert!(paths.contains(&vec![0x40, 0x10, 0x10]), "{paths:x?}");
        set(&m, AT + 0x80, &(AT + 0x2188).to_le_bytes());
        let paths = pointer_paths(&m, (AT, AT + 0x1000), target, 0x100, 8);
        assert!(paths.contains(&vec![0x80, 8]) && paths.contains(&vec![0x40, 0xa0]), "{paths:x?}");
        assert!(pointer_paths(&m, (AT, AT + 0x1000), target, 0x100, 1).len() == 1, "limit");
    }
}
