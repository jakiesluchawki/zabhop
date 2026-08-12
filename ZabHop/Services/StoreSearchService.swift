import CoreLocation
import Foundation
import MapKit

@MainActor
final class StoreSearchService: ObservableObject {
    enum State: Equatable {
        case idle
        case searching
        case ready
        case empty
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var stores: [Store] = []

    private var activeSearch: MKLocalSearch?
    private var lastSearchLocation: CLLocation?
    private var lastSearchMode: StoreMode?
    private var lastSearchAvailability: StoreAvailability?
    private var lastSearchDate: Date?
    private var bundledRecords: [BundledStoreRecord]?
    private var bundledOtherRecords: [BundledOtherStoreRecord]?
    private var searchGeneration = 0
    private let catalogUpdater = StoreCatalogUpdateService()

    func refreshCatalogIfNeeded() async -> Bool {
        switch await catalogUpdater.checkForUpdate() {
        case .updated(let url):
            do {
                bundledRecords = try await BundledStoreCatalog.load(from: url)
                return true
            } catch {
                return false
            }
        case .notDue, .unchanged, .failed:
            return false
        }
    }

    func search(
        near location: CLLocation,
        mode: StoreMode,
        availability: StoreAvailability,
        force: Bool = false,
        at date: Date = Date()
    ) async {
        if lastSearchMode != mode || lastSearchAvailability != availability {
            activeSearch?.cancel()
            stores = []
            lastSearchLocation = nil
            lastSearchMode = mode
            lastSearchAvailability = availability
            lastSearchDate = nil
        }

        if !force,
           let lastSearchLocation,
           lastSearchLocation.distance(from: location) < 250,
           let lastSearchDate,
           Int(lastSearchDate.timeIntervalSince1970 / 60) == Int(date.timeIntervalSince1970 / 60) {
            return
        }

        activeSearch?.cancel()
        searchGeneration &+= 1
        let generation = searchGeneration
        state = .searching
        lastSearchLocation = location
        lastSearchDate = date

        do {
            let bundledStores = try await nearestBundledStores(
                to: location,
                mode: mode,
                availability: availability,
                at: date
            )
            guard generation == searchGeneration else { return }

            if !bundledStores.isEmpty {
                stores = bundledStores
                state = .ready
                return
            }
        } catch is CancellationError {
            return
        } catch {
            // A missing or malformed local catalog must not make the search unusable.
            // Apple Maps remains the network fallback below.
        }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = mode.mapsQuery
        request.resultTypes = .pointOfInterest
        if mode == .other {
            request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.foodMarket])
        }
        request.region = MKCoordinateRegion(
            center: location.coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        )

        let search = MKLocalSearch(request: request)
        activeSearch = search

