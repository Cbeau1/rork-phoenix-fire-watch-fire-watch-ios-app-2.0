import CoreLocation
import Foundation

/// Circular area around a property. When enabled, patrols logged outside it are rejected
/// (the server enforces the same rule on every upload).
nonisolated struct Geofence: Codable, Hashable, Sendable {
    var enabled: Bool
    var lat: Double?
    var lng: Double?
    var radiusM: Int?

    static let off = Geofence(enabled: false, lat: nil, lng: nil, radiusM: nil)
    static let minRadius = 25
    static let maxRadius = 5000
    static let defaultRadius = 150
    /// Max GPS uncertainty credited in the officer's favour — mirrors the database rule.
    static let gpsSlackMax: Double = 50

    var isActive: Bool { enabled && lat != nil && lng != nil && radiusM != nil }

    var center: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    /// Distance from the center and whether the fix counts as inside.
    func check(_ fix: PatrolLocation) -> (inside: Bool, distance: Double) {
        guard isActive, let lat, let lng, let radiusM else { return (true, 0) }
        let distance = CLLocation(latitude: lat, longitude: lng)
            .distance(from: CLLocation(latitude: fix.lat, longitude: fix.lng))
        let slack = min(max(fix.accuracyM, 0), Geofence.gpsSlackMax)
        return (distance - slack <= Double(radiusM), distance)
    }
}

/// Where the device was when a patrol was logged.
nonisolated struct PatrolLocation: Codable, Hashable, Sendable {
    let lat: Double
    let lng: Double
    let accuracyM: Double

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
}

/// Row sent when an admin saves a geofence; nil values clear the column.
nonisolated struct GeofenceUpdate: Encodable, Sendable {
    let geofence: Geofence

    enum CodingKeys: String, CodingKey {
        case enabled = "geofence_enabled"
        case lat = "geofence_lat"
        case lng = "geofence_lng"
        case radius = "geofence_radius_m"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(geofence.enabled, forKey: .enabled)
        try c.encode(geofence.lat, forKey: .lat)
        try c.encode(geofence.lng, forKey: .lng)
        try c.encode(geofence.radiusM, forKey: .radius)
    }
}

nonisolated enum Distance {
    /// "150 m" / "1.2 km"; optionally with feet/miles.
    static func format(_ meters: Double, withFeet: Bool = false) -> String {
        let metric = meters >= 1000
            ? String(format: meters >= 10_000 ? "%.0f km" : "%.1f km", meters / 1000)
            : "\(Int(meters.rounded())) m"
        guard withFeet else { return metric }
        let feet = meters * 3.28084
        let imperial = feet >= 5280 ? String(format: "%.1f mi", feet / 5280) : "\(Int((feet / 5).rounded()) * 5) ft"
        return "\(metric) · \(imperial)"
    }
}
