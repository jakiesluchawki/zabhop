import CoreLocation
import Foundation

@MainActor
final class LocationService: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case requestingPermission
        case locating
        case ready
        case denied
        case restricted
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var location: CLLocation?
    @Published private(set) var heading: CLLocationDirection?
    @Published private(set) var headingAccuracy: CLLocationDirection = -1
    @Published private(set) var authorizationStatus: CLAuthorizationStatus

    private let manager: CLLocationManager
    private var headingFilter = HeadingFilter()

    override init() {
        let manager = CLLocationManager()
        self.manager = manager
        self.authorizationStatus = manager.authorizationStatus
        super.init()

        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.headingFilter = 2
        manager.headingOrientation = .portrait
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = true
    }

    func start() {
        guard CLLocationManager.locationServicesEnabled() else {
            state = .failed("Usługi lokalizacji są wyłączone na tym iPhonie.")
            return
        }

        switch authorizationStatus {
        case .notDetermined:
            state = .requestingPermission
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            beginUpdates()
        case .denied:
            state = .denied
        case .restricted:
            state = .restricted
        @unknown default:
            state = .failed("Nie udało się odczytać zgody na lokalizację.")
        }
    }

    func refreshLocation() {
        guard authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways else {
            start()
            return
        }
        state = .locating
        manager.requestLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
    }

    private func beginUpdates() {
        state = location == nil ? .locating : .ready
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
    }

    private func acceptHeading(
        _ rawHeading: CLLocationDirection,
        accuracy: CLLocationDirection,
        timestamp: TimeInterval
    ) {
        guard let filtered = headingFilter.update(
            rawHeading: rawHeading,
            accuracy: accuracy,
            timestamp: timestamp
        ) else { return }

        heading = filtered
        headingAccuracy = accuracy
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            authorizationStatus = status
            start()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let newest = locations.last, newest.horizontalAccuracy >= 0 else { return }
        Task { @MainActor [weak self] in
            self?.location = newest
            self?.state = .ready
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        let bestHeading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        let accuracy = newHeading.headingAccuracy
        let timestamp = newHeading.timestamp.timeIntervalSinceReferenceDate
        Task { @MainActor [weak self] in
            self?.acceptHeading(bestHeading, accuracy: accuracy, timestamp: timestamp)
        }
    }

    nonisolated func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        true
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        guard code != .locationUnknown else { return }
        Task { @MainActor [weak self] in
            self?.state = .failed("Nie udało się ustalić lokalizacji. Spróbuj jeszcze raz na zewnątrz.")
        }
    }
}
