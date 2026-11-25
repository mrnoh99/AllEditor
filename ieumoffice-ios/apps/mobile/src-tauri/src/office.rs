//! AllEditor office suite inside the Tauri app.
//!
//! The Word / PowerPoint / Excel / PDF editors (plus Pages/Keynote/Numbers import, PDF tools and printing) are the
//! AllEditor web suite (`ios/App/App/public` in the repository, GenOffice renderers + in-page Electron runtime).
//! Xcode copies that folder into the app bundle as `office/`; this module serves it on the `office://` scheme and
//! answers the suite's native calls (`POST office://localhost/__ae/<plugin>/<method>`, JSON in / JSON out):
//!
//! * `AEFiles.readFile|writeFile|deleteFile|readdir` — app Documents (visible in Files.app) or private support dir;
//! * `AEPdf.render` and `AEPrint.printPdf|directPrint` — forwarded to the Swift side (`AllEditorOfficePlugin`);
//! * `AEShare.share` — iOS share sheet (send a document to Pages / Keynote / Numbers, …) via `IeumFilePlugin.shareFileBytes`.
//!
//! Each request runs on its own thread: the Swift calls are blocking and must never run on the main thread.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde_json::{Value, json};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "office";

/// Folder of the bundled web suite: `<App>.app/office` on iOS; `AE_OFFICE_DIR` or the repository copy otherwise.
fn office_root() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("AE_OFFICE_DIR") {
        return Some(PathBuf::from(dir));
    }
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?;
    for name in ["office", "public"] {
        let p = bundle.join(name);
        if p.join("index.html").is_file() {
            return Some(p);
        }
    }
    // desktop development: repository checkout
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../ios/App/App/public");
    repo.join("index.html").is_file().then_some(repo)
}

/// Documents (user files, visible in Files.app on iOS) and private support storage (settings, keys).
fn storage_root<R: Runtime>(app: &AppHandle<R>, dir: &str) -> PathBuf {
    let base = if cfg!(target_os = "ios") {
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        if dir == "support" { home.join("Library/Application Support/AllEditorOffice") } else { home.join("Documents") }
    } else {
        let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("alleditor"));
        data.join(if dir == "support" { "office-support" } else { "office-documents" })
    };
    let _ = fs::create_dir_all(&base);
    base
}

/// Joins a relative path below `base`, refusing absolute paths and `..`.
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = base.to_path_buf();
    for c in Path::new(rel.trim_start_matches('/')).components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return Err("Path escapes its folder".into()),
        }
    }
    Ok(out)
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn respond(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn json_response(result: Result<Value, String>) -> Response<Vec<u8>> {
    match result {
        Ok(v) => respond(StatusCode::OK, "application/json", serde_json::to_vec(&v).unwrap_or_default()),
        Err(e) => respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            "application/json",
            serde_json::to_vec(&json!({ "error": e })).unwrap_or_default(),
        ),
    }
}

