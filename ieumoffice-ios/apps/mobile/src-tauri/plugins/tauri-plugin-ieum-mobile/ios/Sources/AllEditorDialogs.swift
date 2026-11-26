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
        sv.contentOffset = .zero
        aeScrollLocks.append(sv.observe(\.contentOffset, options: [.new]) { sv, _ in
            if sv.contentOffset != .zero { sv.contentOffset = .zero }
        })
    }
    if Thread.isMainThread { lock() } else { DispatchQueue.main.async(execute: lock) }
}
