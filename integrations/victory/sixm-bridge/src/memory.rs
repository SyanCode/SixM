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
    fn SetThreadPriority(thread: *mut c_void, priority: i32) -> i32;
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
    let build = format!("{:x}-{:x}", read_u32(pe + 8)?, read_u32(pe + 0x50)?);
    Some(Module { base, path, build })
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
