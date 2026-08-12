import CoreLocation
import Foundation
import MapKit

enum StoreMode: String, CaseIterable, Identifiable, Sendable {
    case zabka
    case other

    var id: String { rawValue }

    var buttonTitle: String {
        switch self {
        case .zabka: "Żabka"
        case .other: "Inne sklepy"
        }
    }

    var nearestTitle: String {
        switch self {
        case .zabka: "NAJBLIŻSZA ŻABKA"
        case .other: "NAJBLIŻSZY INNY SKLEP"
        }
    }

    var pickerTitle: String {
        switch self {
        case .zabka: "Wybierz Żabkę"
        case .other: "Wybierz sklep"
        }
    }

    var mapsQuery: String {
        switch self {
        case .zabka: "Żabka"
        case .other: "supermarket"
        }
    }
}

struct Store: Identifiable, Hashable {
    let id: String
    let name: String
    let address: String
    let coordinate: CLLocationCoordinate2D
    let mapItem: MKMapItem
    let hours: StoreHours?
    let holidaysClosed: Bool

    init(mapItem: MKMapItem) {
        let coordinate = mapItem.placemark.coordinate
        self.id = Store.makeIdentifier(for: mapItem)
        self.name = mapItem.name?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Żabka"
        self.address = Store.makeAddress(from: mapItem.placemark)
        self.coordinate = coordinate
        self.mapItem = mapItem
        self.hours = nil
        self.holidaysClosed = false
    }

    init(
        id: String,
        name: String = "Żabka",
        address: String,
        coordinate: CLLocationCoordinate2D,
        hours: StoreHours? = nil,
        holidaysClosed: Bool = false
    ) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let mapItem: MKMapItem
        if #available(iOS 26.0, macOS 26.0, *) {
            mapItem = MKMapItem(location: location, address: nil)
        } else {
            mapItem = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        }
        mapItem.name = name

        self.id = id
        self.name = name
        self.address = address
        self.coordinate = coordinate
        self.mapItem = mapItem
        self.hours = hours
        self.holidaysClosed = holidaysClosed
    }

    func distance(from location: CLLocation) -> CLLocationDistance {
        CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            .distance(from: location)
    }

    func openingStatus(at date: Date = Date()) -> StoreOpenStatus {
        hours?.status(at: date, holidaysClosed: holidaysClosed) ?? .unknown
    }

    func assessedOpeningStatus(
        at date: Date = Date(),
        mode: StoreMode,
        availability: StoreAvailability
    ) -> StoreOpenStatus {
        StoreOpeningPolicy.assessedStatus(
            confirmedStatus: openingStatus(at: date),
            mode: mode,
            availability: availability,
            at: date
        )
    }

    static func == (lhs: Store, rhs: Store) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    private static func makeIdentifier(for item: MKMapItem) -> String {
        let coordinate = item.placemark.coordinate
        let name = item.name ?? "Żabka"
        return "\(name)|\(coordinate.latitude.rounded(toPlaces: 5))|\(coordinate.longitude.rounded(toPlaces: 5))"
    }

    private static func makeAddress(from placemark: MKPlacemark) -> String {
        let street = [placemark.thoroughfare, placemark.subThoroughfare]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
            .joined(separator: " ")

        let locality = [placemark.postalCode, placemark.locality]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
            .joined(separator: " ")

        let parts = [street, locality].filter { !$0.isEmpty }
        return parts.isEmpty ? "Adres dostępny w Mapach" : parts.joined(separator: ", ")
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let power = pow(10.0, Double(places))
        return (self * power).rounded() / power
    }
}