        do {
            let response = try await search.start()
            guard generation == searchGeneration else { return }
            let candidates = response.mapItems
                .filter { mode == .zabka ? Self.looksLikeZabka($0) : Self.looksLikeOtherChain($0) }
                .map(Store.init)

            let ranked = Self.deduplicated(candidates)
                .map { store in
                    let distance = store.distance(from: location)
                    let assessedStatus = store.assessedOpeningStatus(
                        at: date,
                        mode: mode,
                        availability: availability
                    )
                    return (
                        store: store,
                        distance: distance,
                        score: StoreOpeningPolicy.rankingScore(
                            distance: distance,
                            assessedStatus: assessedStatus,
                            availability: availability
                        ),
                        assessedStatus: assessedStatus
                    )
                }
                .filter {
                    availability == .planning || StoreOpeningPolicy.isOpenNowCandidate($0.assessedStatus)
                }
                .sorted { lhs, rhs in
                    if lhs.score != rhs.score { return lhs.score < rhs.score }
                    if lhs.distance != rhs.distance { return lhs.distance < rhs.distance }
                    return lhs.store.id < rhs.store.id
                }

            stores = ranked
                .prefix(5)
                .map(\.store)

            state = stores.isEmpty ? .empty : .ready
        } catch is CancellationError {
            return
        } catch let error as MKError where error.code == .loadingThrottled {
            guard generation == searchGeneration else { return }
            state = stores.isEmpty
                ? .failed("Mapy potrzebują chwili oddechu. Spróbuj ponownie za moment.")
                : .ready
        } catch {
            guard generation == searchGeneration else { return }
            state = stores.isEmpty
                ? .failed("Nie udało się teraz pobrać sklepów. Sprawdź internet i spróbuj ponownie.")
                : .ready
        }
    }

    func retry(near location: CLLocation?, mode: StoreMode, availability: StoreAvailability) {
        guard let location else { return }
        Task {
            await search(
                near: location,
                mode: mode,
                availability: availability,
                force: true
            )
        }
    }

    private func nearestBundledStores(
        to location: CLLocation,
        mode: StoreMode,
        availability: StoreAvailability,
        at date: Date
    ) async throws -> [Store] {
        if mode == .other {
            return try await nearestBundledOtherStores(
                to: location,
                availability: availability,
                at: date
            )
        }

        let records: [BundledStoreRecord]
        if let bundledRecords {
            records = bundledRecords
        } else {
            if let installedURL = await catalogUpdater.installedCatalogURL(),
               let installedRecords = try? await BundledStoreCatalog.load(from: installedURL) {
                records = installedRecords
            } else if let bundledURL = Self.bundledStoreCatalogURL() {
                records = try await BundledStoreCatalog.load(from: bundledURL)
            } else {
                throw BundledStoreCatalogError.resourceMissing
            }
            bundledRecords = records
        }

        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let nearest = try await Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            return BundledStoreCatalog.nearestRecords(
                in: records,
                latitude: latitude,
                longitude: longitude,
                limit: 5,
                availability: availability,
                at: date
            )
        }.value

        return nearest.map { record in
            Store(
                id: record.id,
                address: record.formattedAddress,
                coordinate: CLLocationCoordinate2D(
                    latitude: record.latitude,
                    longitude: record.longitude
                ),
                hours: record.hours
            )
        }
    }

    private func nearestBundledOtherStores(
        to location: CLLocation,
        availability: StoreAvailability,
        at date: Date
    ) async throws -> [Store] {
        let records: [BundledOtherStoreRecord]
        if let bundledOtherRecords {
            records = bundledOtherRecords
        } else {
            guard let resourceURL = Self.bundledOtherStoreCatalogURL() else {
                throw BundledStoreCatalogError.resourceMissing
            }

            records = try await BundledOtherStoreCatalog.load(from: resourceURL)
            bundledOtherRecords = records
        }

        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let nearest = try await Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            return BundledOtherStoreCatalog.nearestRecords(
                in: records,
                latitude: latitude,
                longitude: longitude,
                limit: 5,
                availability: availability,
                at: date
            )
        }.value

        return nearest.map { record in
            Store(
                id: record.id,
                name: record.name,
                address: record.formattedAddress,
                coordinate: CLLocationCoordinate2D(
                    latitude: record.latitude,
                    longitude: record.longitude
                ),
                hours: record.hours,
                holidaysClosed: record.holidaysClosed
            )
        }
    }

    private static func bundledStoreCatalogURL() -> URL? {
        Bundle.main.url(forResource: "stores", withExtension: "json")
            ?? Bundle.main.url(forResource: "stores", withExtension: "json", subdirectory: "Resources")
    }

    private static func bundledOtherStoreCatalogURL() -> URL? {
        Bundle.main.url(forResource: "other-stores", withExtension: "json")
            ?? Bundle.main.url(forResource: "other-stores", withExtension: "json", subdirectory: "Resources")
    }

    private static func looksLikeZabka(_ item: MKMapItem) -> Bool {
        let searchable = searchableText(for: item)
        return searchable.contains("zabka") || searchable.contains("żabka")
    }

    private static func looksLikeOtherChain(_ item: MKMapItem) -> Bool {
        let searchable = searchableText(for: item)
        let chainTokens = [
            "biedronka", "lidl", "dino", "stokrotka", "carrefour", "aldi",
            "kaufland", "netto", "auchan", "lewiatan", "delikatesy centrum",
            "spar", "intermarche", "polomarket", "top market"
        ]
        return chainTokens.contains { searchable.contains($0) }
    }

    private static func searchableText(for item: MKMapItem) -> String {
        [item.name, item.placemark.name]
            .compactMap { $0 }
            .joined(separator: " ")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .lowercased()
    }

    private static func deduplicated(_ stores: [Store]) -> [Store] {
        var result: [Store] = []
        for store in stores {
            let location = CLLocation(latitude: store.coordinate.latitude, longitude: store.coordinate.longitude)
            let alreadyExists = result.contains { existing in
                let existingLocation = CLLocation(latitude: existing.coordinate.latitude, longitude: existing.coordinate.longitude)
                return existingLocation.distance(from: location) < 20
            }
            if !alreadyExists {
                result.append(store)
            }
        }
        return result
    }
}

enum BundledStoreCatalogError: Error {
    case resourceMissing
}

struct BundledStoreRecord: Decodable, Sendable {
    let id: String
    let latitude: Double
    let longitude: Double
    let street: String
    let town: String
    let hours: StoreHours?

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        id = try container.decode(String.self)
        latitude = try container.decode(Double.self)
        longitude = try container.decode(Double.self)
        street = try container.decode(String.self)
        town = try container.decode(String.self)
        if !container.isAtEnd,
           let encodedDays = try container.decodeIfPresent([String?].self) {
            hours = StoreHours(encodedDays)
        } else {
            hours = nil
        }
    }

    var formattedAddress: String {
        let address = [street, town]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        return address.isEmpty ? "Adres dostępny w Mapach" : address
    }

    func distance(latitude targetLatitude: Double, longitude targetLongitude: Double) -> Double {
        let sourceLatitude = latitude * .pi / 180
        let targetLatitude = targetLatitude * .pi / 180
        let latitudeDelta = targetLatitude - sourceLatitude
        let longitudeDelta = (targetLongitude - longitude) * .pi / 180
        let haversine = pow(sin(latitudeDelta / 2), 2)
            + cos(sourceLatitude) * cos(targetLatitude) * pow(sin(longitudeDelta / 2), 2)
        let clamped = min(1, max(0, haversine))
        return 2 * 6_371_000 * atan2(sqrt(clamped), sqrt(1 - clamped))
    }

    func openingStatus(at date: Date) -> StoreOpenStatus {
        hours?.status(at: date) ?? .unknown
    }
}

