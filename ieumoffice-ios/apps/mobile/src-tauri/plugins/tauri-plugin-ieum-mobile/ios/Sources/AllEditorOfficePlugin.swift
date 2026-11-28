import Foundation
import Network
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

// AllEditor office suite — native side of `AEPdf` / `AEPrint` (ported from the Capacitor app, ios/App/App/AppDelegate.swift).
//   renderPdf   : HTML -> PDF through an offscreen WKWebView paginated with @media print rules
//   printPdf    : iOS print dialog (AirPrint printers, "Save to Files", …)
//   directPrint : straight to an IP printer — IPP Print-Job (application/pdf) or raw TCP port 9100

struct AERenderPdfArgs: Decodable {
    let html: String
    let width: Double?
    let height: Double?
}

struct AEPrintPdfArgs: Decodable {
    let data: String
    let jobName: String?
}

struct AEDirectPrintArgs: Decodable {
    let host: String
    let port: Int?
    let `protocol`: String?
    let data: String
    let jobName: String?
    let copies: Int?
    let sides: String?
}

final class AEPageRenderer: UIPrintPageRenderer {
    private let paper: CGRect
    init(paper: CGRect) { self.paper = paper; super.init() }
    override var paperRect: CGRect { paper }
    override var printableRect: CGRect { paper }
}

public final class AllEditorOfficePlugin: Plugin, WKNavigationDelegate {
    private var jobs: [ObjectIdentifier: (invoke: Invoke, paper: CGRect, view: WKWebView)] = [:]

    // at start: the pages' JavaScript dialogs, and the documents in iCloud Drive › AllEditor (AllEditorICloud.swift)
    public override func load(webview: WKWebView) {
        aeInstallWebDialogs(webview) // alert / confirm / prompt (AllEditorDialogs.swift)
        aeLockWebViewScroll(webview) // the keyboard never pushes the app off the top of the screen
        aeSetupICloudDocuments()
    }

    // MARK: HTML -> PDF

