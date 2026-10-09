import Foundation

/// A logged patrol. Mirrors the `patrols` table; `pendingPhotoFiles` is set only for
/// patrols saved on this device that haven't uploaded yet.
nonisolated struct Patrol: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let propertyId: String
    let dateTime: Date
    let officerName: String
    let areas: [String]
    let status: PatrolStatus
    let notes: String
    /// Storage object paths in the `patrol-photos` bucket.
    let photos: [String]
    let loggedBy: String?
    let createdAt: Date
    /// Device location when logged (only captured at geofenced properties).
    var location: PatrolLocation? = nil
    /// Meters from the geofence center, computed by the server.
    var geofenceDistanceM: Double? = nil
    var syncState: SyncState? = nil
    var localPhotoFiles: [String] = []

    enum CodingKeys: String, CodingKey {
        case id, areas, status, notes, photos
        case propertyId = "property_id"
        case dateTime = "date_time"
        case officerName = "officer_name"
        case loggedBy = "logged_by"
        case createdAt = "created_at"
        case latitude, longitude
        case locationAccuracyM = "location_accuracy_m"
        case geofenceDistanceM = "geofence_distance_m"
    }

    init(
        id: String,
        propertyId: String,
        dateTime: Date,
        officerName: String,
        areas: [String],
        status: PatrolStatus,
        notes: String,
        photos: [String],
        loggedBy: String?,
        createdAt: Date,
        location: PatrolLocation? = nil,
        geofenceDistanceM: Double? = nil,
        syncState: SyncState? = nil,
        localPhotoFiles: [String] = []
    ) {
        self.location = location
        self.geofenceDistanceM = geofenceDistanceM
        self.id = id
        self.propertyId = propertyId
        self.dateTime = dateTime
        self.officerName = officerName
        self.areas = areas
        self.status = status
        self.notes = notes
        self.photos = photos
        self.loggedBy = loggedBy
        self.createdAt = createdAt
        self.syncState = syncState
        self.localPhotoFiles = localPhotoFiles
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        propertyId = try c.decode(String.self, forKey: .propertyId)
        dateTime = try c.decodeDate(forKey: .dateTime)
        officerName = (try? c.decode(String.self, forKey: .officerName)) ?? ""
        areas = (try? c.decode([String].self, forKey: .areas)) ?? []
        status = PatrolStatus(databaseValue: (try? c.decode(String.self, forKey: .status)) ?? "clear")
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        photos = (try? c.decode([String].self, forKey: .photos)) ?? []
        loggedBy = try? c.decodeIfPresent(String.self, forKey: .loggedBy)
        createdAt = (try? c.decodeDate(forKey: .createdAt)) ?? dateTime
        if let lat = try? c.decodeIfPresent(Double.self, forKey: .latitude),
           let lng = try? c.decodeIfPresent(Double.self, forKey: .longitude) {
            let accuracy = (try? c.decodeIfPresent(Double.self, forKey: .locationAccuracyM)) ?? 0
            location = PatrolLocation(lat: lat, lng: lng, accuracyM: accuracy)
        }
        geofenceDistanceM = try? c.decodeIfPresent(Double.self, forKey: .geofenceDistanceM)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(propertyId, forKey: .propertyId)
        try c.encode(dateTime, forKey: .dateTime)
        try c.encode(officerName, forKey: .officerName)
        try c.encode(areas, forKey: .areas)
        try c.encode(status.rawValue, forKey: .status)
        try c.encode(notes, forKey: .notes)
        try c.encode(photos, forKey: .photos)
        try c.encodeIfPresent(loggedBy, forKey: .loggedBy)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(location?.lat, forKey: .latitude)
        try c.encodeIfPresent(location?.lng, forKey: .longitude)
        try c.encodeIfPresent(location?.accuracyM, forKey: .locationAccuracyM)
        try c.encodeIfPresent(geofenceDistanceM, forKey: .geofenceDistanceM)
    }

    var photoCount: Int { max(photos.count, localPhotoFiles.count) }
}

nonisolated enum SyncState: String, Codable, Sendable, Hashable {
    case pending
    case failed
}

/// Row sent to the server when a patrol uploads.
nonisolated struct PatrolInsert: Encodable, Sendable {
    let id: String
    let propertyId: String
    let dateTime: String
    let officerName: String
    let areas: [String]
    let status: String
    let notes: String
    let photos: [String]
    var latitude: Double? = nil
    var longitude: Double? = nil
    var locationAccuracyM: Double? = nil

    enum CodingKeys: String, CodingKey {
        case id, areas, status, notes, photos, latitude, longitude
        case propertyId = "property_id"
        case dateTime = "date_time"
        case officerName = "officer_name"
        case locationAccuracyM = "location_accuracy_m"
    }
}