struct BundledOtherStoreRecord: Decodable, Sendable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let street: String
    let town: String
    let hours: StoreHours?
    let holidaysClosed: Bool

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case latitude = "lat"
        case longitude = "lon"
        case street
        case town
        case hours
        case holidaysClosed
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        latitude = try container.decode(Double.self, forKey: .latitude)
        longitude = try container.decode(Double.self, forKey: .longitude)
        street = try container.decode(String.self, forKey: .street)
        town = try container.decode(String.self, forKey: .town)
        if let encodedDays = try container.decodeIfPresent([String?].self, forKey: .hours) {
            hours = StoreHours(encodedDays)
        } else {
            hours = nil
        }
        holidaysClosed = try container.decodeIfPresent(Bool.self, forKey: .holidaysClosed) ?? false
    }

    var formattedAddress: String {
        let address = [street, town]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        return address.isEmpty ? "Adres dostępny w Mapach" : address
    }

    func distance(latitude targetLatitude: Double, longitude targetLongitude: Double) -> Double {
        let sourceLatitude = latitude * .pi / 180
        let targetLatitude = targetLatitude * .pi / 180
        let latitudeDelta = targetLatitude - sourceLatitude
        let longitudeDelta = (targetLongitude - longitude) * .pi / 180
        let haversine = pow(sin(latitudeDelta / 2), 2)
            + cos(sourceLatitude) * cos(targetLatitude) * pow(sin(longitudeDelta / 2), 2)
        let clamped = min(1, max(0, haversine))
        return 2 * 6_371_000 * atan2(sqrt(clamped), sqrt(1 - clamped))
    }

    func openingStatus(at date: Date) -> StoreOpenStatus {
        hours?.status(at: date, holidaysClosed: holidaysClosed) ?? .unknown
    }
}

enum BundledStoreCatalog {
    static func load(from url: URL) async throws -> [BundledStoreRecord] {
        try await Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            try Task.checkCancellation()
            return try JSONDecoder().decode([BundledStoreRecord].self, from: data)
        }.value
    }

    static func nearestRecords(
        in records: [BundledStoreRecord],
        latitude: Double,
        longitude: Double,
        limit: Int,
        availability: StoreAvailability = .planning,
        at date: Date = Date()
    ) -> [BundledStoreRecord] {
        guard limit > 0 else { return [] }
        let moment = StoreHours.evaluationMoment(at: date)

        return records
            .map { record in
                let distance = record.distance(latitude: latitude, longitude: longitude)
                let confirmedStatus = moment.flatMap { moment in
                    record.hours?.status(at: moment)
                } ?? .unknown
                let assessedStatus = StoreOpeningPolicy.assessedStatus(
                    confirmedStatus: confirmedStatus,
                    mode: .zabka,
                    availability: availability,
                    at: moment
                )
                return (
                    record: record,
                    distance: distance,
                    score: StoreOpeningPolicy.rankingScore(
                        distance: distance,
                        assessedStatus: assessedStatus,
                        availability: availability
                    ),
                    assessedStatus: assessedStatus
                )
            }
            .filter {
                availability == .planning || StoreOpeningPolicy.isOpenNowCandidate($0.assessedStatus)
            }
            .sorted { lhs, rhs in
                if lhs.score != rhs.score { return lhs.score < rhs.score }
                if lhs.distance != rhs.distance { return lhs.distance < rhs.distance }
                return lhs.record.id < rhs.record.id
            }
            .prefix(limit)
            .map(\.record)
    }
}

enum BundledOtherStoreCatalog {
    static func load(from url: URL) async throws -> [BundledOtherStoreRecord] {
        try await Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            try Task.checkCancellation()
            return try JSONDecoder().decode([BundledOtherStoreRecord].self, from: data)
        }.value
    }

    static func nearestRecords(
        in records: [BundledOtherStoreRecord],
        latitude: Double,
        longitude: Double,
        limit: Int,
        availability: StoreAvailability = .planning,
        at date: Date = Date()
    ) -> [BundledOtherStoreRecord] {
        guard limit > 0 else { return [] }
        let moment = StoreHours.evaluationMoment(at: date)

        return records
            .filter { record in
                guard availability == .openNow else { return true }
                guard let moment, let hours = record.hours else { return false }
                return hours.status(
                    at: moment,
                    holidaysClosed: record.holidaysClosed
                ).state == .open
            }
            .map { record in
                (record: record, distance: record.distance(latitude: latitude, longitude: longitude))
            }
            .sorted { lhs, rhs in
                if lhs.distance == rhs.distance {
                    return lhs.record.id < rhs.record.id
                }
                return lhs.distance < rhs.distance
            }
            .prefix(limit)
            .map(\.record)
    }
}
