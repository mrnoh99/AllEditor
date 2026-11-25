import UIKit
import Capacitor
import WebKit

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

/// Main view controller: registers the file plugin and enables the edge-swipe back gesture.
class AEViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AEFilesPlugin())
        bridge?.registerPluginInstance(AEPdfPlugin())
        webView?.allowsBackForwardNavigationGestures = true
    }
}
