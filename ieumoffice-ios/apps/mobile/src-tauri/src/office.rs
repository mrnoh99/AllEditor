//! AllEditor office suite inside the Tauri app.
//!
//! The Word / PowerPoint / Excel / PDF editors (plus Pages/Keynote/Numbers import, PDF tools and printing) are the
//! AllEditor web suite (`office/` in the repository: 이음오피스 renderers + in-page Electron runtime, built by
//! `scripts/build-web.mjs`).
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
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../office");
    repo.join("index.html").is_file().then_some(repo)
}

/// Documents (user files, visible in Files.app on iOS) and private support storage (settings, keys).
fn storage_root<R: Runtime>(app: &AppHandle<R>, dir: &str) -> PathBuf {
    let base = if cfg!(target_os = "ios") {
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        let support = home.join("Library/Application Support/AllEditorOffice");
        if dir == "support" {
            support
        } else {
            // iCloud Drive › AllEditor when the Swift side found the iCloud container (AllEditorICloud.swift)
            fs::read_to_string(support.join(".icloud-documents"))
                .ok()
                .map(|p| PathBuf::from(p.trim()))
                .filter(|p| p.is_dir())
                .unwrap_or_else(|| home.join("Documents"))
        }
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
        "rename" => {
            let to = safe_join(&base, args.get("to").and_then(Value::as_str).ok_or("to missing")?)?;
            if to.exists() {
                return Err("a file with that name already exists".into());
            }
            fs::rename(&path, &to).map_err(|e| format!("Cannot rename: {e}"))?;
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
        // 파일 열기: the system picker opening at the AllEditor folder (AllEditorOfficePlugin.pickDocument)
        "AEPick" if method == "open" => tauri_plugin_ieum_mobile::office_native_call(app, "pickDocument", args),
        "AEShare" if method == "share" => {
            let name = args.get("name").and_then(Value::as_str).unwrap_or("document");
            let mime = args.get("mime").and_then(Value::as_str).unwrap_or("application/octet-stream");
            let data = args.get("data").and_then(Value::as_str).ok_or("data missing")?;
            tauri_plugin_ieum_mobile::share_file_base64(app, name, mime, data)?;
            Ok(json!({}))
        }
        "AEAi" => ai_call(app, method, &args),
        "AEApp" if method == "openUrl" => {
            let url = args.get("url").and_then(Value::as_str).ok_or("url missing")?;
            if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
                return Err("only http(s) and mailto links open outside the app".into());
            }
            tauri_plugin_ieum_mobile::office_native_call(app, "openUrl", json!({ "url": url }))
        }
        "AEApp" if method == "version" => Ok(app_version(app)),
        "AEApp" if method == "ping" => Ok(json!({ "native": "tauri", "platform": std::env::consts::OS })),
        _ => Err(format!("unknown plugin {plugin}")),
    }
}

// ---- one AI setting for the whole app --------------------------------------------------------------------------
// The 이음오피스 AI store (keys sealed in the vault, `crate::ai::settings`) is the only place AI settings live. The
// office suite reads it through these calls: `get` (no keys) for its AI 연결 page, `set` to change it, and `export`
// (with keys) to build the office editors' in-memory `ai-settings.json` — the office editors call the AI providers
// from the WebView, so they need the key; it is never written to disk in plain text.

/// providers both sides support (the office suite's ids are the same)
const AI_KEY_PROVIDERS: &[&str] = &[
    "gemini", "openai", "anthropic", "openrouter", "deepseek", "xai", "mistral", "kimi", "glm", "qwen", "upstage", "exaone",
];

