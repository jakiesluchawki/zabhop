import CoreLocation
import Foundation

enum GeoMath {
    static let averageWalkingSpeedMetersPerSecond = 1.35
    static let estimatedWalkingDetourFactor = 1.2

    static func bearing(from source: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D) -> CLLocationDirection {
        let sourceLatitude = source.latitude.degreesToRadians
        let sourceLongitude = source.longitude.degreesToRadians
        let destinationLatitude = destination.latitude.degreesToRadians
        let destinationLongitude = destination.longitude.degreesToRadians

        let longitudeDelta = destinationLongitude - sourceLongitude
        let y = sin(longitudeDelta) * cos(destinationLatitude)
        let x = cos(sourceLatitude) * sin(destinationLatitude)
            - sin(sourceLatitude) * cos(destinationLatitude) * cos(longitudeDelta)

        return normalize360(atan2(y, x).radiansToDegrees)
    }

    static func compassRotation(targetBearing: CLLocationDirection, deviceHeading: CLLocationDirection) -> CLLocationDirection {
        normalizeSigned(targetBearing - deviceHeading)
    }

    static func normalize360(_ degrees: CLLocationDirection) -> CLLocationDirection {
        let normalized = degrees.truncatingRemainder(dividingBy: 360)
        return normalized >= 0 ? normalized : normalized + 360
    }

    static func normalizeSigned(_ degrees: CLLocationDirection) -> CLLocationDirection {
        let normalized = normalize360(degrees)
        return normalized > 180 ? normalized - 360 : normalized
    }

    static func unwrappedAngle(
        current: CLLocationDirection,
        target: CLLocationDirection
    ) -> CLLocationDirection {
        current + normalizeSigned(target - current)
    }

    static func formattedDistance(_ meters: CLLocationDistance) -> String {
        if meters < 1_000 {
            let rounded = meters < 100 ? (meters / 5).rounded() * 5 : (meters / 10).rounded() * 10
            return "\(Int(max(0, rounded))) m"
        }

        let kilometers = meters / 1_000
        if kilometers < 10 {
            return kilometers.formatted(.number.precision(.fractionLength(1))) + " km"
        }
        return kilometers.formatted(.number.precision(.fractionLength(0))) + " km"
    }

    static func estimatedWalkingDuration(for distance: CLLocationDistance) -> TimeInterval {
        max(0, distance) * estimatedWalkingDetourFactor / averageWalkingSpeedMetersPerSecond
    }

    static func formattedWalkingDuration(_ duration: TimeInterval) -> String {
        let totalMinutes = max(1, Int((max(0, duration) / 60).rounded(.up)))
        guard totalMinutes >= 60 else { return "\(totalMinutes) min" }

        let hours = totalMinutes / 60
        let remainingMinutes = totalMinutes % 60
        guard remainingMinutes > 0 else { return "\(hours) godz." }
        return "\(hours) godz. \(remainingMinutes) min"
    }
}

struct HeadingFilter {
    private let deadband: CLLocationDirection
    private let maxAccuracy: CLLocationDirection
    private let minimumInterval: TimeInterval
    private let spikeThreshold: CLLocationDirection
    private let spikeAgreement: CLLocationDirection
    private let spikeWindow: TimeInterval

    private(set) var value: CLLocationDirection?
    private var lastTimestamp: TimeInterval?
    private var pendingSpike: (heading: CLLocationDirection, timestamp: TimeInterval)?
    private var rapidModeUntil: TimeInterval = 0

    init(
        deadband: CLLocationDirection = 2,
        maxAccuracy: CLLocationDirection = 35,
        minimumInterval: TimeInterval = 0.05,
        spikeThreshold: CLLocationDirection = 52,
        spikeAgreement: CLLocationDirection = 18,
        spikeWindow: TimeInterval = 0.4
    ) {
        self.deadband = deadband
        self.maxAccuracy = maxAccuracy
        self.minimumInterval = minimumInterval
        self.spikeThreshold = spikeThreshold
        self.spikeAgreement = spikeAgreement
        self.spikeWindow = spikeWindow
    }

    mutating func reset() {
        value = nil
        lastTimestamp = nil
        pendingSpike = nil
        rapidModeUntil = 0
    }

    mutating func update(
        rawHeading: CLLocationDirection,
        accuracy: CLLocationDirection? = nil,
        timestamp: TimeInterval
    ) -> CLLocationDirection? {
        guard rawHeading.isFinite, timestamp.isFinite else { return nil }
        if let accuracy, accuracy.isFinite, accuracy >= 0, accuracy > maxAccuracy { return nil }

        let raw = GeoMath.normalize360(rawHeading)
        guard let current = value, let previousTimestamp = lastTimestamp else {
            value = raw
            lastTimestamp = timestamp
            return raw
        }

        let elapsed = max(0, timestamp - previousTimestamp)
        if elapsed > 1.2 {
            value = raw
            lastTimestamp = timestamp
            pendingSpike = nil
            rapidModeUntil = 0
            return raw
        }
        guard elapsed >= minimumInterval else { return nil }
        lastTimestamp = timestamp

        let delta = GeoMath.normalizeSigned(raw - current)
        guard abs(delta) > deadband else {
            pendingSpike = nil
            return nil
        }

        if abs(delta) >= spikeThreshold, timestamp > rapidModeUntil {
            let confirmed = pendingSpike.map {
                timestamp - $0.timestamp <= spikeWindow
                    && abs(GeoMath.normalizeSigned(raw - $0.heading)) <= spikeAgreement
            } ?? false

            guard confirmed else {
                pendingSpike = (raw, timestamp)
                return nil
            }

            pendingSpike = nil
            rapidModeUntil = timestamp + 0.55
        } else {
            pendingSpike = nil
        }

        let deltaTime = min(max(elapsed, 1.0 / 60.0), 0.25)
        let angularSpeed = abs(delta) / deltaTime
        let timeConstant = angularSpeed > 120 ? 0.12 : angularSpeed > 45 ? 0.2 : 0.38
        let alpha = 1 - exp(-deltaTime / timeConstant)
        let filtered = GeoMath.normalize360(current + delta * alpha)
        value = filtered
        return filtered
    }
}

private extension Double {
    var degreesToRadians: Double { self * .pi / 180 }
    var radiansToDegrees: Double { self * 180 / .pi }
}
