import Capacitor
import UIKit
import WebKit

private final class ItineraryPageRenderer: UIPrintPageRenderer {
    // The existing print stylesheet owns its internal margins and A4 pages.
    static let a4 = CGRect(x: 0, y: 0, width: 595.2756, height: 841.8898)
    override var paperRect: CGRect { Self.a4 }
    override var printableRect: CGRect { Self.a4 }
}

@objc(PogodaParkPDFPlugin)
final class PogodaParkPDFPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PogodaParkPDFPlugin"
    let jsName = "PogodaParkPDF"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "exportPDF", returnType: CAPPluginReturnPromise)]
    private var exporting = false

    @objc func exportPDF(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.exporting, let presenter = self.bridge?.viewController,
                  presenter.presentedViewController == nil, let webView = self.bridge?.webView else {
                call.reject("Zamknij otwarte okno udostępniania i spróbuj ponownie.", "pdf-busy")
                return
            }
            self.exporting = true
            webView.evaluateJavaScript("document.querySelectorAll('.print-plan .pdf-page').length") { value, error in
                guard error == nil, let expectedPages = value as? Int, expectedPages > 0, expectedPages <= 30 else {
                    self.exporting = false
                    call.reject("Najpierw otwórz podgląd planu do zapisania w PDF.", "pdf-not-ready")
                    return
                }
                self.render(webView: webView, presenter: presenter, expectedPages: expectedPages, call: call)
            }
        }
    }

    private func render(webView: WKWebView, presenter: UIViewController, expectedPages: Int, call: CAPPluginCall) {
        let renderer = ItineraryPageRenderer()
        let formatter = webView.viewPrintFormatter()
        formatter.perPageContentInsets = .zero
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)
        let count = renderer.numberOfPages
        guard count == expectedPages, count > 0, count <= 30 else {
            exporting = false
            call.reject("Nie udało się ułożyć stron PDF. Zamknij podgląd i otwórz go ponownie.", "pdf-render-failed")
            return
        }
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [kCGPDFContextTitle as String: "PogodaPark — plan wizyty",
                               kCGPDFContextCreator as String: "PogodaPark"]
        let data = UIGraphicsPDFRenderer(bounds: ItineraryPageRenderer.a4, format: format).pdfData { context in
            for index in 0..<count {
                context.beginPage()
                UIColor.white.setFill()
                UIRectFill(ItineraryPageRenderer.a4)
                renderer.drawPage(at: index, in: ItineraryPageRenderer.a4)
            }
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pogodapark-pdf-" + UUID().uuidString)
        do {
            guard data.count > 1024 else { throw CocoaError(.fileWriteUnknown) }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("PogodaPark-plan.pdf")
            try data.write(to: url, options: .atomic)
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = presenter.view
            activity.popoverPresentationController?.sourceRect = CGRect(
                x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 70, width: 1, height: 1
            )
            activity.completionWithItemsHandler = { _, completed, _, error in
                self.exporting = false
                try? FileManager.default.removeItem(at: directory)
                if let error {
                    call.reject("Nie udało się zapisać ani udostępnić PDF. Spróbuj ponownie.", "pdf-share-failed", error)
                } else {
                    call.resolve(["shared": completed, "pageCount": count])
                }
            }
            presenter.present(activity, animated: true)
        } catch {
            exporting = false
            try? FileManager.default.removeItem(at: directory)
            call.reject("Nie udało się przygotować pliku PDF. Sprawdź wolne miejsce i spróbuj ponownie.", "pdf-render-failed", error)
        }
    }
}
