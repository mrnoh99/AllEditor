import UIKit
import Capacitor

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

    private var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL
    }

    /// Resolves a Documents-relative path; refuses anything that escapes the folder.
    private func resolve(_ call: CAPPluginCall) -> URL? {
        let rel = call.getString("path") ?? ""
        let url = root.appendingPathComponent(rel).standardizedFileURL
        guard url.path == root.path || url.path.hasPrefix(root.path + "/") else {
            call.reject("Path escapes Documents")
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

/// Main view controller: registers the file plugin and enables the edge-swipe back gesture.
class AEViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AEFilesPlugin())
        webView?.allowsBackForwardNavigationGestures = true
    }
}