fn ai_call<R: Runtime>(app: &AppHandle<R>, method: &str, args: &Value) -> Result<Value, String> {
    use crate::ai::{MobileAiService, MobileAiSettingsPatch, ModelPatch, ProviderKeyPatch};
    let service = app.try_state::<std::sync::Arc<MobileAiService>>().ok_or("AI service not ready")?;
    let store = &service.settings;
    let chatgpt_visible = service.chatgpt.is_visible();
    let snapshot = |store: &crate::ai::MobileAiSettingsStore| store.get_snapshot(chatgpt_visible).map_err(|e| e.to_string());
    match method {
        "get" => serde_json::to_value(snapshot(store)?).map_err(|e| e.to_string()),
        "set" => {
            let provider = args.get("provider").and_then(Value::as_str).ok_or("provider missing")?.to_string();
            if !AI_KEY_PROVIDERS.contains(&provider.as_str()) {
                return Err(format!("{provider} is not available here"));
            }
            let api_key = args.get("apiKey").and_then(Value::as_str).map(|k| k.trim().to_string());
            let model = args.get("model").and_then(Value::as_str).map(str::trim).filter(|m| !m.is_empty());
            let patch = MobileAiSettingsPatch {
                selected_provider: Some(provider.clone()),
                model_patch: model.map(|m| ModelPatch { provider: provider.clone(), model: m.to_string() }),
                // absent apiKey = keep the stored key; an empty string removes it
                provider_key_patch: api_key.map(|k| ProviderKeyPatch {
                    provider: provider.clone(),
                    api_key: Some(k),
                    free_only: args.get("freeOnly").and_then(Value::as_bool),
                }),
                subscription_notice_version: None,
            };
            let snap = store.set_settings(patch, chatgpt_visible).map_err(|e| e.to_string())?;
            use tauri::Emitter;
            let _ = app.emit("ae-ai-settings-changed", ()); // the 이음오피스 screens re-read their settings
            serde_json::to_value(snap).map_err(|e| e.to_string())
        }
        "export" => {
            let snap = snapshot(store)?;
            let mut providers = serde_json::Map::new();
            for id in AI_KEY_PROVIDERS {
                let key = store.get_api_key(id).map_err(|e| e.to_string())?.unwrap_or_default();
                let model = snap.model_by_provider.get(*id).cloned().unwrap_or_default();
                if !key.is_empty() || !model.is_empty() {
                    providers.insert((*id).to_string(), json!({ "apiKey": key, "model": model }));
                }
            }
            // the office suite has no "auto" over subscriptions on iPad: an unsupported selection becomes the first
            // provider with a key, else Gemini (its panel then asks for that key)
            let selected = snap.selected_provider.clone();
            let provider = if AI_KEY_PROVIDERS.contains(&selected.as_str()) {
                selected
            } else {
                AI_KEY_PROVIDERS
                    .iter()
                    .find(|id| providers.get(**id).and_then(|p| p.get("apiKey")).and_then(Value::as_str).is_some_and(|k| !k.is_empty()))
                    .map(|id| (*id).to_string())
                    .unwrap_or_else(|| "gemini".to_string())
            };
            Ok(json!({ "provider": provider, "providers": providers }))
        }
        _ => Err(format!("unknown AEAi method {method}")),
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

/// `genoffice-app://ui-fonts/<file>`: the UI font the 이음오피스 screens (home, editors) load from the desktop shell's
/// scheme; served from the office bundle's `ui-fonts/` (Pretendard, OFL).
pub const FONT_SCHEME: &str = "genoffice-app";
pub fn font_protocol<R: Runtime>(_ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || {
        let uri = req.uri();
        let host = uri.host().unwrap_or("");
        let path = uri.path().trim_start_matches('/');
        // iOS: genoffice-app://ui-fonts/X; Android/Windows style: http://genoffice-app.localhost/ui-fonts/X
        let rel = if host == "ui-fonts" { format!("ui-fonts/{path}") } else { path.to_string() };
        let resp = if rel.starts_with("ui-fonts/") { serve_static(&rel) } else { respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()) };
        responder.respond(resp)
    });
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

const IEUM_EXTS: &[&str] = &["md", "markdown", "txt"];
const OFFICE_EXTS: &[&str] = &[
    "hwp", "hwpx", "docx", "dotx", "doc", "dot", "odt", "ott", "pptx", "potx", "ppt", "odp", "otp", "xlsx", "xlsm", "xls", "ods",
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
        assert_eq!(route_for("보고서.HWP"), Some("office"));
        assert_eq!(route_for("a.hwpx"), Some("office"));
        assert_eq!(route_for("a.md"), Some("ieum"));
        assert_eq!(route_for("a.docx"), Some("office"));
        assert_eq!(route_for("a.key"), Some("office"));
        assert_eq!(route_for("a.numbers"), Some("office"));
        assert_eq!(route_for("a.pdf"), Some("office"));
        assert_eq!(route_for("a.zip"), None);
        assert_eq!(route_for("noext"), None);
    }
}

