import UIKit
import WebKit

// JavaScript alert() / confirm() / prompt() on iOS.
//
// The webview's UI delegate (wry's) does not implement WebKit's JavaScript panels on iOS, so every alert, confirm
// and prompt of the pages was silently dropped: confirm() answered "cancel", prompt() answered nothing. Renaming
// a document, deleting one from the list and naming a new document on save all ask through them.
//
// This proxy sits in front of wry's delegate: it shows the three panels as native alerts (they work for the
// office pages inside their iframes too) and hands every other delegate call to wry's delegate unchanged.

final class AEWebUIDelegateProxy: NSObject, WKUIDelegate {
    private let inner: NSObject?

    init(inner: NSObject?) {
        self.inner = inner
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let inner, inner.responds(to: aSelector) { return inner }
        return super.forwardingTarget(for: aSelector)
    }

    private func presenter(_ webView: WKWebView) -> UIViewController? {
        var top = webView.window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }

    private var korean: Bool { Locale.preferredLanguages.first?.hasPrefix("ko") ?? true }

    private func present(_ alert: UIAlertController, _ webView: WKWebView, otherwise: () -> Void) {
        guard let vc = presenter(webView) else { otherwise(); return }
        if let pop = alert.popoverPresentationController { // iPad: action sheets need an anchor (alerts do not)
            pop.sourceView = webView
            pop.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
        }
        vc.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: korean ? "확인" : "OK", style: .default) { _ in completionHandler() })
        present(a, webView, otherwise: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: korean ? "취소" : "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: korean ? "확인" : "OK", style: .default) { _ in completionHandler(true) })
        present(a, webView) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { field in
            field.text = defaultText
            field.clearButtonMode = .whileEditing
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
            field.returnKeyType = .done
        }
        a.addAction(UIAlertAction(title: korean ? "취소" : "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: korean ? "확인" : "OK", style: .default) { [weak a] _ in
            completionHandler(a?.textFields?.first?.text ?? "")
        })
        present(a, webView) { completionHandler(nil) }
        // the whole name is selected, so typing replaces it
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak a] in
            if let f = a?.textFields?.first { f.becomeFirstResponder(); f.selectAll(nil) }
        }
    }
}

/// kept alive here: WKWebView holds its UI delegate weakly
private var aeUIDelegateProxies: [AEWebUIDelegateProxy] = []

func aeInstallWebDialogs(_ webView: WKWebView) {
    let install = {
        if webView.uiDelegate is AEWebUIDelegateProxy { return }
        let proxy = AEWebUIDelegateProxy(inner: webView.uiDelegate as? NSObject)
        aeUIDelegateProxies.append(proxy)
        webView.uiDelegate = proxy
    }
    if Thread.isMainThread { install() } else { DispatchQueue.main.async(execute: install) }
}

// The keyboard must not push the app up. iOS scrolls the whole web view to bring the caret above the keyboard,
// which moved the office's tab bar and ribbon off the top of the screen. The pages lay themselves out in the space
// above the keyboard instead (shim: visualViewport), so the web view itself never scrolls.
private var aeScrollLocks: [NSKeyValueObservation] = []

func aeLockWebViewScroll(_ webView: WKWebView) {
    let lock = {
        let sv = webView.scrollView
        sv.isScrollEnabled = false
        sv.bounces = false
        sv.contentInsetAdjustmentBehavior = .never
        // no page zoom: a pinch zooms the document inside the editor (shim/runtime/pinch.ts)
        sv.minimumZoomScale = 1
        sv.maximumZoomScale = 1
        sv.pinchGestureRecognizer?.isEnabled = false
        sv.contentOffset = .zero
        aeScrollLocks.append(sv.observe(\.contentOffset, options: [.new]) { sv, _ in
            if sv.contentOffset != .zero { sv.contentOffset = .zero }
        })
    }
    if Thread.isMainThread { lock() } else { DispatchQueue.main.async(execute: lock) }
}

// The web view keeps the size of the window. After the iPad turns, or the app's window is resized (Split View, Stage
// Manager) while it is in the background, the web view could keep its old width, leaving a blank strip at the side
// until the app was switched away and back. Its frame follows its container whenever they differ.
private var aeFitObservers: [Any] = []

func aeKeepWebViewFilling(_ webView: WKWebView) {
    let start = {
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let fit = { [weak webView] in
            guard let wv = webView, let box = wv.superview else { return }
            if wv.frame != box.bounds { wv.frame = box.bounds; wv.setNeedsLayout() }
        }
        fit()
        let names: [Notification.Name] = [UIDevice.orientationDidChangeNotification, UIApplication.didBecomeActiveNotification, UIApplication.willEnterForegroundNotification]
        for name in names {
            aeFitObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                fit(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: fit)
            })
        }
        // a window resized without a notification (Split View, Stage Manager): the container's and the window's layers
        // report every change of their bounds, so the web view follows as it happens (no polling)
        // the web view may not be in a window yet when the plugin loads: tried again until it is (a few seconds at most)
        func attach(_ tries: Int) {
            guard let box = webView.superview, let win = box.window else {
                if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { attach(tries - 1) } }
                return
            }
            fit()
            aeFitObservers.append(box.layer.observe(\.bounds, options: [.new]) { _, _ in DispatchQueue.main.async(execute: fit) })
            aeFitObservers.append(win.layer.observe(\.bounds, options: [.new]) { _, _ in DispatchQueue.main.async(execute: fit) })
        }
        attach(20)
    }
    if Thread.isMainThread { start() } else { DispatchQueue.main.async(execute: start) }
}

// Scribble (handwriting with Apple Pencil) only on document text. A pencil tap on a toolbar field (font size, page
// number…) was taken for handwriting and left a dot there. Each pencil touch reports from the page whether it is on
// document text (shim/runtime/pencil-ui.ts, message "aeScribble"); Scribble starts only then.
final class AEScribbleGate: NSObject, UIScribbleInteractionDelegate, WKScriptMessageHandler {
    var allowed = false
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        allowed = (message.body as? Bool) ?? false
    }
    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool { allowed }
}
private let aeScribbleGate = AEScribbleGate()

func aeInstallScribbleGate(_ webView: WKWebView) {
    let start = {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "aeScribble")
        webView.configuration.userContentController.add(aeScribbleGate, name: "aeScribble")
        // the view that takes text input inside the web view (WKContentView)
        func attach(_ tries: Int) {
            let content = webView.scrollView.subviews.first { String(describing: type(of: $0)).contains("ContentView") }
            guard let view = content else {
                if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { attach(tries - 1) } }
                return
            }
            if !view.interactions.contains(where: { ($0 as? UIScribbleInteraction)?.delegate === aeScribbleGate }) {
                view.addInteraction(UIScribbleInteraction(delegate: aeScribbleGate))
            }
        }
        attach(20)
    }
    if Thread.isMainThread { start() } else { DispatchQueue.main.async(execute: start) }
}
