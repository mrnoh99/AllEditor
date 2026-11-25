import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

// AllEditor: the iOS side of three file-bridge calls that 이음오피스's mobile app only implemented for Android
// (`pickOpenFile`, `createSaveFile`, `openPersistentUri`; see src/lib.rs `MobilePluginFileBridge`). Without them
// "파일 열기", saving a new document and reopening a recent document failed on iPad.
//
// A picked file is identified by a security-scoped bookmark (base64), the same token `readUriBytes` /
// `writeUriBytesAtomic` / `resolveUrl` already accept. New documents are created in the app's Documents folder
// (Files › AllEditor), where the office suite keeps its documents too.

struct AEPickArgs: Decodable {
    let exts: [String]
}

struct AECreateSaveArgs: Decodable {
    let suggestedName: String
    let mime: String?
}

struct AEUriArgs: Decodable {
    let uri: String
}

/// keeps the picker's delegate alive until the person picks or cancels
final class AEPickerDelegate: NSObject, UIDocumentPickerDelegate {
    private let done: (URL?) -> Void
    private var finished = false
    init(done: @escaping (URL?) -> Void) { self.done = done }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls.first) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
    private func finish(_ url: URL?) {
        if finished { return }
        finished = true
        done(url)
    }
}

private var aeActivePicker: AEPickerDelegate?

/// a bookmark token for a URL (falls back to the plain URL string for app-owned files)
private func aeToken(for url: URL) -> String {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        return data.base64EncodedString()
    }
    return url.absoluteString
}

private func aeIsWritable(_ url: URL) -> Bool {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return FileManager.default.isWritableFile(atPath: url.path)
}

extension IeumFilePlugin {
    /// system document picker (Files, iCloud Drive, …): the file is opened in place
    @objc public func pickOpenFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEPickArgs.self)
        var types = args.exts.compactMap { UTType(filenameExtension: $0.lowercased()) }
        if types.isEmpty { types = [.item] }
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("INTERNAL_ERROR: missing presenter")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.allowsMultipleSelection = false
            let delegate = AEPickerDelegate { url in
                aeActivePicker = nil
                guard let url else {
                    invoke.reject("USER_CANCELLED: picker dismissed")
                    return
                }
                invoke.resolve([
                    "uri": aeToken(for: url),
                    "name": url.lastPathComponent,
                    "writable": aeIsWritable(url),
                    "ephemeral": false,
                ])
            }
            aeActivePicker = delegate
            picker.delegate = delegate
            presenter.present(picker, animated: true)
        }
    }

    /// a new, empty file for a first save: Documents/<name> (a number is added when the name is taken)
    @objc public func createSaveFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AECreateSaveArgs.self)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let raw = args.suggestedName.replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: .whitespaces)
        let name = raw.isEmpty ? "문서.hwp" : raw
        let stem = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var url = docs.appendingPathComponent(name)
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            url = docs.appendingPathComponent(ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)")
            n += 1
        }
        do {
            try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
            try Data().write(to: url, options: .atomic)
        } catch {
            invoke.reject("INTERNAL_ERROR: \(error.localizedDescription)")
            return
        }
        invoke.resolve(["uri": aeToken(for: url), "name": url.lastPathComponent, "writable": true, "ephemeral": false])
    }

    /// reopen a remembered file (recent documents)
    @objc public func openPersistentUri(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEUriArgs.self)
        var url: URL?
        var stale = false
        if let data = Data(base64Encoded: args.uri) {
            url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        }
        if url == nil { url = URL(string: args.uri) }
        guard let resolved = url else {
            invoke.reject("PERMISSION_DENIED: the file is no longer available")
            return
        }
        let scoped = resolved.startAccessingSecurityScopedResource()
        let exists = FileManager.default.fileExists(atPath: resolved.path)
        if scoped { resolved.stopAccessingSecurityScopedResource() }
        guard exists else {
            invoke.reject("PERMISSION_DENIED: the file is no longer available")
            return
        }
        invoke.resolve([
            "uri": stale ? aeToken(for: resolved) : args.uri,
            "name": resolved.lastPathComponent,
            "writable": aeIsWritable(resolved),
            "ephemeral": false,
        ])
    }
}
