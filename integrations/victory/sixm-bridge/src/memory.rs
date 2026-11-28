//! Reads and writes of this process that fail instead of faulting, and the images mapped in it. Writes go
//! only where the user's profile says (see `profile`).

use std::ffi::c_void;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentProcess() -> *mut c_void;
    fn ReadProcessMemory(process: *mut c_void, base: *const c_void, buffer: *mut c_void, size: usize, read: *mut usize) -> i32;
    fn WriteProcessMemory(process: *mut c_void, base: *mut c_void, buffer: *const c_void, size: usize, written: *mut usize) -> i32;
    fn K32EnumProcessModules(process: *mut c_void, modules: *mut *mut c_void, bytes: u32, needed: *mut u32) -> i32;
    fn GetModuleFileNameW(module: *mut c_void, name: *mut u16, size: u32) -> u32;
    fn GetCurrentThread() -> *mut c_void;
    fn VirtualQuery(address: *const c_void, info: *mut MemoryInfo, size: usize) -> usize;
    fn SetThreadPriority(thread: *mut c_void, priority: i32) -> i32;
}

#[repr(C)]
#[derive(Default)]
struct MemoryInfo {
    base: usize,
    allocation_base: usize,
    allocation_protect: u32,
    partition: u16,
    region_size: usize,
    state: u32,
    protect: u32,
    kind: u32,
}

const MEM_COMMIT: u32 = 0x1000;
/// PAGE_READWRITE, PAGE_WRITECOPY, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY.
const WRITABLE: u32 = 0x04 | 0x08 | 0x40 | 0x80;
/// PAGE_NOACCESS, PAGE_GUARD.
const NO_READ: u32 = 0x01 | 0x100;

fn query(address: u64) -> Option<MemoryInfo> {
    let mut info = MemoryInfo::default();
    // SAFETY: VirtualQuery only fills `info`, of the size passed, for any address.
    let n = unsafe { VirtualQuery(address as *const c_void, &mut info, std::mem::size_of::<MemoryInfo>()) };
    (n != 0).then_some(info)
}

fn writable_page(i: &MemoryInfo) -> bool {
    i.state == MEM_COMMIT && i.protect & WRITABLE != 0 && i.protect & NO_READ == 0
}

/// Committed, readable and writable regions of this process, `(start, end)`, in order: where the title
/// keeps what changes. Code and read-only data are left out.
pub fn writable_regions() -> Vec<(u64, u64)> {
    let mut out: Vec<(u64, u64)> = Vec::new();
    let mut at = 0x10000u64;
    while at < 0x7fff_ffff_0000 {
        let Some(i) = query(at) else { break };
        let (start, size) = (i.base as u64, i.region_size as u64);
        if size == 0 {
            break;
        }
        if writable_page(&i) {
            match out.last_mut() {
                Some(last) if last.1 == start => last.1 = start + size,
                _ => out.push((start, start + size)),
            }
        }
        at = start + size;
    }
    out
}

/// This process's memory for a search.
pub struct Process;

impl crate::scan::Space for Process {
    fn regions(&self) -> Vec<(u64, u64)> {
        writable_regions()
    }
    fn read(&self, at: u64, buf: &mut [u8]) -> bool {
        read(at, buf)
    }
}

/// This thread below normal priority, so the title's threads always come first.
pub fn lower_priority() {
    const THREAD_PRIORITY_BELOW_NORMAL: i32 = -1;
    // SAFETY: the pseudo-handle of the calling thread, always valid for it.
    unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL) };
}

/// Fills `out` from `address`, or returns false if any byte is unreadable.
pub fn read(address: u64, out: &mut [u8]) -> bool {
    let mut got = 0;
    // SAFETY: the kernel checks the source range and reports an error; `out` is ours for its length.
    let ok = unsafe { ReadProcessMemory(GetCurrentProcess(), address as *const c_void, out.as_mut_ptr().cast(), out.len(), &mut got) };
    ok != 0 && got == out.len()
}

fn read_u32(address: u64) -> Option<u32> {
    let mut b = [0; 4];
    read(address, &mut b).then(|| u32::from_le_bytes(b))
}

/// Writes `data` at `address`, or returns false if any byte could not be written (the page is not
/// writable, or not mapped). Never changes a page's protection.
pub fn write(address: u64, data: &[u8]) -> bool {
    // WriteProcessMemory would make a read-only page writable for the call: we never do.
    let Some(end) = address.checked_add(data.len() as u64) else { return false };
    let mut at = address;
    while at < end {
        match query(at) {
            Some(i) if writable_page(&i) && i.region_size > 0 => at = i.base as u64 + i.region_size as u64,
            _ => return false,
        }
    }
    let mut done = 0;
    // SAFETY: the kernel checks the destination range and reports an error; `data` is ours for its length.
    let ok = unsafe { WriteProcessMemory(GetCurrentProcess(), address as *mut c_void, data.as_ptr().cast(), data.len(), &mut done) };
    ok != 0 && done == data.len()
}

