import CoreLocation
import Foundation
import XCTest
@testable import ZabHop

final class GeoMathTests: XCTestCase {
    func testCardinalBearings() {
        let origin = CLLocationCoordinate2D(latitude: 0, longitude: 0)

        XCTAssertEqual(GeoMath.bearing(from: origin, to: .init(latitude: 1, longitude: 0)), 0, accuracy: 0.001)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: .init(latitude: 0, longitude: 1)), 90, accuracy: 0.001)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: .init(latitude: -1, longitude: 0)), 180, accuracy: 0.001)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: .init(latitude: 0, longitude: -1)), 270, accuracy: 0.001)
    }

    func testCompassRotationUsesDeviceHeading() {
        XCTAssertEqual(GeoMath.compassRotation(targetBearing: 90, deviceHeading: 30), 60, accuracy: 0.001)
        XCTAssertEqual(GeoMath.compassRotation(targetBearing: 5, deviceHeading: 355), 10, accuracy: 0.001)
        XCTAssertEqual(GeoMath.compassRotation(targetBearing: 355, deviceHeading: 5), -10, accuracy: 0.001)
    }

    func testUnwrappedRotationNeverTakesTheLongWayAround() {
        XCTAssertEqual(GeoMath.unwrappedAngle(current: 359, target: 1), 361, accuracy: 0.001)
        XCTAssertEqual(GeoMath.unwrappedAngle(current: -179, target: 179), -181, accuracy: 0.001)
    }

    func testHeadingFilterIgnoresNoiseAndPoorAccuracy() {
        var filter = HeadingFilter()
        XCTAssertEqual(filter.update(rawHeading: 100, accuracy: 8, timestamp: 0), 100)
        XCTAssertNil(filter.update(rawHeading: 101.2, accuracy: 8, timestamp: 0.1))
        XCTAssertNil(filter.update(rawHeading: 140, accuracy: 80, timestamp: 0.2))
        XCTAssertEqual(filter.value, 100)
    }

    func testHeadingFilterCrossesNorthUsingCircularMath() throws {
        var filter = HeadingFilter(spikeThreshold: 90)
        XCTAssertEqual(filter.update(rawHeading: 358, accuracy: 5, timestamp: 0), 358)
        let filtered = try XCTUnwrap(filter.update(rawHeading: 2, accuracy: 5, timestamp: 0.1))
        XCTAssertLessThan(abs(GeoMath.normalizeSigned(filtered - 358)), 4)
    }

    func testHeadingFilterRejectsAOneOffSpikeThenAcceptsAConfirmedTurn() throws {
        var filter = HeadingFilter()
        XCTAssertEqual(filter.update(rawHeading: 20, accuracy: 6, timestamp: 0), 20)
        XCTAssertNil(filter.update(rawHeading: 148, accuracy: 6, timestamp: 0.1))
        XCTAssertEqual(filter.value, 20)
        let confirmed = try XCTUnwrap(filter.update(rawHeading: 152, accuracy: 6, timestamp: 0.2))
        XCTAssertGreaterThan(confirmed, 20)
        XCTAssertLessThan(confirmed, 152)
    }

    func testHeadingFilterRestartsAfterTheAppWasSuspended() {
        var filter = HeadingFilter()
        XCTAssertEqual(filter.update(rawHeading: 30, accuracy: 8, timestamp: 0), 30)
        XCTAssertEqual(filter.update(rawHeading: 210, accuracy: 8, timestamp: 2), 210)
    }

    func testDistanceFormatting() {
        XCTAssertEqual(GeoMath.formattedDistance(47), "45 m")
        XCTAssertEqual(GeoMath.formattedDistance(1_240), "1,2 km")
    }

    func testWalkingDurationUsesImmediateOfflineEstimate() {
        XCTAssertEqual(GeoMath.estimatedWalkingDuration(for: 675), 600, accuracy: 0.001)
        XCTAssertEqual(GeoMath.estimatedWalkingDuration(for: -10), 0)
        XCTAssertEqual(GeoMath.formattedWalkingDuration(1), "1 min")
        XCTAssertEqual(GeoMath.formattedWalkingDuration(600), "10 min")
        XCTAssertEqual(GeoMath.formattedWalkingDuration(3_900), "1 godz. 5 min")
    }

    func testBundledCatalogReturnsFiveNearestStoresInDistanceOrder() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/stores.json")
        let data = try Data(contentsOf: catalogURL)
        let records = try JSONDecoder().decode([BundledStoreRecord].self, from: data)

        let nearest = BundledStoreCatalog.nearestRecords(
            in: records,
            latitude: 52.200902,
            longitude: 21.0313,
            limit: 5
        )

        XCTAssertEqual(nearest.count, 5)
        XCTAssertTrue(nearest.allSatisfy { !$0.id.isEmpty && !$0.formattedAddress.isEmpty })
        let distances = nearest.map { $0.distance(latitude: 52.200902, longitude: 21.0313) }
        XCTAssertEqual(distances, distances.sorted())
    }

    func testBundledOtherCatalogReturnsNearestValidStores() throws {
        let catalogURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ZabHop/Resources/other-stores.json")
        let data = try Data(contentsOf: catalogURL)
        let records = try JSONDecoder().decode([BundledOtherStoreRecord].self, from: data)

        let nearest = BundledOtherStoreCatalog.nearestRecords(
            in: records,
            latitude: 52.200902,
            longitude: 21.0313,
            limit: 5
        )

        XCTAssertGreaterThanOrEqual(records.count, 10_000)
        XCTAssertEqual(nearest.count, 5)
        XCTAssertTrue(nearest.allSatisfy { !$0.name.isEmpty && !$0.formattedAddress.isEmpty })
        XCTAssertEqual(Set(nearest.map(\.id)).count, nearest.count)
    }
}