    @objc public func renderPdf(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AERenderPdfArgs.self)
        let w = CGFloat(args.width ?? 595.28), h = CGFloat(args.height ?? 841.89)
        guard w > 10, h > 10, w < 6000, h < 6000 else { invoke.reject("invalid page size"); return }
        DispatchQueue.main.async {
            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: w, height: h))
            wv.alpha = 0.01
            wv.isUserInteractionEnabled = false
            wv.navigationDelegate = self
            self.manager.viewController?.view.insertSubview(wv, at: 0)
            self.jobs[ObjectIdentifier(wv)] = (invoke, CGRect(x: 0, y: 0, width: w, height: h), wv)
            wv.loadHTMLString(args.html, baseURL: nil)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // give images / layout a moment to settle before paginating
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.finish(webView) }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(webView, error) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(webView, error) }

    private func fail(_ webView: WKWebView, _ error: Error) {
        guard let job = jobs.removeValue(forKey: ObjectIdentifier(webView)) else { return }
        webView.removeFromSuperview()
        job.invoke.reject("PDF render failed: \(error.localizedDescription)")
    }

    private func finish(_ webView: WKWebView) {
        guard let job = jobs.removeValue(forKey: ObjectIdentifier(webView)) else { return }
        let renderer = AEPageRenderer(paper: job.paper)
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        let pages = max(renderer.numberOfPages, 1)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: pages))
        let pdf = UIGraphicsPDFRenderer(bounds: job.paper).pdfData { ctx in
            for i in 0..<pages {
                ctx.beginPage()
                renderer.drawPage(at: i, in: ctx.pdfContextBounds)
            }
        }
        webView.removeFromSuperview()
        job.invoke.resolve(["data": pdf.base64EncodedString()])
    }

    // MARK: 파일 열기 — the system picker, opening at the AllEditor folder (iCloud Drive › AllEditor)

    private var openPicker: AEPickerDelegate?

    /// Picks a document. One inside the AllEditor folder is answered by name; one elsewhere (another iCloud folder,
    /// On My iPad, a provider app) is copied into the AllEditor folder first and answered by the copy's name.
    @objc public func pickDocument(_ invoke: Invoke) throws {
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else { invoke.reject("missing presenter"); return }
            var top: UIViewController = presenter
            while let next = top.presentedViewController { top = next }
            let docs = aeDocumentsDir()
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.directoryURL = docs
            let delegate = AEPickerDelegate { url in
                self.openPicker = nil
                guard let url else { invoke.resolve(["canceled": true]); return }
                DispatchQueue.global(qos: .userInitiated).async {
                    let fm = FileManager.default
                    // a file anywhere below the AllEditor folder (its kind folders included) opens where it is
                    let docsPath = docs.standardizedFileURL.resolvingSymlinksInPath().path
                    let filePath = url.standardizedFileURL.resolvingSymlinksInPath().path
                    let inside = filePath.hasPrefix(docsPath + "/")
                    let relative = inside ? String(filePath.dropFirst(docsPath.count + 1)) : url.lastPathComponent
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    // a Pages / Keynote / Numbers document saved as a package is a folder: it is handed over as the
                    // zipped single file those apps also write (same contents), which the converter reads
                    let isPackage = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                    if inside && !isPackage {
                        // an iCloud file not downloaded yet is fetched before the app reads it
                        var coordError: NSError?
                        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { _ in }
                        invoke.resolve(["name": relative, "copied": false]); return
                    }
                    // a file from elsewhere is copied into the folder of its kind (한글, Word, PowerPoint …)
                    let stem = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
                    let kindDir = aeKindFolder(ext).map { docs.appendingPathComponent($0, isDirectory: true) } ?? docs
                    try? fm.createDirectory(at: kindDir, withIntermediateDirectories: true)
                    var target = kindDir.appendingPathComponent(url.lastPathComponent)
                    var n = 2
                    while fm.fileExists(atPath: target.path) {
                        target = kindDir.appendingPathComponent(ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)")
                        n += 1
                    }
                    var failure: Error?
                    var coordError: NSError?
                    let readOpts: NSFileCoordinator.ReadingOptions = isPackage ? .forUploading : []
                    NSFileCoordinator().coordinate(readingItemAt: url, options: readOpts, error: &coordError) { readable in
                        do { try fm.copyItem(at: readable, to: target) } catch { failure = error }
                    }
                    if let failure = failure ?? (coordError as Error?) { invoke.reject("could not copy the file: \(failure.localizedDescription)"); return }
                    let rel = kindDir == docs ? target.lastPathComponent : "\(kindDir.lastPathComponent)/\(target.lastPathComponent)"
                    invoke.resolve(["name": rel, "copied": true])
                }
            }
            self.openPicker = delegate
            picker.delegate = delegate
            top.present(picker, animated: true)
        }
    }

    // MARK: 문서 저장 위치 — where the AllEditor folder lives (iCloud Drive / On My iPad / inside a picked folder)

    struct AEStorageArgs: Decodable {
        let kind: String   // "icloud" | "local" | "custom"
        let copy: Bool?    // copy the documents of the current folder to the new one
    }

    private func storageLabel(_ kind: String, _ url: URL) -> String {
        switch kind {
        case "icloud": return "iCloud Drive › AllEditor"
        case "local": return "나의 iPad › AllEditor"
        default:
            let parent = url.deletingLastPathComponent().lastPathComponent
            return "\(parent) › AllEditor"
        }
    }

    @objc public func storageInfo(_ invoke: Invoke) throws {
        let current = aeDocumentsDir()
        let kind = aeStorageChoice() ?? "icloud"
        let shown = current.path.contains("Mobile Documents") && kind != "custom" ? "icloud" : (current.standardizedFileURL == aeLocalDocumentsURL().standardizedFileURL ? "local" : kind)
        invoke.resolve(["kind": shown, "chosen": kind, "path": current.path, "label": storageLabel(shown, current),
                        "icloudAvailable": FileManager.default.ubiquityIdentityToken != nil])
    }

    /// Change where the AllEditor folder lives. The setup data (.alleditor: printers …) always comes along; the
    /// documents are copied when `copy` is true (a name already in the new folder is left as it is).
    @objc public func setStorageLocation(_ invoke: Invoke) throws {
        let a = try invoke.parseArgs(AEStorageArgs.self)
        let finish: (URL) -> Void = { target in
            DispatchQueue.global(qos: .userInitiated).async {
                let fm = FileManager.default
                let old = aeDocumentsDir()
                var copied = 0, failed = 0
                if old.standardizedFileURL != target.standardizedFileURL {
                    let items = (try? fm.contentsOfDirectory(at: old, includingPropertiesForKeys: nil, options: [])) ?? []
                    for item in items {
                        let name = item.lastPathComponent
                        let isSetup = name == ".alleditor"
                        if !isSetup && (name.hasPrefix(".") || a.copy != true) { continue }
                        let dest = target.appendingPathComponent(name)
                        var err: NSError?
                        NSFileCoordinator().coordinate(readingItemAt: item, options: [], writingItemAt: dest, options: .forReplacing, error: &err) { src, dst in
                            do {
                                if isSetup {
                                    // the settings follow the user: the current ones replace any older copy there
                                    if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
                                    try fm.copyItem(at: src, to: dst)
                                } else if !fm.fileExists(atPath: dst.path) {
                                    try fm.copyItem(at: src, to: dst); copied += 1
                                }
                            } catch { failed += 1; NSLog("[AllEditor] copy \(name): \(error.localizedDescription)") }
                        }
                        if err != nil { failed += 1 }
                    }
                }
                aeSetStorageChoice(a.kind)
                aeWriteDocumentsMarker(a.kind == "local" ? nil : target)
                invoke.resolve(["ok": true, "path": target.path, "label": self.storageLabel(a.kind, target), "copied": copied, "failed": failed])
            }
        }
        switch a.kind {
        case "icloud":
            DispatchQueue.global(qos: .userInitiated).async {
                guard let d = aeICloudDocumentsURL() else { invoke.reject("iCloud Drive를 쓸 수 없습니다. 설정 › Apple 계정 › iCloud › iCloud Drive를 켜 주세요."); return }
                finish(d)
            }
        case "local":
            finish(aeLocalDocumentsURL())
        case "custom":
            DispatchQueue.main.async {
                guard let presenter = self.manager.viewController else { invoke.reject("missing presenter"); return }
                var top: UIViewController = presenter
                while let next = top.presentedViewController { top = next }
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
                picker.allowsMultipleSelection = false
                let delegate = AEPickerDelegate { url in
                    self.openPicker = nil
                    guard let url else { invoke.resolve(["canceled": true]); return }
                    _ = url.startAccessingSecurityScopedResource()
                    guard aeSaveCustomBookmark(url), let folder = aeCustomDocumentsURL() else {
                        invoke.reject("이 폴더는 AllEditor가 계속 쓸 수 없습니다. 다른 폴더를 골라 주세요."); return
                    }
                    finish(folder)
                }
                self.openPicker = delegate
                picker.delegate = delegate
                top.present(picker, animated: true)
            }
        default:
            invoke.reject("unknown location \(a.kind)")
        }
    }

    // MARK: iCloud Drive file changes under NSFileCoordinator (called by src-tauri/src/office.rs `coordinate`)

    struct AECoordArgs: Decodable {
        let op: String
        let from: String?
        let to: String
    }

    /// "replace": swap the finished file `from` in at `to` · "move": rename `from` to `to` · "delete": remove `to`.
    /// Coordinated so iCloud sees one complete change (no half-written file is synced, no conflicting copy).
    @objc public func coordinatedFile(_ invoke: Invoke) throws {
        let a = try invoke.parseArgs(AECoordArgs.self)
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let to = URL(fileURLWithPath: a.to)
            let coordinator = NSFileCoordinator(filePresenter: nil)
            var coordError: NSError?
            var opError: Error?
            switch a.op {
            case "replace":
                guard let fromPath = a.from else { invoke.reject("from missing"); return }
                let from = URL(fileURLWithPath: fromPath)
                coordinator.coordinate(writingItemAt: to, options: .forReplacing, error: &coordError) { dest in
                    do {
                        if fm.fileExists(atPath: dest.path) { _ = try fm.replaceItemAt(dest, withItemAt: from) }
                        else { try fm.moveItem(at: from, to: dest) }
                    } catch { opError = error }
                }
                if coordError != nil || opError != nil { try? fm.removeItem(at: from) }
            case "move":
                guard let fromPath = a.from else { invoke.reject("from missing"); return }
                let from = URL(fileURLWithPath: fromPath)
                coordinator.coordinate(writingItemAt: from, options: .forMoving, writingItemAt: to, options: .forReplacing,
                                       error: &coordError) { src, dst in
                    do {
                        try fm.moveItem(at: src, to: dst)
                        coordinator.item(at: src, didMoveTo: dst)
                    } catch { opError = error }
                }
            case "delete":
                coordinator.coordinate(writingItemAt: to, options: .forDeleting, error: &coordError) { dest in
                    do { try fm.removeItem(at: dest) } catch { opError = error }
                }
            default:
                invoke.reject("unknown op \(a.op)")
                return
            }
            if let e = coordError ?? (opError as NSError?) { invoke.reject(e.localizedDescription) }
            else { invoke.resolve(["ok": true]) }
        }
    }

    // MARK: iOS print dialog

    @objc public func printPdf(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEPrintPdfArgs.self)
        guard let data = Data(base64Encoded: args.data) else { invoke.reject("data missing"); return }
        let name = args.jobName ?? "AllEditor"
        DispatchQueue.main.async {
            let ctl = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            ctl.printInfo = info
            ctl.printingItem = data
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error { invoke.reject("Print failed: \(error.localizedDescription)") } else { invoke.resolve(["completed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad, let view = self.manager.viewController?.view {
                let r = CGRect(x: view.bounds.midX - 1, y: view.bounds.midY - 1, width: 2, height: 2)
                ctl.present(from: r, in: view, animated: true, completionHandler: done)
            } else {
                ctl.present(animated: true, completionHandler: done)
            }
        }
    }

    // MARK: direct printing to an IP printer

    @objc public func directPrint(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AEDirectPrintArgs.self)
        guard !args.host.isEmpty, let pdf = Data(base64Encoded: args.data) else { invoke.reject("host/data missing"); return }
        let proto = args.protocol ?? "auto"
        let name = args.jobName ?? "AllEditor"
        let copies = args.copies ?? 1
        Task {
            var errors: [String] = []
            if proto == "auto" || proto == "ipp" {
                do {
                    try await self.ippPrint(host: args.host, port: args.port ?? 631, pdf: pdf, name: name, copies: copies, sides: args.sides)
                    invoke.resolve(["via": "ipp"]); return
                } catch { errors.append("IPP: \(error.localizedDescription)") }
            }
            if proto == "auto" || proto == "raw" {
                do {
                    try await self.rawPrint(host: args.host, port: proto == "raw" ? (args.port ?? 9100) : 9100, pdf: pdf)
                    invoke.resolve(["via": "raw"]); return
                } catch { errors.append("RAW: \(error.localizedDescription)") }
            }
            invoke.reject(errors.joined(separator: " / "))
        }
    }

    private func ippAttr(_ tag: UInt8, _ name: String, _ value: String) -> Data {
        var d = Data([tag])
        d.append(contentsOf: withUnsafeBytes(of: UInt16(name.utf8.count).bigEndian, Array.init))
        d.append(name.data(using: .utf8)!)
        d.append(contentsOf: withUnsafeBytes(of: UInt16(value.utf8.count).bigEndian, Array.init))
        d.append(value.data(using: .utf8)!)
        return d
    }

    private func ippInt(_ name: String, _ value: Int32) -> Data {
        var d = Data([0x21])
        d.append(contentsOf: withUnsafeBytes(of: UInt16(name.utf8.count).bigEndian, Array.init))
        d.append(name.data(using: .utf8)!)
        d.append(contentsOf: withUnsafeBytes(of: UInt16(4).bigEndian, Array.init))
        d.append(contentsOf: withUnsafeBytes(of: value.bigEndian, Array.init))
        return d
    }

    /// IPP Print-Job with an application/pdf document
    private func ippPrint(host: String, port: Int, pdf: Data, name: String, copies: Int, sides: String?) async throws {
        var lastError: Error = NSError(domain: "AEPrint", code: 1, userInfo: [NSLocalizedDescriptionKey: "no response"])
        for path in ["/ipp/print", "/ipp", "/ipp/printer", "/printers/ipp"] {
            var body = Data([0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01]) // IPP 1.1, Print-Job, request-id 1
            body.append(0x01) // operation-attributes-tag
            body.append(ippAttr(0x47, "attributes-charset", "utf-8"))
            body.append(ippAttr(0x48, "attributes-natural-language", "en"))
            body.append(ippAttr(0x45, "printer-uri", "ipp://\(host):\(port)\(path)"))
            body.append(ippAttr(0x42, "requesting-user-name", "AllEditor"))
            body.append(ippAttr(0x42, "job-name", name))
            body.append(ippAttr(0x49, "document-format", "application/pdf"))
            body.append(0x02) // job-attributes-tag
            if copies > 1 { body.append(ippInt("copies", Int32(copies))) }
            if let sides = sides { body.append(ippAttr(0x44, "sides", sides)) }
            body.append(0x03) // end-of-attributes
            body.append(pdf)
            guard let url = URL(string: "http://\(host):\(port)\(path)") else { continue }
            var req = URLRequest(url: url, timeoutInterval: 60)
            req.httpMethod = "POST"
            req.setValue("application/ipp", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse, http.statusCode == 200, data.count >= 4 else {
                    lastError = NSError(domain: "AEPrint", code: 2, userInfo: [NSLocalizedDescriptionKey: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0) at \(path)"]); continue
                }
                let status = (Int(data[2]) << 8) | Int(data[3])
                if status <= 0x00ff { return }
                lastError = NSError(domain: "AEPrint", code: status, userInfo: [NSLocalizedDescriptionKey: String(format: "printer status 0x%04x", status)])
            } catch { lastError = error }
        }
        throw lastError
    }

    /// Raw TCP (JetDirect, port 9100): the printer must accept PDF directly
    private func rawPrint(host: String, port: Int, pdf: Data) async throws {
        guard let p = NWEndpoint.Port(rawValue: UInt16(port)) else { throw NSError(domain: "AEPrint", code: 3) }
        let conn = NWConnection(host: NWEndpoint.Host(host), port: p, using: .tcp)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let lock = NSLock()
            var finished = false
            let finish: (Error?) -> Void = { err in
                lock.lock(); defer { lock.unlock() }
                if finished { return }
                finished = true
                conn.cancel()
                if let err = err { cont.resume(throwing: err) } else { cont.resume() }
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    conn.send(content: pdf, completion: .contentProcessed { err in
                        // let the printer drain the stream before closing
                        DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) { finish(err) }
                    })
                case .failed(let err): finish(err)
                case .waiting(let err): finish(err)
                default: break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 30) {
                finish(NSError(domain: "AEPrint", code: 4, userInfo: [NSLocalizedDescriptionKey: "timeout"]))
            }
        }
    }
}

@_cdecl("init_plugin_ae_office")
func initPluginAeOffice() -> Plugin {
    return AllEditorOfficePlugin()
}

/// the folder inside AllEditor a document of this extension is kept in (same table as shim/runtime/folders.ts)
func aeKindFolder(_ ext: String) -> String? {
    switch ext.lowercased() {
    case "hwp", "hwpx": return "한글"
    case "docx", "dotx", "doc", "dot", "odt", "ott", "rtf": return "Word"
    case "pptx", "potx", "ppt", "odp", "otp": return "PowerPoint"
    case "xlsx", "xlsm", "xls", "ods", "ots", "csv", "tsv": return "Excel"
    case "pdf": return "PDF"
    case "pages", "key", "keyx", "numbers": return "iWork"
    default: return nil
    }
}
