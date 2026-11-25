import Foundation
import Tauri

// AllEditor: "Open in AllEditor" from other apps (Files, Mail, Safari, …).
// iOS hands the app a file URL (RunEvent::Opened on the Rust side). HWP / HWPX / Markdown go to the
// 이음오피스 editor through IeumFilePlugin's pending-open queue; office files are read here and handed to the
// office suite as bytes (it stores its own copy in Documents).

struct AEOpenUrlArgs: Decodable {
    let url: String
}

extension IeumFilePlugin {
    /// queue an incoming URL for `takePendingOpenIntent` (HWP / HWPX / Markdown)
    @objc public func enqueueOpenUrl(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEOpenUrlArgs.self)
        guard let url = URL(string: args.url) else { invoke.reject("INVALID_ARGUMENT: bad url"); return }
        // a file iOS copied into Documents/Inbox is ours to keep; anything else is edited in place
        let inbox = url.path.contains("/Documents/Inbox/")
        enqueueIncomingUrl(url, openInPlace: !inbox)
        invoke.resolve(["ok": true])
    }
}

extension AllEditorOfficePlugin {
    /// read an incoming office file (security-scoped, coordinated); a copy iOS left in Documents/Inbox is removed
    @objc public func readIncomingUrl(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEOpenUrlArgs.self)
        guard let url = URL(string: args.url) else { invoke.reject("INVALID_ARGUMENT: bad url"); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var readError: NSError?
        var data: Data?
        var failure: Error?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &readError) { u in
            do { data = try Data(contentsOf: u) } catch { failure = error }
        }
        guard let bytes = data else {
            invoke.reject("READ_FAILED: \((failure ?? readError)?.localizedDescription ?? "unknown")")
            return
        }
        if url.path.contains("/Documents/Inbox/") { try? FileManager.default.removeItem(at: url) }
        invoke.resolve(["name": url.lastPathComponent, "data": bytes.base64EncodedString()])
    }
}
