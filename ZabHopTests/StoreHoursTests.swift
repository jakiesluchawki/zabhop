import Foundation
import XCTest
@testable import ZabHop

final class StoreHoursTests: XCTestCase {
    func testPublishedStoreManifestMatchesBundledCatalog() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let catalogURL = root.appendingPathComponent("stores.json")
        let catalogData = try Data(contentsOf: catalogURL)
        let manifestData = try Data(contentsOf: root.appendingPathComponent("stores-manifest.json"))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let manifest = try decoder.decode(StoreCatalogUpdateService.Manifest.self, from: manifestData)

        XCTAssertNoThrow(try StoreCatalogUpdateService.validate(data: catalogData, manifest: manifest))
        XCTAssertEqual(manifest.storeCount, try JSONDecoder().decode([BundledStoreRecord].self, from: catalogData).count)
        XCTAssertGreaterThanOrEqual(manifest.storeCount, 10_000)
        XCTAssertTrue(try StoreCatalogUpdateService.catalog(at: catalogURL, matches: manifest))
        XCTAssertTrue(try StoreCatalogUpdateService.catalog(
            at: root.appendingPathComponent("ZabHop/Resources/stores.json"),
            matches: manifest
        ))
    }

    func testPublishedOtherStoreManifestMatchesBundledCatalog() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let catalogURL = root.appendingPathComponent("other-stores.json")
        let catalogData = try Data(contentsOf: catalogURL)
        let manifestData = try Data(contentsOf: root.appendingPathComponent("other-stores-manifest.json"))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let manifest = try decoder.decode(StoreCatalogUpdateService.Manifest.self, from: manifestData)

        XCTAssertNoThrow(try StoreCatalogUpdateService.validate(data: catalogData, manifest: manifest, for: .other))
        XCTAssertEqual(manifest.storeCount, try JSONDecoder().decode([BundledOtherStoreRecord].self, from: catalogData).count)
        XCTAssertTrue(try StoreCatalogUpdateService.catalog(
            at: root.appendingPathComponent("ZabHop/Resources/other-stores.json"),
            matches: manifest
        ))
    }

    func testCatalogKindsUseRawGitHubAndIndependentRefreshIntervals() {
        XCTAssertEqual(
            StoreCatalogUpdateService.catalogBaseURL.absoluteString,
            "https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/"
        )
        XCTAssertEqual(StoreCatalogUpdateService.Catalog.zabka.successfulCheckInterval, 86_400)
        XCTAssertEqual(StoreCatalogUpdateService.Catalog.other.successfulCheckInterval, 604_800)
        XCTAssertEqual(StoreCatalogUpdateService.Catalog.other.manifestPath, "other-stores-manifest.json")
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

    func testOpenStoreWarnsWhenClosingWithinFortyFiveMinutes() throws {
        let hours = try XCTUnwrap(StoreHours(Array(repeating: "360-1380", count: 7)))
        let status = hours.status(at: isoDate("2026-07-11T20:48:00Z")) // 22:48 in Warsaw.

        XCTAssertEqual(status.state, .open)
        XCTAssertEqual(status.transition, StoreOpeningTransition(kind: .closing, minutesRemaining: 12))
        XCTAssertEqual(status.label, "Zamyka się za 12 min")
        XCTAssertEqual(status.badge, "ZAMYKA ZA 12 MIN")
    }

    func testClosedStoreWarnsWhenOpeningWithinAnHour() throws {
        let hours = try XCTUnwrap(StoreHours(Array(repeating: "360-1380", count: 7)))
        let status = hours.status(at: isoDate("2026-07-11T03:38:00Z")) // 05:38 in Warsaw.

        XCTAssertEqual(status.state, .closed)
        XCTAssertEqual(status.transition, StoreOpeningTransition(kind: .opening, minutesRemaining: 22))
        XCTAssertEqual(status.label, "Otwiera się za 22 min")
    }

    func testOvernightContinuationDoesNotFalselyWarnAtMidnight() throws {
        let hours = try XCTUnwrap(StoreHours([
            "360-1440", "0-120,360-1440", "0-120,360-1440",
            "0-120,360-1440", "0-120,360-1440", "0-120,360-1440", "0-120"
        ]))
        let status = hours.status(at: isoDate("2026-07-10T21:45:00Z")) // Friday 23:45.

        XCTAssertEqual(status.state, .open)
        XCTAssertNil(status.transition)
    }

    func testTwentyFourHourStoreNeverShowsClosingSoon() throws {
        let hours = try XCTUnwrap(StoreHours(Array(repeating: "0-1440", count: 7)))
        let status = hours.status(at: isoDate("2026-07-10T21:55:00Z")) // Friday 23:55.

        XCTAssertEqual(status.state, .open)
        XCTAssertNil(status.transition)
        XCTAssertEqual(status.label, "Otwarte teraz")
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

    func testOtherStoresWithUnknownHoursRemainVisibleBehindNearbyConfirmedStores() throws {
        let openDays = Array(repeating: "0-1440", count: 7)
        let closedDays = Array(repeating: "", count: 7)
        let rows: [[String: Any]] = [
            ["id": "unknown-nearest", "name": "Biedronka", "lat": 52.2001, "lon": 21.0,
             "street": "Bliska 1", "town": "Warszawa"],
            ["id": "open-nearby", "name": "Lidl", "lat": 52.203, "lon": 21.0,
             "street": "Pewna 2", "town": "Warszawa", "hours": openDays],
            ["id": "closed-nearest", "name": "Dino", "lat": 52.20005, "lon": 21.0,
             "street": "Zamknięta 3", "town": "Warszawa", "hours": closedDays]
        ]
        let data = try JSONSerialization.data(withJSONObject: rows)
        let records = try JSONDecoder().decode([BundledOtherStoreRecord].self, from: data)

        let ranked = BundledOtherStoreCatalog.nearestRecords(
            in: records,
            latitude: 52.2,
            longitude: 21.0,
            limit: 5,
            availability: .openNow,
            at: isoDate("2026-07-11T12:00:00Z")
        )

        XCTAssertEqual(ranked.map(\.id), ["open-nearby", "unknown-nearest"])
        XCTAssertEqual(ranked.last?.openingStatus(at: Date()).label, "Godziny niepotwierdzone")
        XCTAssertTrue(StoreOpeningPolicy.isOpenNowCandidate(.unknown, mode: .other))
        XCTAssertFalse(StoreOpeningPolicy.isOpenNowCandidate(.unknown, mode: .zabka))
    }

    func testShopClosingBeforeWalkingArrivalReceivesDistancePenalty() {
        let closesBeforeArrival = StoreOpenStatus(
            state: .open,
            label: "Zamyka się za 12 min",
            badge: "ZAMYKA ZA 12 MIN",
            transition: StoreOpeningTransition(kind: .closing, minutesRemaining: 12)
        )
        let reachableBeforeClosing = StoreOpenStatus(
            state: .open,
            label: "Zamyka się za 20 min",
            badge: "ZAMYKA ZA 20 MIN",
            transition: StoreOpeningTransition(kind: .closing, minutesRemaining: 20)
        )

        XCTAssertEqual(
            StoreOpeningPolicy.rankingScore(
                distance: 1_100,
                assessedStatus: closesBeforeArrival,
                availability: .openNow
            ),
            2_500
        )
        XCTAssertEqual(
            StoreOpeningPolicy.rankingScore(
                distance: 1_100,
                assessedStatus: reachableBeforeClosing,
                availability: .openNow
            ),
            1_100
        )
        XCTAssertEqual(
            StoreOpeningPolicy.rankingScore(
                distance: 1_100,
                assessedStatus: closesBeforeArrival,
                availability: .planning
            ),
            1_100
        )
        XCTAssertEqual(
            StoreOpeningPolicy.rankingScore(
                distance: 20,
                assessedStatus: StoreOpenStatus(
                    state: .open,
                    label: "Zamyka się za 1 min",
                    badge: "ZAMYKA ZA 1 MIN",
                    transition: StoreOpeningTransition(kind: .closing, minutesRemaining: 1)
                ),
                availability: .openNow
            ),
            20
        )
    }

    func testBothCatalogsPreferStoresReachableBeforeClosing() throws {
        let closingHours = Array(repeating: "480-1200", count: 7)
        let laterHours = Array(repeating: "480-1380", count: 7)
        let date = isoDate("2026-08-24T17:48:00Z") // 19:48 in Warsaw.

        let zabkaRows: [[Any]] = [
            ["closes-before-arrival", 52.2099, 21.0, "Zamykana 1", "Warszawa", closingHours],
            ["stays-open", 52.212, 21.0, "Dłużej 2", "Warszawa", laterHours]
        ]
        let zabkaRecords = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: JSONSerialization.data(withJSONObject: zabkaRows)
        )
        let rankedZabkas = BundledStoreCatalog.nearestRecords(
            in: zabkaRecords,
            latitude: 52.2,
            longitude: 21.0,
            limit: 2,
            availability: .openNow,
            at: date
        )
        XCTAssertEqual(rankedZabkas.map(\.id), ["stays-open", "closes-before-arrival"])

        let otherRows: [[String: Any]] = [
            ["id": "closes-before-arrival", "name": "Biedronka", "lat": 52.2099, "lon": 21.0,
             "street": "Zamykana 1", "town": "Warszawa", "hours": closingHours],
            ["id": "stays-open", "name": "Lidl", "lat": 52.212, "lon": 21.0,
             "street": "Dłużej 2", "town": "Warszawa", "hours": laterHours]
        ]
        let otherRecords = try JSONDecoder().decode(
            [BundledOtherStoreRecord].self,
            from: JSONSerialization.data(withJSONObject: otherRows)
        )
        let rankedOtherStores = BundledOtherStoreCatalog.nearestRecords(
            in: otherRecords,
            latitude: 52.2,
            longitude: 21.0,
            limit: 2,
            availability: .openNow,
            at: date
        )
        XCTAssertEqual(rankedOtherStores.map(\.id), ["stays-open", "closes-before-arrival"])
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

    func testBundledCatalogContainsEvaluableOfficialHours() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/stores.json")
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: Data(contentsOf: catalogURL)
        )
        let storeWithKnownSaturday = try XCTUnwrap(records.first {
            $0.hours?.days[5] != nil
        })
        let status = storeWithKnownSaturday.openingStatus(at: isoDate("2026-07-11T12:30:00Z"))

        XCTAssertTrue(status.state == .open || status.state == .closed)
    }

    func testUnknownSundayFixtureRemainsUnknown() throws {
        let rows: [[Any]] = [[
            "unknown-sunday", 49.9942, 19.4224, "Jana Pawła II", "Zator",
            ["360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", NSNull()]
        ]]
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: JSONSerialization.data(withJSONObject: rows)
        )
        let screenshotMoment = isoDate("2026-07-11T22:25:00Z") // Sunday 00:25 in Zator.

        let store = try XCTUnwrap(records.first)
        XCTAssertNil(store.hours?.days[6])
        XCTAssertEqual(store.openingStatus(at: screenshotMoment).state, .unknown)
    }

    func testNearbyUnknownZabkaRanksAsProbablyOpenUsingStableFixture() throws {
        let allDay = Array(repeating: "0-1440", count: 7)
        let unknownSunday: [Any] = [
            "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", "360-1380", NSNull()
        ]
        let rows: [[Any]] = [
            ["confirmed-nearby", 49.9972, 19.4224, "Pewna", "Zator", allDay],
            ["unknown-closer", 49.9952, 19.4224, "Bliska", "Zator", unknownSunday],
            ["confirmed-farther", 50.0002, 19.4224, "Dalsza", "Zator", allDay]
        ]
        let records = try JSONDecoder().decode(
            [BundledStoreRecord].self,
            from: JSONSerialization.data(withJSONObject: rows)
        )
        let screenshotMoment = isoDate("2026-07-12T07:28:00Z") // Sunday 09:28 in Zator.
        let janaPawla = try XCTUnwrap(records.first { $0.id == "unknown-closer" })

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
        XCTAssertEqual(openNow.first?.id, "confirmed-nearby")
        XCTAssertTrue(openNow.contains { $0.id == "unknown-closer" }, "Closer probably-open store stays available")
        XCTAssertTrue(openNow.contains { $0.id == "confirmed-farther" }, "Confirmed-open store stays available")
    }

    func testOtherStoreFixturesKeepUnconfirmedAndVerifiedAllDayHoursDistinct() throws {
        let rows: [[String: Any]] = [
            ["id": "unconfirmed", "name": "Dino", "lat": 49.9942, "lon": 19.4224,
             "street": "Testowa 1", "town": "Zator"],
            ["id": "verified-all-day", "name": "Carrefour Express", "lat": 49.9952, "lon": 19.4224,
             "street": "Testowa 2", "town": "Zator", "hours": Array(repeating: "0-1440", count: 7)]
        ]
        let records = try JSONDecoder().decode(
            [BundledOtherStoreRecord].self,
            from: JSONSerialization.data(withJSONObject: rows)
        )

        let unconfirmed = try XCTUnwrap(records.first { $0.id == "unconfirmed" })
        XCTAssertNil(unconfirmed.hours)
        XCTAssertEqual(unconfirmed.openingStatus(at: isoDate("2026-07-11T22:25:00Z")).state, .unknown)

        let recentlyChecked = try XCTUnwrap(records.first { $0.id == "verified-all-day" })
        XCTAssertEqual(recentlyChecked.hours?.days, Array(repeating: "0-1440", count: 7))
    }

    private func isoDate(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }
}
