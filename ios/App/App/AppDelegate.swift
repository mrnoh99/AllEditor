import UIKit
import Capacitor
import WebKit
import Network

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Native file access (replaces @capacitor/filesystem; app Documents folder, visible in Files.app)

@objc(AEFilesPlugin)
public class AEFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AEFilesPlugin"
    public let jsName = "AEFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readdir", returnType: CAPPluginReturnPromise),
    ]

    /// "documents" (visible in Files.app) or "support" (private app data: settings, AI keys)
    private func root(_ call: CAPPluginCall) -> URL {
        let dir: FileManager.SearchPathDirectory = call.getString("dir") == "support" ? .applicationSupportDirectory : .documentDirectory
        let url = FileManager.default.urls(for: dir, in: .userDomainMask)[0].standardizedFileURL
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Resolves a Documents-relative path; refuses anything that escapes the folder.
    private func resolve(_ call: CAPPluginCall) -> URL? {
        let rel = call.getString("path") ?? ""
        let base = root(call)
        let url = base.appendingPathComponent(rel).standardizedFileURL
        guard url.path == base.path || url.path.hasPrefix(base.path + "/") else {
            call.reject("Path escapes its folder")
            return nil
        }
        return url
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let url = resolve(call) else { return }
        do { call.resolve(["data": try Data(contentsOf: url).base64EncodedString()]) }
        catch { call.reject("Cannot read file", nil, error) }
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let url = resolve(call) else { return }
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("Invalid data"); return
        }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            call.resolve()
        } catch { call.reject("Cannot write file", nil, error) }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let url = resolve(call) else { return }
        do { try FileManager.default.removeItem(at: url); call.resolve() }
        catch { call.reject("Cannot delete file", nil, error) }
    }

    @objc func readdir(_ call: CAPPluginCall) {
        guard let url = resolve(call) else { return }
        do {
            let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
            let items = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: keys)
            let files: [[String: Any]] = items.map { item in
                let v = try? item.resourceValues(forKeys: Set(keys))
                return [
                    "name": item.lastPathComponent,
                    "type": (v?.isDirectory ?? false) ? "directory" : "file",
                    "size": v?.fileSize ?? 0,
                    "mtime": Int((v?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000),
                ]
            }
            call.resolve(["files": files])
        } catch { call.resolve(["files": []]) }
    }
}

// MARK: - HTML -> PDF (offscreen WKWebView paginated with @media print rules)

final class AEPageRenderer: UIPrintPageRenderer {
    private let paper: CGRect
    init(paper: CGRect) { self.paper = paper; super.init() }
    override var paperRect: CGRect { paper }
    override var printableRect: CGRect { paper }
}

@objc(AEPdfPlugin)
public class AEPdfPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "AEPdfPlugin"
    public let jsName = "AEPdf"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise)]
    private var jobs: [ObjectIdentifier: (call: CAPPluginCall, paper: CGRect)] = [:]

    @objc func render(_ call: CAPPluginCall) {
        guard let html = call.getString("html") else { call.reject("html missing"); return }
        let w = CGFloat(call.getDouble("width") ?? 595.28), h = CGFloat(call.getDouble("height") ?? 841.89)
        guard w > 10, h > 10, w < 6000, h < 6000 else { call.reject("invalid page size"); return }
        DispatchQueue.main.async {
            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: w, height: h))
            wv.alpha = 0.01
            wv.isUserInteractionEnabled = false
            wv.navigationDelegate = self
            self.bridge?.viewController?.view.insertSubview(wv, at: 0)
            self.jobs[ObjectIdentifier(wv)] = (call, CGRect(x: 0, y: 0, width: w, height: h))
            wv.loadHTMLString(html, baseURL: nil)
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
        job.call.reject("PDF render failed", nil, error)
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
        job.call.resolve(["data": pdf.base64EncodedString()])
    }
}

// MARK: - Printing: iOS print dialog and direct network printing (IPP over HTTP, raw port 9100)

@objc(AEPrintPlugin)
public class AEPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AEPrintPlugin"
    public let jsName = "AEPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "directPrint", returnType: CAPPluginReturnPromise),
    ]

    // ---- iOS print dialog (AirPrint printers, "Save to Files", …)
    @objc func printPdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("data missing"); return }
        let name = call.getString("jobName") ?? "AllEditor"
        DispatchQueue.main.async {
            let ctl = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            ctl.printInfo = info
            ctl.printingItem = data
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error { call.reject("Print failed", nil, error) } else { call.resolve(["completed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad, let view = self.bridge?.viewController?.view {
                let r = CGRect(x: view.bounds.midX - 1, y: view.bounds.midY - 1, width: 2, height: 2)
                ctl.present(from: r, in: view, animated: true, completionHandler: done)
            } else {
                ctl.present(animated: true, completionHandler: done)
            }
        }
    }

    // ---- direct printing to an IP printer
    @objc func directPrint(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty,
              let b64 = call.getString("data"), let pdf = Data(base64Encoded: b64) else { call.reject("host/data missing"); return }
        let proto = call.getString("protocol") ?? "auto"
        let name = call.getString("jobName") ?? "AllEditor"
        let copies = call.getInt("copies") ?? 1
        let sides = call.getString("sides")
        let ippPort = call.getInt("port") ?? 631
        Task {
            var errors: [String] = []
            if proto == "auto" || proto == "ipp" {
                do { try await self.ippPrint(host: host, port: ippPort, pdf: pdf, name: name, copies: copies, sides: sides); call.resolve(["via": "ipp"]); return }
                catch { errors.append("IPP: \(error.localizedDescription)") }
            }
            if proto == "auto" || proto == "raw" {
                do { try await self.rawPrint(host: host, port: proto == "raw" ? (call.getInt("port") ?? 9100) : 9100, pdf: pdf); call.resolve(["via": "raw"]); return }
                catch { errors.append("RAW: \(error.localizedDescription)") }
            }
            call.reject(errors.joined(separator: " / "))
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

    /// IPP Print-Job with an application/pdf document (printers that speak IPP; most AirPrint-less network printers still do)
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
            var finished = false
            let finish: (Error?) -> Void = { err in
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
            DispatchQueue.global().asyncAfter(deadline: .now() + 30) { finish(NSError(domain: "AEPrint", code: 4, userInfo: [NSLocalizedDescriptionKey: "timeout"])) }
        }
    }
}

/// Main view controller: registers the file plugin and enables the edge-swipe back gesture.
class AEViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AEFilesPlugin())
        bridge?.registerPluginInstance(AEPdfPlugin())
        bridge?.registerPluginInstance(AEPrintPlugin())
        webView?.allowsBackForwardNavigationGestures = true
    }
}
