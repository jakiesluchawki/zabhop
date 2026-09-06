import Capacitor
import WebKit

final class BridgeViewController: CAPBridgeViewController {
    static var pendingPlanFragment: String?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PogodaParkPDFPlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 1, green: 248.0 / 255, blue: 240.0 / 255, alpha: 1)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        openPendingPlan()
    }

    func openPendingPlan() {
        guard let fragment = Self.pendingPlanFragment, let webView else { return }
        Self.pendingPlanFragment = nil
        var target = URLComponents(string: "capacitor://localhost/")!
        target.queryItems = [URLQueryItem(name: "open", value: UUID().uuidString)]
        target.fragment = fragment
        guard let url = target.url else { return }
        // Reload the bundled entry point so both cold and warm links take the
        // same backwards-compatible route through the shared-plan decoder.
        webView.load(URLRequest(url: url))
    }

    static func acceptPlanLink(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "pogodapark" else { return false }
        let fragment = url.fragment ?? (url.host == "p" ? "p" + url.path : "")
        let short = fragment.range(of: "^p/[A-Za-z0-9_-]{16}$", options: .regularExpression) != nil
        let legacy = fragment.hasPrefix("plan=") && fragment.count <= 30_000
        guard short || legacy else { return false }
        pendingPlanFragment = fragment
        return true
    }
}