// ---- one home for every document type (AllEditor) ---------------------------------------------------------------

/// every type the home's "파일 열기" offers
const OPEN_ANY_EXTS: &[&str] = &[
    "hwp", "hwpx", "docx", "doc", "dotx", "odt", "xlsx", "xlsm", "xls", "ods", "csv", "pptx", "ppt", "odp", "pdf",
    "pages", "numbers", "key",
];

/// The home's single "파일 열기": 한글 → HWP editor session, anything else → bytes for the office suite.
#[tauri::command]
pub async fn ae_pick_open_any(
    state: tauri::State<'_, std::sync::Arc<crate::storage::MobileFileService>>,
) -> crate::error::MobileResult<crate::storage::PickedAny> {
    let svc = state.inner().clone();
    let exts: Vec<String> = OPEN_ANY_EXTS.iter().map(|e| (*e).to_string()).collect();
    tauri::async_runtime::spawn_blocking(move || svc.pick_open_any(&exts))
        .await
        .map_err(|e| crate::error::MobileError::with_detail(crate::error::MobileErrorCode::InternalError, "mobile.open.join", e.to_string()))?
}

/// The office home lists the Documents folder; a 한글 file there opens in the HWP editor.
#[tauri::command]
pub async fn ae_open_documents_hwp<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, std::sync::Arc<crate::storage::MobileFileService>>,
    path: String,
) -> crate::error::MobileResult<crate::storage::MobileDocSession> {
    let rel = path.trim_start_matches("/Documents").trim_start_matches('/').to_string();
    let full = safe_join(&storage_root(&app, "documents"), &rel)
        .map_err(|e| crate::error::MobileError::with_detail(crate::error::MobileErrorCode::InvalidArgument, "mobile.open.path", e))?;
    let svc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || svc.open_documents_file(&full))
        .await
        .map_err(|e| crate::error::MobileError::with_detail(crate::error::MobileErrorCode::InternalError, "mobile.open.join", e.to_string()))?
}

/// version (tauri.conf.json) and build number (baked in by CI: AE_BUILD_NUMBER = commits on main)
fn app_version<R: Runtime>(app: &AppHandle<R>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "build": option_env!("AE_BUILD_NUMBER").unwrap_or("dev"),
    })
}

#[tauri::command]
pub fn ae_app_version<R: Runtime>(app: AppHandle<R>) -> Value {
    app_version(&app)
}

/// The home's "최근 문서": documents of the app's Documents folder (where the office suite keeps every document,
/// 한글 included), newest first.
#[tauri::command]
pub fn ae_list_documents<R: Runtime>(app: AppHandle<R>) -> Vec<Value> {
    let base = storage_root(&app, "documents");
    let mut rows: Vec<(u64, Value)> = Vec::new();
    if let Ok(rd) = fs::read_dir(&base) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || route_for(&name) != Some("office") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            rows.push((mtime, json!({ "name": name, "path": format!("/Documents/{name}"), "size": meta.len(), "mtime": mtime })));
        }
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    rows.into_iter().take(30).map(|(_, v)| v).collect()
}
