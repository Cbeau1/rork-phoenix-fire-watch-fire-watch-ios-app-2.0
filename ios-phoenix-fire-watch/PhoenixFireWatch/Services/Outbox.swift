import Foundation

/// A change saved on the device first, then replayed to the server in order.
nonisolated struct OutboxOp: Codable, Identifiable, Sendable, Hashable {
    enum Kind: String, Codable, Sendable {
        case patrolCreate, propertyCreate, propertyUpdate, noteCreate, noteResolve
    }

    let id: String
    let kind: Kind
    let createdAt: Date
    var attempts: Int = 0
    var failed: Bool = false
    var error: String?

    var patrol: Patrol?
    /// Photo files in `PhotoStore` waiting to upload (patrols only).
    var photoFiles: [String] = []
    /// Storage paths already uploaded, so a retry resumes where it stopped.
    var uploaded: [String] = []

    var propertyId: String?
    var propertyInput: PropertyInput?

    var note: WatchNote?
    var noteId: String?

    var summary: String {
        switch kind {
        case .patrolCreate: "Patrol · \(patrol?.officerName ?? "")" + (photoFiles.isEmpty ? "" : " · \(photoFiles.count) photo\(photoFiles.count == 1 ? "" : "s")")
        case .propertyCreate: "New property · \(propertyInput?.name ?? "")"
        case .propertyUpdate: "Property edit · \(propertyInput?.name ?? "")"
        case .noteCreate: "Watch note"
        case .noteResolve: "Resolve note"
        }
    }
}
