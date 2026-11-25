//! Library-style (reactor) wasm32-wasip1 wrapper around the upstream xlsx sidecar engine:
//! the host calls `engine_request` with one JSON request line and gets one JSON response
//! line back, instead of piping stdin/stdout (a browser cannot block on stdin).
use std::cell::RefCell;
use xlsx_sidecar::protocol::Engine;

thread_local! { static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) }; }

#[unsafe(no_mangle)]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasm_free(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) }
}

/// Returns (ptr << 32 | len) of the response line (0 when the request yields no response).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_request(ptr: *const u8, len: usize) -> u64 {
    let line = unsafe { std::slice::from_raw_parts(ptr, len) };
    let line = String::from_utf8_lossy(line).into_owned();
    let out = ENGINE.with(|e| {
        let mut e = e.borrow_mut();
        let engine = e.get_or_insert_with(Engine::new);
        engine.handle_line(&line)
    });
    match out {
        None => 0,
        Some(s) => {
            let mut b = s.into_bytes().into_boxed_slice();
            let (p, l) = (b.as_mut_ptr() as u64, b.len() as u64);
            std::mem::forget(b);
            (p << 32) | l
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(ptr: *mut u8, len: usize) {
    unsafe { drop(Box::from_raw(std::slice::from_raw_parts_mut(ptr, len))) }
}
