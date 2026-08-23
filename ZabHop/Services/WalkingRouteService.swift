import CoreLocation
import Foundation
import MapKit

@MainActor
final class WalkingRouteService: ObservableObject {
    struct Estimate: Equatable {
        let duration: TimeInterval
        let distance: CLLocationDistance
        let isRouteBased: Bool

        var formattedDuration: String {
            GeoMath.formattedWalkingDuration(duration)
        }
    }

    @Published private(set) var estimate: Estimate?

    private var activeDirections: MKDirections?
    private var activeTask: Task<Void, Never>?
    private var storeID: Store.ID?
    private var lastRequestedLocation: CLLocation?
    private var lastRequestedDate: Date?
    private var requestGeneration = 0

    private static let minimumRefreshInterval: TimeInterval = 90
    private static let minimumRefreshDistance: CLLocationDistance = 75
    private static let maximumUsefulHorizontalAccuracy: CLLocationAccuracy = 100
    private static let arrivalDistance: CLLocationDistance = 35

    func update(for store: Store, from location: CLLocation, force: Bool = false, now: Date = Date()) {
        let targetChanged = storeID != store.id
        let directDistance = store.distance(from: location)

        if directDistance < Self.arrivalDistance {
            cancelActiveRequest()
            storeID = store.id
            estimate = Estimate(duration: 0, distance: directDistance, isRouteBased: false)
            return
        }

        if targetChanged || estimate == nil || estimate?.duration == 0 {
            estimate = Estimate(
                duration: GeoMath.estimatedWalkingDuration(for: directDistance),
                distance: directDistance,
                isRouteBased: false
            )
        }

        guard targetChanged || force || shouldRefresh(from: location, now: now) else { return }
        guard location.horizontalAccuracy < 0
            || location.horizontalAccuracy <= Self.maximumUsefulHorizontalAccuracy else {
            return
        }

        cancelActiveRequest()
        storeID = store.id
        lastRequestedLocation = location
        lastRequestedDate = now
        requestGeneration &+= 1
        let generation = requestGeneration

        let request = MKDirections.Request()
        if #available(iOS 26.0, macOS 26.0, *) {
            request.source = MKMapItem(location: location, address: nil)
        } else {
            request.source = MKMapItem(placemark: MKPlacemark(coordinate: location.coordinate))
        }
        request.destination = store.mapItem
        request.transportType = .walking
        request.requestsAlternateRoutes = false

        let directions = MKDirections(request: request)
        activeDirections = directions
        activeTask = Task { [weak self] in
            do {
                let response = try await directions.calculateETA()
                guard !Task.isCancelled,
                      let self,
                      generation == self.requestGeneration,
                      self.storeID == store.id,
                      response.expectedTravelTime > 0 else {
                    return
                }

                self.estimate = Estimate(
                    duration: response.expectedTravelTime,
                    distance: response.distance,
                    isRouteBased: true
                )
                self.activeDirections = nil
                self.activeTask = nil
            } catch {
                guard !Task.isCancelled,
                      let self,
                      generation == self.requestGeneration else {
                    return
                }

                self.activeDirections = nil
                self.activeTask = nil
            }
        }
    }

    func cancel() {
        cancelActiveRequest()
        requestGeneration &+= 1
    }

    private func shouldRefresh(from location: CLLocation, now: Date) -> Bool {
        guard let lastRequestedLocation, let lastRequestedDate else { return true }
        let elapsed = now.timeIntervalSince(lastRequestedDate)
        let distance = lastRequestedLocation.distance(from: location)
        return elapsed >= Self.minimumRefreshInterval && distance >= Self.minimumRefreshDistance
    }

    private func cancelActiveRequest() {
        activeDirections?.cancel()
        activeTask?.cancel()
        activeDirections = nil
        activeTask = nil
    }
}