fn serve_static(path: &str) -> Response<Vec<u8>> {
    let Some(root) = office_root() else {
        return respond(StatusCode::NOT_FOUND, "text/plain", b"office suite not bundled".to_vec());
    };
    let decoded = percent_decode(path);
    let rel = if decoded.is_empty() || decoded.ends_with('/') { format!("{decoded}index.html") } else { decoded };
    match safe_join(&root, &rel).and_then(|p| fs::read(&p).map(|b| (p, b)).map_err(|e| e.to_string())) {
        Ok((p, bytes)) => respond(StatusCode::OK, mime_for(&p), bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", format!("not found: {rel}").into_bytes()),
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn files_call<R: Runtime>(app: &AppHandle<R>, method: &str, args: &Value) -> Result<Value, String> {
    let dir = args.get("dir").and_then(Value::as_str).unwrap_or("documents");
    let base = storage_root(app, dir);
    let path = safe_join(&base, args.get("path").and_then(Value::as_str).unwrap_or(""))?;
    match method {
        "readFile" => {
            let bytes = fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
            Ok(json!({ "data": B64.encode(bytes) }))
        }
        "writeFile" => {
            let data = args.get("data").and_then(Value::as_str).ok_or("Invalid data")?;
            let bytes = B64.decode(data).map_err(|_| "Invalid data".to_string())?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let tmp = path.with_extension(format!(
                "{}.ae-tmp",
                path.extension().and_then(|e| e.to_str()).unwrap_or("")
            ));
            fs::write(&tmp, &bytes).map_err(|e| format!("Cannot write file: {e}"))?;
            fs::rename(&tmp, &path).map_err(|e| format!("Cannot write file: {e}"))?;
            Ok(json!({}))
        }
        "deleteFile" => {
            if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) }
                .map_err(|e| format!("Cannot delete file: {e}"))?;
            Ok(json!({}))
        }
        "readdir" => {
            let mut files = Vec::new();
            if let Ok(rd) = fs::read_dir(&path) {
                for entry in rd.flatten() {
                    let meta = entry.metadata().ok();
                    let mtime = meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.ends_with(".ae-tmp") {
                        continue;
                    }
                    files.push(json!({
                        "name": name,
                        "type": if meta.as_ref().is_some_and(|m| m.is_dir()) { "directory" } else { "file" },
                        "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                        "mtime": mtime,
                    }));
                }
            }
            Ok(json!({ "files": files }))
        }
        _ => Err(format!("unknown AEFiles method {method}")),
    }
}

fn native_call<R: Runtime>(app: &AppHandle<R>, plugin: &str, method: &str, args: Value) -> Result<Value, String> {
    match plugin {
        "AEFiles" => files_call(app, method, &args),
        "AEPdf" | "AEPrint" => {
            let swift_method = match (plugin, method) {
                ("AEPdf", "render") => "renderPdf",
                ("AEPrint", "printPdf") => "printPdf",
                ("AEPrint", "directPrint") => "directPrint",
                _ => return Err(format!("unknown method {plugin}.{method}")),
            };
            tauri_plugin_ieum_mobile::office_native_call(app, swift_method, args)
        }
        "AEShare" if method == "share" => {
            let name = args.get("name").and_then(Value::as_str).unwrap_or("document");
            let mime = args.get("mime").and_then(Value::as_str).unwrap_or("application/octet-stream");
            let data = args.get("data").and_then(Value::as_str).ok_or("data missing")?;
            tauri_plugin_ieum_mobile::share_file_base64(app, name, mime, data)?;
            Ok(json!({}))
        }
        "AEApp" if method == "ping" => Ok(json!({ "native": "tauri", "platform": std::env::consts::OS })),
        _ => Err(format!("unknown plugin {plugin}")),
    }
}

fn handle<R: Runtime>(app: &AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = req.uri().path().trim_start_matches('/').to_string();
    if let Some(rest) = path.strip_prefix("__ae/") {
        if req.method() == tauri::http::Method::OPTIONS {
            return Response::builder()
                .status(StatusCode::NO_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS")
                .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "content-type")
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
        let mut parts = rest.splitn(2, '/');
        let plugin = parts.next().unwrap_or("");
        let method = parts.next().unwrap_or("");
        let args: Value = if req.body().is_empty() {
            json!({})
        } else {
            match serde_json::from_slice(req.body()) {
                Ok(v) => v,
                Err(e) => return json_response(Err(format!("bad JSON: {e}"))),
            }
        };
        return json_response(native_call(app, plugin, method, args));
    }
    serve_static(&path)
}

/// Asynchronous `office://` handler (register with `register_asynchronous_uri_scheme_protocol`).
pub fn protocol<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || responder.respond(handle(&app, req)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_refuses_escape() {
        let base = Path::new("/base");
        assert_eq!(safe_join(base, "a/b.docx").unwrap(), PathBuf::from("/base/a/b.docx"));
        assert_eq!(safe_join(base, "/a").unwrap(), PathBuf::from("/base/a"));
        assert!(safe_join(base, "../x").is_err());
        assert!(safe_join(base, "a/../../x").is_err());
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("docs/%ED%95%9C.docx"), "docs/한.docx");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("100%"), "100%");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// "Open in AllEditor" from other apps. iOS delivers file URLs as RunEvent::Opened.
//  * hwp / hwpx / md / txt → the 이음오피스 editor: queued natively, then `ae-open-intent` tells the page to
//    call `mobile_consume_pending_open_intent`;
//  * office files → read natively, kept here until the page takes them (`ae_take_office_intents`), announced
//    with `ae-office-intent`; the office suite imports them into Documents (iWork → editable copy) and opens them.

const IEUM_EXTS: &[&str] = &["hwp", "hwpx", "md", "markdown", "txt"];
const OFFICE_EXTS: &[&str] = &[
    "docx", "dotx", "doc", "dot", "odt", "ott", "pptx", "potx", "ppt", "odp", "otp", "xlsx", "xlsm", "xls", "ods",
    "ots", "csv", "tsv", "pdf", "pages", "key", "numbers",
];

#[derive(Clone, serde::Serialize)]
pub struct OfficeIntent {
    pub name: String,
    pub data: String,
}

#[derive(Default)]
pub struct OfficeIntents(std::sync::Mutex<Vec<OfficeIntent>>);

/// which editor takes a file name: "ieum", "office" or None
pub fn route_for(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
    if IEUM_EXTS.contains(&ext.as_str()) {
        Some("ieum")
    } else if OFFICE_EXTS.contains(&ext.as_str()) {
        Some("office")
    } else {
        None
    }
}

/// Handles URLs from RunEvent::Opened (off the main thread: the native calls block).
pub fn handle_opened<R: Runtime>(app: &AppHandle<R>, urls: Vec<url::Url>) {
    use tauri::Emitter;
    for url in urls {
        let app = app.clone();
        std::thread::spawn(move || {
            let name = url
                .path_segments()
                .and_then(|mut s| s.next_back().map(|n| percent_decode(n)))
                .unwrap_or_default();
            match route_for(&name) {
                Some("ieum") => match tauri_plugin_ieum_mobile::enqueue_open_url(&app, url.as_str()) {
                    Ok(()) => {
                        let _ = app.emit("ae-open-intent", ());
                    }
                    Err(e) => eprintln!("[open-in] {name}: {e}"),
                },
                Some(_) => {
                    match tauri_plugin_ieum_mobile::office_native_call(
                        &app,
                        "readIncomingUrl",
                        json!({ "url": url.as_str() }),
                    ) {
                        Ok(v) => {
                            let intent = OfficeIntent {
                                name: v.get("name").and_then(Value::as_str).unwrap_or(&name).to_string(),
                                data: v.get("data").and_then(Value::as_str).unwrap_or("").to_string(),
                            };
                            if let Some(q) = app.try_state::<OfficeIntents>() {
                                q.0.lock().map(|mut g| g.push(intent)).ok();
                            }
                            let _ = app.emit("ae-office-intent", ());
                        }
                        Err(e) => eprintln!("[open-in] {name}: {e}"),
                    }
                }
                None => eprintln!("[open-in] unsupported file: {name}"),
            }
        });
    }
}

/// Office files handed to the app since the last call (the page imports them into the office suite).
#[tauri::command]
pub fn ae_take_office_intents(state: tauri::State<'_, OfficeIntents>) -> Vec<OfficeIntent> {
    state.0.lock().map(|mut g| std::mem::take(&mut *g)).unwrap_or_default()
}

#[cfg(test)]
mod open_in_tests {
    use super::route_for;

    #[test]
    fn routes() {
        assert_eq!(route_for("보고서.HWP"), Some("ieum"));
        assert_eq!(route_for("a.hwpx"), Some("ieum"));
        assert_eq!(route_for("a.md"), Some("ieum"));
        assert_eq!(route_for("a.docx"), Some("office"));
        assert_eq!(route_for("a.key"), Some("office"));
        assert_eq!(route_for("a.numbers"), Some("office"));
        assert_eq!(route_for("a.pdf"), Some("office"));
        assert_eq!(route_for("a.zip"), None);
        assert_eq!(route_for("noext"), None);
    }
}
