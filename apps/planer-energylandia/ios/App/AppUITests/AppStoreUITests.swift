import XCTest

@MainActor
final class AppStoreUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "pl.mieszkomahboob.pogodapark")

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDownWithError() throws {
        if let run = testRun, run.totalFailureCount > 0 {
            dumpHierarchy("FAILED_STEP")
        }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func button(containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "(elementType == %d OR elementType == %d) AND label CONTAINS %@",
            XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue, text
        )).firstMatch
    }

    private func control(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "(elementType == %d OR elementType == %d) AND label == %@",
            XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue, label
        )).firstMatch
    }

    private func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 20), "Expected public UI control", file: file, line: line)
        for _ in 0..<16 {
            let frame = element.frame
            if element.isHittable && frame.midY > 60 && frame.midY < app.frame.height - 45 { return }
            // Drag actual page content, outside the live map. The narrow outer
            // margin can fail to scroll WKWebView; the map itself consumes pans.
            let downward = frame.midY < 60
            let height = app.frame.height
            var lower: CGFloat = 90
            var upper = height - 70
            let map = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Interaktywna mapa planu Energylandii")).firstMatch
            if map.exists {
                let mapFrame = map.frame
                if mapFrame.maxY > lower && mapFrame.minY < upper {
                    let aboveEnd = min(upper, mapFrame.minY - 24)
                    let belowStart = max(lower, mapFrame.maxY + 24)
                    if aboveEnd - lower > upper - belowStart { upper = aboveEnd }
                    else { lower = belowStart }
                }
            }
            XCTAssertGreaterThan(upper - lower, 100, "The page must leave a usable scrolling area outside the map", file: file, line: line)
            let inset = (upper - lower) * 0.1
            let startY = downward ? lower + inset : upper - inset
            let endY = downward ? upper - inset : lower + inset
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY / height))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY / height))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(element.isHittable, "Control must be reachable without horizontal scrolling", file: file, line: line)
    }

    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        reveal(element, file: file, line: line)
        // Use the visible control's centre instead of WebKit's inferred
        // accessibility activation point, which can miss on iPad.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1)
    }

    private func expectHeading(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.staticTexts[label].firstMatch.waitForExistence(timeout: 20), label, file: file, line: line)
    }

    private func setPartyCount(_ label: String, to count: Int) {
        for _ in 0..<8 {
            let current = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "\(label): ")).firstMatch
            XCTAssertTrue(current.exists)
            guard let number = Int(current.label.components(separatedBy: ": ").last ?? "") else {
                XCTFail("Party counter must expose its current value")
                return
            }
            if number == count { return }
            tap(app.buttons["\(number < count ? "Dodaj" : "Odejmij"): \(label)"])
        }
        XCTFail("Party counter did not reach the selected count")
    }

    private func dumpHierarchy(_ name: String) {
        let hierarchy = app.debugDescription
        let attachment = XCTAttachment(string: hierarchy)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        print("POGODAPARK_\(name): accessibility hierarchy saved as an XCTest attachment")
    }

    func test00EntrySmokeAndAccessibilityHierarchy() throws {
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30), "Bundled planner must launch offline-capable web UI")
        let planningRoute = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Decyzja podjęta — ułóż plan")).firstMatch
        XCTAssertTrue(planningRoute.waitForExistence(timeout: 20), "Entry must expose the direct planning route")
        capture("01-entry")
        dumpHierarchy("ENTRY_HIERARCHY")
    }

    func test05WeatherDecisionAndSourceTransparency() throws {
        app.launch()
        tap(button(containing: "Najpierw sprawdź pogodę"))
        XCTAssertTrue(button(containing: "Dzisiaj").waitForExistence(timeout: 20))
        let loading = app.staticTexts["Czytam prognozy…"]
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 40), .completed, "Weather must resolve to data or an honest unavailable state")
        capture("14-weather-decision")
        dumpHierarchy("WEATHER_DECISION")
        tap(button(containing: "Jutro"))
        capture("15-weather-tomorrow")
        let sources = button(containing: "źródeł dostępnych")
        if sources.exists && sources.isEnabled {
            tap(sources)
            capture("16-weather-sources")
            tap(app.buttons["Zamknij"])
        } else {
            XCTAssertTrue(button(containing: "Łączę źródła pogody").exists || app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Nie udało się pobrać prognozy")).firstMatch.exists)
        }
    }

    func test15SavedPlanPDFExport() throws {
        app.launch()
        tap(app.buttons["Wróć do zapisanego planu"])
        expectHeading("Wasza Energylandia")
        tap(app.buttons["Przygotuj piękny PDF"])
        capture("12-pdf-preview")
        tap(app.buttons["Drukuj / zapisz"])
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 30), "Actual PDF must reach the native share sheet")
        capture("13-native-pdf-share-sheet")
    }

    func test20SavedPlanNativeSharing() throws {
        app.launch()
        tap(app.buttons["Wróć do zapisanego planu"])
        expectHeading("Wasza Energylandia")
        tap(app.buttons["Kopiuj link"])
        let urlField = app.textFields["Krótki link do planu"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 30), "Native HTTP must create a durable short link")
        let url = urlField.value as? String ?? ""
        XCTAssertNotNil(url.range(of: "^https://jakiesluchawki\\.github\\.io/zabhop/planer-energylandia/(\\?r[a-f0-9]+)?#p/[A-Za-z0-9_-]{16}$", options: .regularExpression))
        let attachment = XCTAttachment(string: url)
        attachment.name = "NATIVE_QA_SHORT_LINK"
        attachment.lifetime = .keepAlways
        add(attachment)
        capture("18-short-link-created")
        tap(app.buttons["Udostępnij plan"])
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 15))
        capture("19-native-plan-share-sheet")
        dumpHierarchy("NATIVE_PLAN_SHARE")
        if #available(iOS 16.4, *) {
            let fragment = try XCTUnwrap(URL(string: url)?.fragment)
            app.terminate()
            app.open(try XCTUnwrap(URL(string: "pogodapark://" + fragment)))
            expectHeading("Wasza Energylandia")
            XCTAssertTrue(button(containing: "Dzień 3").exists)
            capture("22-opened-shared-plan")

            let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
            safari.open(try XCTUnwrap(URL(string: url)))
            XCTAssertTrue(safari.staticTexts["Wasza Energylandia"].firstMatch.waitForExistence(timeout: 40))
            XCTAssertTrue(safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Dzień 3")).firstMatch.exists)
            let screenshot = XCTAttachment(screenshot: safari.screenshot())
            screenshot.name = "23-shared-plan-in-safari"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        } else {
            throw XCTSkip("System URL round-trip QA requires iOS 16.4 or newer")
        }
    }

    func test10ThreeDayPlanReplacementPersistenceAndPDF() throws {
        app.launch()
        XCTAssertTrue(button(containing: "Decyzja podjęta — ułóż plan").waitForExistence(timeout: 30))
        capture("01-entry")
        tap(button(containing: "Decyzja podjęta — ułóż plan"))
        tap(app.buttons["Zaczynamy"])

        expectHeading("Na ile dni przyjeżdżacie?")
        dumpHierarchy("DAY_OPTIONS")
        tap(app.descendants(matching: .any).matching(NSPredicate(format: "label MATCHES %@", "3\\s*dni")).firstMatch)
        let calendarStatus = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Oficjalnie w pierwszym dniu", "Godziny otwarcia nie są potwierdzone")).firstMatch
        XCTAssertTrue(calendarStatus.waitForExistence(timeout: 25), "Calendar must resolve to confirmed hours or an honest unknown state")
        capture("02-three-day-visit")
        tap(app.buttons["Dalej"])

        expectHeading("W jakim jesteście składzie?")
        setPartyCount("Dorośli", to: 2)
        setPartyCount("Dzieci i nastolatki", to: 2)
        tap(app.buttons["Dodaj: Dzieci i nastolatki"])
        XCTAssertTrue(app.otherElements["Dzieci i nastolatki: 3"].waitForExistence(timeout: 5))
        tap(app.buttons["Odejmij: Dzieci i nastolatki"])
        XCTAssertTrue(app.otherElements["Dzieci i nastolatki: 2"].waitForExistence(timeout: 5))
        capture("03-party")
        tap(app.buttons["Dalej"])

        expectHeading("Wiek i wzrost każdej osoby")
        XCTAssertEqual(app.otherElements["Dziecko 1: przedział wieku"].value as? String, "6–7 lat")
        XCTAssertEqual(app.otherElements["Dziecko 1: przedział wzrostu"].value as? String, "120–129 cm")
        capture("04-safe-age-and-height-ranges")
        dumpHierarchy("MEMBER_RANGES")
        tap(app.buttons["Dalej"])

        expectHeading("Na co macie ochotę?")
        tap(button(containing: "Po trochu"))
        capture("05-interests")
        tap(app.buttons["Dalej"])

        expectHeading("Czy możemy rozdzielić grupę?")
        tap(button(containing: "Nie — zawsze razem"))
        tap(app.buttons["Dalej"])

        expectHeading("Jak jecie w parku?")
        tap(button(containing: "Szybko, około 30 minut"))
        tap(app.buttons["Dalej"])

        expectHeading("Dobrze was rozumiemy?")
        capture("06-review")
        tap(app.buttons["Ułóż plan"])
        expectHeading("Wasza Energylandia")
        XCTAssertTrue(button(containing: "Dzień 3").exists, "Three selected visit days must survive generation")
        capture("07-generated-plan")
        dumpHierarchy("GENERATED_PLAN")

        // WebKit exposes aria-haspopup="dialog" controls as Other in XCUI.
        tap(app.otherElements["Opis i prowadzenie"])
        let appleMaps = app.links.matching(NSPredicate(format: "label CONTAINS %@", "Apple Maps")).firstMatch
        let googleMaps = app.links.matching(NSPredicate(format: "label CONTAINS %@", "Google Maps")).firstMatch
        XCTAssertTrue(appleMaps.waitForExistence(timeout: 10))
        XCTAssertTrue(appleMaps.isHittable && googleMaps.isHittable,
                      "Both walking-navigation choices must be visible when the attraction detail opens")
        capture("17-attraction-detail")
        tap(app.buttons["Zamknij"])

        let secondDay = button(containing: "Dzień 2")
        tap(secondDay)
        XCTAssertEqual(secondDay.value as? String, "1", "The chosen day is visibly selected")
        tap(button(containing: "Dzień 1"))
        reveal(app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Interaktywna mapa planu Energylandii")).firstMatch)
        capture("08-route-map")

        let complete = button(containing: "Oznacz jako zaliczoną:")
        let originalRide = complete.label.replacingOccurrences(of: "Oznacz jako zaliczoną: ", with: "")
        tap(complete)
        let undo = control("Cofnij zaliczenie: \(originalRide)")
        XCTAssertTrue(undo.waitForExistence(timeout: 5), "A completed ride remains reversible")
        capture("09-timeline-completed")

        app.terminate()
        app.launch()
        tap(app.buttons["Wróć do zapisanego planu"])
        expectHeading("Wasza Energylandia")
        XCTAssertTrue(button(containing: "Dzień 3").exists, "Saved plan retains all days after process relaunch")
        XCTAssertTrue(undo.exists, "Completed state survives process relaunch")
        tap(undo)
        XCTAssertTrue(control("Oznacz jako zaliczoną: \(originalRide)").exists)

        tap(app.buttons["Przelicz"])
        let recalculated = app.buttons["Przelicz"]
        let recalculationFinished = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true"), object: recalculated
        )
        XCTAssertEqual(XCTWaiter.wait(for: [recalculationFinished], timeout: 30), .completed,
                       "Route recalculation must finish even if a fresh queue snapshot is unavailable")
        XCTAssertTrue(button(containing: "Dzień 3").exists, "Recalculation retains the declared three-day visit")

        let replacementLabels = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Wymień atrakcję: ")).allElementsBoundByIndex.map(\.label)
        XCTAssertFalse(replacementLabels.isEmpty)
        var didReplace = false
        for label in replacementLabels {
            tap(app.buttons[label])
            XCTAssertTrue(app.buttons["Zamknij"].waitForExistence(timeout: 5))
            let choose = app.buttons["Wybierz"].firstMatch
            if choose.exists {
                capture("10-replacement-options")
                tap(choose)
                XCTAssertFalse(app.buttons[label].exists, "Replacement removes the vetoed ride from this day's route")
                capture("11-replaced-timeline")
                didReplace = true
                break
            }
            XCTAssertTrue(app.staticTexts["Nie ma teraz uczciwego zamiennika blisko trasy."].exists, "Unavailable replacements must be explained without unsafe fallback")
            tap(app.buttons["Zamknij"])
        }
        print(didReplace ? "POGODAPARK_SAFE_REPLACEMENT_PASSED" : "POGODAPARK_ALL_DAY_ONE_REPLACEMENTS_HONESTLY_UNAVAILABLE")

        tap(app.buttons["Przygotuj piękny PDF"])
        XCTAssertTrue(app.buttons["Drukuj / zapisz"].waitForExistence(timeout: 10))
        capture("12-pdf-preview")
        tap(app.buttons["Drukuj / zapisz"])
        let shareSheet = app.otherElements["ActivityListView"]
        let sharedFile = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "PogodaPark-plan")).firstMatch
        XCTAssertTrue(shareSheet.waitForExistence(timeout: 30) || sharedFile.exists, "Native PDF export must open the system share sheet")
        capture("13-native-pdf-share-sheet")
        dumpHierarchy("PDF_SHARE_SHEET")
        print("POGODAPARK_PDF_READY_FOR_QA_COPY — keep system share sheet open; temporary PDF remains in app container")
        // Deliberately do not dismiss: the release operator copies the real PDF
        // from the app's temporary container before the share completion cleanup.
    }

    func test30LocationDenialIsHonest() throws {
        // The release runner explicitly denies location for this QA simulator.
        app.launch()
        tap(app.buttons["Wróć do zapisanego planu"])
        expectHeading("Wasza Energylandia")
        tap(button(containing: "Włącz lokalizację"))
        let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if prompt.waitForExistence(timeout: 5) {
            let deny = prompt.buttons.matching(NSPredicate(format: "label IN %@", ["Nie pozwalaj", "Don't Allow", "Don’t Allow"])).firstMatch
            XCTAssertTrue(deny.exists)
            deny.tap()
        }
        let denial = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Lokalizacja jest zablokowana.")).firstMatch
        XCTAssertTrue(denial.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "GPS włączony")).firstMatch.exists)
        reveal(denial)
        capture("20-location-denied")
    }

    func test35ForegroundLocationDistances() throws {
        // The runner grants foreground permission and supplies a park test fix.
        app.launch()
        tap(app.buttons["Wróć do zapisanego planu"])
        expectHeading("Wasza Energylandia")
        let locate = button(containing: "Włącz lokalizację")
        if locate.exists { tap(locate) }
        let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if prompt.waitForExistence(timeout: 5) {
            let allow = prompt.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "używ", "While Using")).firstMatch
            XCTAssertTrue(allow.exists)
            allow.tap()
        }
        let ready = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "GPS włączony")).firstMatch
        XCTAssertTrue(ready.waitForExistence(timeout: 30))
        XCTAssertTrue(button(containing: "Odśwież GPS").exists)
        capture("21-location-distances")
        dumpHierarchy("GPS_DISTANCES")
        app.terminate()
        app.launch()
        XCTAssertTrue(button(containing: "Decyzja podjęta — ułóż plan").waitForExistence(timeout: 30))
        capture("01-entry")
    }
}
