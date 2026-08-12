import Foundation
import XCTest
@testable import ZabHop

final class StoreHoursTests: XCTestCase {
    func testPublishedStoreManifestMatchesBundledCatalog() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let catalogData = try Data(contentsOf: root.appendingPathComponent("web/stores.json"))
        let manifestData = try Data(contentsOf: root.appendingPathComponent("web/stores-manifest.json"))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let manifest = try decoder.decode(StoreCatalogUpdateService.Manifest.self, from: manifestData)

        XCTAssertNoThrow(try StoreCatalogUpdateService.validate(data: catalogData, manifest: manifest))
        XCTAssertEqual(manifest.storeCount, 13_213)
    }

    func testOfficialMidnightSentinelIsUnknownAndFalseMeansClosed() throws {
        XCTAssertNil(StoreHoursParser.normalizeOfficial([
            "mon-sun": .hours("00:00:00 - 00:00:00")
        ]))

        let sundayAmbiguous = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 23:00:00"),
            "sun": .hours("00:00:00 - 00:00:00")
        ]))
        XCTAssertNil(sundayAmbiguous.days[6])

        let sundayClosed = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 23:00:00"),
            "sun": .closed
        ]))
        XCTAssertEqual(sundayClosed.days[0], "360-1380")
        XCTAssertEqual(sundayClosed.days[6], "")
    }

    func testExplicitOSMAllDayIsDistinctButHasOpenNowCopy() throws {
        let alwaysOpen = try XCTUnwrap(StoreHoursParser.parseOSM("24/7"))
        XCTAssertEqual(alwaysOpen.hours.days, Array(repeating: "0-1440", count: 7))
        XCTAssertEqual(
            alwaysOpen.hours.status(at: isoDate("2026-07-12T00:30:00Z")).label,
            "Otwarte teraz"
        )
    }

    func testParsesCommonOSMHoursAndPublicHolidayClosure() throws {
        let parsed = try XCTUnwrap(StoreHoursParser.parseOSM(
            "Mo-Fr 06:00-23:00; Sa 07:00-22:00; Su,PH off"
        ))

        XCTAssertEqual(
            parsed.hours.days,
            ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "420-1320", ""]
        )
        XCTAssertTrue(parsed.holidaysClosed)
    }

    func testSplitsOvernightOSMRangeAcrossTwoDays() throws {
        let parsed = try XCTUnwrap(StoreHoursParser.parseOSM("Fr 22:00-02:00"))
        XCTAssertEqual(parsed.hours.days[4], "1320-1440")
        XCTAssertEqual(parsed.hours.days[5], "0-120")
    }

    func testLaterOSMRuleOverridesEarlierDayAndItsOvernightSpill() throws {
        let saturdayOverride = try XCTUnwrap(StoreHoursParser.parseOSM(
            "Mo-Sa 07:00-21:00; Sa 09:00-20:00"
        ))
        XCTAssertEqual(saturdayOverride.hours.days[5], "540-1200")

        let spillOverride = try XCTUnwrap(StoreHoursParser.parseOSM(
            "Mo-Fr 05:00-01:00; Sa 05:00-23:30"
        ))
        XCTAssertEqual(spillOverride.hours.days[5], "300-1410")
    }

    func testOvernightSpillAddsToAnExistingTargetDayWithoutClearingIt() throws {
        let parsed = try XCTUnwrap(StoreHoursParser.parseOSM(
            "Mo 06:00-23:30; Tu-Sa 05:00-01:00; Su 06:00-01:00"
        ))

        XCTAssertEqual(parsed.hours.days[0], "0-60,360-1410")
    }

    func testOfficialOvernightHoursKeepPreviousNightAndCurrentDayIntervals() throws {
        let hours = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 02:00:00"),
            "sun": .closed
        ]))

        XCTAssertEqual(hours.days[0], "360-1440")
        XCTAssertEqual(hours.days[1], "0-120,360-1440")
        XCTAssertEqual(hours.days[6], "")
    }

    func testOfficialSundayRuleOverridesSaturdayOvernightSpill() throws {
        let hours = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 02:00:00"),
            "sun": .hours("09:00:00 - 20:00:00")
        ]))

        XCTAssertEqual(hours.days[5], "0-120,360-1440")
        XCTAssertEqual(hours.days[6], "540-1200")
    }

    func testComplexDateSpecificOSMHoursStayUnknown() {
        XCTAssertNil(StoreHoursParser.parseOSM(
            "Mo-Sa 08:00-22:00; Jan 25 Su 09:00-20:00; PH off"
        ))
    }

    func testStatusUsesWarsawTimeZone() throws {
        let hours = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 23:00:00"),
            "sun": .hours("09:00:00 - 22:00:00")
        ]))

        XCTAssertEqual(hours.status(at: isoDate("2026-07-11T20:30:00Z")).state, .open)
        XCTAssertEqual(hours.status(at: isoDate("2026-07-11T21:30:00Z")).state, .closed)
    }

    func testUnknownHoursAreNeverTreatedAsOpen() throws {
        let partial = try XCTUnwrap(StoreHoursParser.normalizeOfficial([
            "mon-sat": .hours("06:00:00 - 23:00:00")
        ]))
        let factualStatus = partial.status(at: isoDate("2026-07-12T10:00:00Z"))
        XCTAssertEqual(factualStatus.state, .unknown)
        XCTAssertEqual(factualStatus.label, "Godziny niepotwierdzone")
        XCTAssertEqual(StoreOpenStatus.unknown.state, .unknown)
    }

    func testProbableZabkaFallbackIsExplicitAndLimitedToSevenUntilTwentyOne() {
        let unknown = StoreOpenStatus.unknown

        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: unknown,
                mode: .zabka,
                availability: .openNow,
                at: isoDate("2026-07-12T04:59:00Z") // 06:59 in Warsaw
            ).state,
            .unknown
        )

        let morning = StoreOpeningPolicy.assessedStatus(
            confirmedStatus: unknown,
            mode: .zabka,
            availability: .openNow,
            at: isoDate("2026-07-12T05:00:00Z") // 07:00 in Warsaw
        )
        XCTAssertEqual(morning.state, .probablyOpen)
        XCTAssertEqual(morning.label, "Prawdopodobnie otwarte · brak godzin")
        XCTAssertTrue(StoreOpeningPolicy.isOpenNowCandidate(morning))

        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: unknown,
                mode: .zabka,
                availability: .openNow,
                at: isoDate("2026-07-12T18:59:00Z") // 20:59 in Warsaw
            ).state,
            .probablyOpen
        )
        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: unknown,
                mode: .zabka,
                availability: .openNow,
                at: isoDate("2026-07-12T19:00:00Z") // 21:00 in Warsaw
            ).state,
            .unknown
        )
    }

    func testProbableFallbackNeverChangesPlanningOtherChainsOrExplicitClosure() {
        let screenshotMoment = isoDate("2026-07-12T07:28:00Z") // 09:28 in Warsaw
        let explicitlyClosed = StoreOpenStatus(
            state: .closed,
            label: "Zamknięte teraz",
            badge: "ZAMKNIĘTE"
        )

        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: .unknown,
                mode: .zabka,
                availability: .planning,
                at: screenshotMoment
            ).state,
            .unknown
        )
        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: .unknown,
                mode: .other,
                availability: .openNow,
                at: screenshotMoment
            ).state,
            .unknown
        )
        XCTAssertEqual(
            StoreOpeningPolicy.assessedStatus(
                confirmedStatus: explicitlyClosed,
                mode: .zabka,
                availability: .openNow,
                at: screenshotMoment
            ).state,
            .closed
        )
        XCTAssertFalse(StoreOpeningPolicy.isOpenNowCandidate(explicitlyClosed))
    }

    func testProbableFallbackIsDisabledOnPolishPublicHolidays() {
        let christmasMorning = isoDate("2026-12-25T08:30:00Z") // 09:30 in Warsaw
        let assessed = StoreOpeningPolicy.assessedStatus(
            confirmedStatus: .unknown,
            mode: .zabka,
            availability: .openNow,
            at: christmasMorning
        )

        XCTAssertEqual(assessed.state, .unknown)
        XCTAssertFalse(StoreOpeningPolicy.isOpenNowCandidate(assessed))
    }

    func testProbableZabkaUsesThreeHundredFiftyMeterConfidencePenalty() {
        let probable = StoreOpenStatus.probablyOpen
        let confirmed = StoreOpenStatus(
            state: .open,
            label: "Otwarte teraz",
            badge: "OTWARTE"
        )

        let unknownAt670 = StoreOpeningPolicy.rankingScore(
            distance: 670,
            assessedStatus: probable,
            availability: .openNow
        )
        XCTAssertEqual(unknownAt670, 1_020)
        XCTAssertLessThan(
            unknownAt670,
            StoreOpeningPolicy.rankingScore(
                distance: 1_200,
                assessedStatus: confirmed,
                availability: .openNow
            )
        )
        XCTAssertGreaterThan(
            unknownAt670,
            StoreOpeningPolicy.rankingScore(
                distance: 900,
                assessedStatus: confirmed,
                availability: .openNow
            )
        )
    }

    func testRecognizesFixedAndMovablePolishHolidays() {
        XCTAssertTrue(StoreHours.isPolishPublicHoliday(year: 2026, month: 12, day: 24))
        XCTAssertTrue(StoreHours.isPolishPublicHoliday(year: 2026, month: 4, day: 6))
        XCTAssertFalse(StoreHours.isPolishPublicHoliday(year: 2026, month: 7, day: 11))
    }

    func testOpenNowFilterRunsBeforeNearestFiveLimit() throws {
        let closedDays = Array(repeating: "", count: 7)
        let openDays = Array(repeating: "0-1440", count: 7)
        let rows: [[Any]] = [
            ["closed-nearest", 52.2009, 21.0313, "Najbliższa", "Warszawa", closedDays],
            ["open-farther", 52.2019, 21.0313, "Dalsza", "Warszawa", openDays]
        ]
        let data = try JSONSerialization.data(withJSONObject: rows)
        let records = try JSONDecoder().decode([BundledStoreRecord].self, from: data)

        let planning = BundledStoreCatalog.nearestRecords(
            in: records,
            latitude: 52.2009,
            longitude: 21.0313,
            limit: 1,
            availability: .planning,
            at: isoDate("2026-07-11T12:00:00Z")
        )
        let openNow = BundledStoreCatalog.nearestRecords(
            in: records,
            latitude: 52.2009,
            longitude: 21.0313,
            limit: 1,
            availability: .openNow,
            at: isoDate("2026-07-11T12:00:00Z")
        )

        XCTAssertEqual(planning.first?.id, "closed-nearest")
        XCTAssertEqual(openNow.first?.id, "open-farther")
    }

    func testLegacyOtherStoreWithoutHoursDecodesAsUnknown() throws {
        let data = Data(#"[{"id":"osm-n-1","name":"Dino","lat":52.2,"lon":21.0,"street":"Testowa 1","town":"Warszawa"}]"#.utf8)
        let record = try XCTUnwrap(JSONDecoder().decode([BundledOtherStoreRecord].self, from: data).first)
        XCTAssertNil(record.hours)
        XCTAssertFalse(record.holidaysClosed)
        XCTAssertEqual(record.openingStatus(at: Date()).state, .unknown)
    }

    func testBundledDolnaStoreCarriesEvaluableOfficialHours() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/stores.json")
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: Data(contentsOf: catalogURL)
        )
        let dolna = try XCTUnwrap(records.first { $0.id == "ZG162" })

        XCTAssertEqual(dolna.openingStatus(at: isoDate("2026-07-11T20:30:00Z")).state, .open)
        XCTAssertEqual(dolna.openingStatus(at: isoDate("2026-07-11T21:30:00Z")).state, .closed)
    }

    func testBundledZatorSundaySentinelRemainsUnknown() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/stores.json")
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: Data(contentsOf: catalogURL)
        )
        let screenshotMoment = isoDate("2026-07-11T22:25:00Z") // Sunday 00:25 in Zator.

        let store = try XCTUnwrap(records.first { $0.id == "ZE315" })
        XCTAssertNil(store.hours?.days[6])
        XCTAssertEqual(store.openingStatus(at: screenshotMoment).state, .unknown)
    }

    func testZatorAtNineTwentyEightRanksNearbyUnknownZabkaAsProbablyOpen() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/stores.json")
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: Data(contentsOf: catalogURL)
        )
        let screenshotMoment = isoDate("2026-07-12T07:28:00Z") // Sunday 09:28 in Zator.
        let janaPawla = try XCTUnwrap(records.first { $0.id == "ZE315" })

        XCTAssertEqual(janaPawla.openingStatus(at: screenshotMoment).state, .unknown)

        let assessed = StoreOpeningPolicy.assessedStatus(
            confirmedStatus: janaPawla.openingStatus(at: screenshotMoment),
            mode: .zabka,
            availability: .openNow,
            at: screenshotMoment
        )
        XCTAssertEqual(assessed.state, .probablyOpen)
        XCTAssertEqual(assessed.label, "Prawdopodobnie otwarte · brak godzin")

        let openNow = BundledStoreCatalog.nearestRecords(
            in: records,
            latitude: 49.9942,
            longitude: 19.4224,
            limit: 5,
            availability: .openNow,
            at: screenshotMoment
        )
        XCTAssertEqual(openNow.first?.id, "ZB158")
        XCTAssertTrue(openNow.contains { $0.id == "ZE315" }, "Closer probably-open store stays available")
        XCTAssertTrue(openNow.contains { $0.id == "Z3298" }, "Confirmed-open Wadowicka store stays available")
    }

    func testBundledStaleOSMAllDayClaimsFromScreenshotStayUnknown() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/other-stores.json")
        let records = try JSONDecoder().decode(
            [BundledOtherStoreRecord].self,
            from: Data(contentsOf: catalogURL)
        )

        for id in [
            "osm-n-2696878132", "osm-w-889502145", "osm-n-12805812035",
            "osm-n-3368741951", "osm-n-2000515371"
        ] {
            let store = try XCTUnwrap(records.first { $0.id == id })
            XCTAssertNil(store.hours, "\(id) must remain unconfirmed")
            XCTAssertEqual(store.openingStatus(at: isoDate("2026-07-11T22:25:00Z")).state, .unknown)
        }

        let recentlyChecked = try XCTUnwrap(records.first { $0.id == "osm-n-5254419323" })
        XCTAssertEqual(recentlyChecked.hours?.days, Array(repeating: "0-1440", count: 7))
    }

    private func isoDate(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }
}
