import XCTest

@MainActor
final class OnboardingUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFirstLaunchCanReachFooterAndStart() throws {
        let app = XCUIApplication()
        // Reset persistence once so the Start button can update @AppStorage normally.
        app.launchArguments = ["--uitest-reset-onboarding"]
        app.resetAuthorizationStatus(for: .location)
        app.launch()
        dismissLocationPromptIfPresented()

        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch
        let visibleFrame = window.frame.insetBy(dx: -1, dy: -1)
        XCTAssertFalse(scroll.frame.isEmpty)
        XCTAssertTrue(
            visibleFrame.contains(scroll.frame),
            "The scroll viewport must fit inside the app window, including iPhone compatibility mode on iPad. Window: \(window.frame), scroll: \(scroll.frame)"
        )

        let footer = app.descendants(matching: .any).matching(identifier: "storeScreen.help").firstMatch
        for _ in 0..<6 {
            if isFullyVisible(footer, in: visibleFrame) { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(isFullyVisible(footer, in: visibleFrame), "The bottom Help link must be reachable by scrolling.")
        attachScreenshot(of: app, named: "Welcome footer is reachable")

        let start = app.buttons["welcome.start"]
        for _ in 0..<4 {
            if isFullyVisible(start, in: visibleFrame) { break }
            scroll.swipeDown()
        }
        XCTAssertTrue(isFullyVisible(start, in: visibleFrame), "The welcome button must be fully visible and tappable.")
        start.tap()
        dismissLocationPromptIfPresented()

        // Denying location gives a deterministic post-welcome state without GPS or network access.
        XCTAssertTrue(app.staticTexts["Bez lokalizacji ani hop"].waitForExistence(timeout: 10))
        XCTAssertFalse(start.exists, "Starting must leave the welcome screen.")
        attachScreenshot(of: app, named: "Welcome completed without location permission")
    }

    private func isFullyVisible(_ element: XCUIElement, in frame: CGRect) -> Bool {
        element.exists && element.isHittable && frame.contains(element.frame)
    }

    private func dismissLocationPromptIfPresented() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deny = springboard.alerts.buttons.matching(
            NSPredicate(format: "label IN %@", ["Don't Allow", "Don’t Allow", "Nie pozwalaj"])
        ).firstMatch
        if deny.waitForExistence(timeout: 5) {
            deny.tap()
        }
    }

    private func attachScreenshot(of app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
