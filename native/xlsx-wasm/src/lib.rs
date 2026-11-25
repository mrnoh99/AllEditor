//! Library-style (reactor) wasm32-wasip1 wrapper around the 이음오피스 xlsx sidecar engine
//! (apps/sheets/native/xlsx-engine): the host calls `engine_request` with one JSON request line and gets the
//! response line(s) back, instead of piping stdin/stdout (a browser cannot block on stdin).
//!
//! The request handling lives in the engine's `main.rs`; scripts/build-web.mjs copies it here as
//! `sidecar_main.rs` with four mechanical edits (see `patchSidecarMain`): output goes to an in-memory buffer,
//! the recalc worker runs inline (wasip1 has no threads), `main` is unused, `handle_line` is callable.
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

#[allow(dead_code, unused_imports, clippy::all)]
#[path = "sidecar_main.rs"]
mod sidecar;

struct State {
    sessions: xlsx_sidecar::WorkbookSessions,
    recalc: sidecar::RecalcWorker,
    cancelled: sidecar::CancelledRequests,
    in_flight: sidecar::InFlightRequest,
    output: sidecar::SharedOutput,
}

thread_local! { static STATE: RefCell<Option<State>> = const { RefCell::new(None) }; }

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

/// Returns (ptr << 32 | len) of the response line(s) (0 when the request yields no response).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_request(ptr: *const u8, len: usize) -> u64 {
    let line = unsafe { std::slice::from_raw_parts(ptr, len) };
    let line = String::from_utf8_lossy(line).into_owned();
    let out = STATE.with(|s| {
        let mut s = s.borrow_mut();
        let st = s.get_or_insert_with(|| State {
            sessions: xlsx_sidecar::WorkbookSessions::new(),
            recalc: sidecar::RecalcWorker::new(),
            cancelled: sidecar::CancelledRequests::new(),
            in_flight: sidecar::InFlightRequest::new(),
            output: Arc::new(Mutex::new(Vec::new())),
        });
        if let Some(resp) =
            sidecar::handle_line(&line, &mut st.sessions, &st.recalc, &st.cancelled, &st.in_flight, &st.output)
        {
            let _ = sidecar::write_response(&st.output, &resp);
        }
        let mut buf = st.output.lock().unwrap_or_else(|p| p.into_inner());
        let text = String::from_utf8_lossy(&buf).trim_end().to_owned();
        buf.clear();
        text
    });
    if out.is_empty() {
        return 0;
    }
    let mut b = out.into_bytes().into_boxed_slice();
    let (p, l) = (b.as_mut_ptr() as u64, b.len() as u64);
    std::mem::forget(b);
    (p << 32) | l
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(ptr: *mut u8, len: usize) {
    unsafe { drop(Box::from_raw(std::slice::from_raw_parts_mut(ptr, len))) }
}