/// The address a profile chain ends at, following its pointers.
pub fn resolve(base: u64, chain: &[u64]) -> Option<u64> {
    let (first, rest) = chain.split_first()?;
    let mut at = base.checked_add(*first)?;
    for offset in rest {
        let mut p = [0; 8];
        if !read(at, &mut p) {
            return None;
        }
        at = u64::from_le_bytes(p).checked_add(*offset)?;
    }
    (at != 0).then_some(at)
}

/// Follows a profile chain and reads `N` floats at its end.
pub fn floats<const N: usize>(base: u64, chain: &[u64]) -> Option<[f32; N]> {
    let at = resolve(base, chain)?;
    let mut out = [0.0; N];
    for (i, v) in out.iter_mut().enumerate() {
        let mut b = [0; 4];
        if !read(at.checked_add(4 * i as u64)?, &mut b) {
            return None;
        }
        *v = f32::from_le_bytes(b);
    }
    out.iter().all(|v| v.is_finite()).then_some(out)
}

pub struct Module {
    pub base: u64,
    /// SizeOfImage: the image is `base .. base + size`.
    pub size: u64,
    pub path: String,
    /// `TimeDateStamp-SizeOfImage` in lowercase hex, as symbol servers name a build.
    pub build: String,
}

pub fn modules() -> Vec<Module> {
    let mut handles = vec![std::ptr::null_mut::<c_void>(); 1024];
    let mut needed = 0u32;
    // SAFETY: the buffer is as long as the size passed with it.
    let ok = unsafe { K32EnumProcessModules(GetCurrentProcess(), handles.as_mut_ptr(), (handles.len() * 8) as u32, &mut needed) };
    if ok == 0 {
        return Vec::new();
    }
    handles.truncate(needed as usize / 8);
    handles.into_iter().filter_map(describe).collect()
}

fn describe(handle: *mut c_void) -> Option<Module> {
    let base = handle as u64;
    let mut name = [0u16; 1024];
    // SAFETY: the buffer is as long as the size passed; an unloaded handle makes the call fail.
    let len = unsafe { GetModuleFileNameW(handle, name.as_mut_ptr(), name.len() as u32) } as usize;
    let path = String::from_utf16_lossy(&name[..len]);
    let pe = base.checked_add(u64::from(read_u32(base + 0x3c)?))?;
    if read_u32(pe)? != 0x4550 {
        return None;
    }
    let size = read_u32(pe + 0x50)?;
    let build = format!("{:x}-{:x}", read_u32(pe + 8)?, size);
    Some(Module { base, size: u64::from(size), path, build })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chains_and_bad_addresses() {
        let data = [1.5f32, -2.0, 3.25, f32::NAN];
        let inner = [0u64, data.as_ptr() as u64];
        let outer = [inner.as_ptr() as u64];
        let base = outer.as_ptr() as u64;
        assert_eq!(floats::<3>(base, &[0, 8, 0]), Some([1.5, -2.0, 3.25]));
        assert_eq!(floats::<2>(data.as_ptr() as u64, &[4]), Some([-2.0, 3.25]));
        assert_eq!(floats::<4>(base, &[0, 8, 0]), None, "not a number");
        assert_eq!(floats::<1>(0, &[0x10]), None);
        assert_eq!(floats::<1>(base, &[0, 0, 0]), None, "null pointer");
        assert_eq!(floats::<1>(u64::MAX, &[8]), None, "overflow");
        assert_eq!(floats::<1>(base, &[]), None);
    }

    #[test]
    fn writes_where_it_can() {
        let mut data = [0f32; 3];
        let at = resolve(data.as_mut_ptr() as u64, &[4]).unwrap();
        assert!(write(at, &2.5f32.to_le_bytes()));
        assert_eq!(data, [0.0, 2.5, 0.0]);
        assert!(!write(8, &[1]), "unmapped");
        static READ_ONLY: [u8; 4] = [1, 2, 3, 4];
        assert!(!write(READ_ONLY.as_ptr() as u64, &[9]), "read-only page left alone");
        assert_eq!(READ_ONLY, [1, 2, 3, 4]);
        let regions = writable_regions();
        assert!(regions.iter().any(|&(a, b)| (a..b).contains(&(data.as_ptr() as u64))), "the stack is writable");
        assert!(!regions.iter().any(|&(a, b)| (a..b).contains(&(READ_ONLY.as_ptr() as u64))));
        assert_eq!(resolve(0, &[0]), None);
    }

    #[test]
    fn finds_this_program() {
        let exe = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
        let me = modules().into_iter().find(|m| m.path.to_lowercase() == exe).expect("own image");
        assert!(me.build.contains('-'));
        assert!(me.base != 0);
    }
}
