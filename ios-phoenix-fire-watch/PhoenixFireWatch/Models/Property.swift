import Foundation

/// A monitored property. Mirrors the `properties` table.
nonisolated struct Property: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var address: String
    var contactName: String
    var contactPhone: String
    var contactEmail: String
    var notes: String
    /// Minutes between required patrols; only org admins can change it.
    var patrolIntervalMinutes: Int
    let createdAt: Date

    static let defaultInterval = 60

    enum CodingKeys: String, CodingKey {
        case id, name, address, notes
        case contactName = "contact_name"
        case contactPhone = "contact_phone"
        case contactEmail = "contact_email"
        case patrolIntervalMinutes = "patrol_interval_minutes"
        case createdAt = "created_at"
    }

    init(
        id: String,
        name: String,
        address: String,
        contactName: String,
        contactPhone: String,
        contactEmail: String,
        notes: String,
        patrolIntervalMinutes: Int,
        createdAt: Date
    ) {
        self.id = id
        self.name = name
        self.address = address
        self.contactName = contactName
        self.contactPhone = contactPhone
        self.contactEmail = contactEmail
        self.notes = notes
        self.patrolIntervalMinutes = patrolIntervalMinutes
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        address = (try? c.decode(String.self, forKey: .address)) ?? ""
        contactName = (try? c.decode(String.self, forKey: .contactName)) ?? ""
        contactPhone = (try? c.decode(String.self, forKey: .contactPhone)) ?? ""
        contactEmail = (try? c.decode(String.self, forKey: .contactEmail)) ?? ""
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        patrolIntervalMinutes = (try? c.decode(Int.self, forKey: .patrolIntervalMinutes)) ?? Property.defaultInterval
        createdAt = (try? c.decodeDate(forKey: .createdAt)) ?? Date()
    }
}

/// Editable property fields (the interval is excluded on purpose — admin-only, set separately).
nonisolated struct PropertyInput: Codable, Sendable, Hashable {
    var name: String = ""
    var address: String = ""
    var contactName: String = ""
    var contactPhone: String = ""
    var contactEmail: String = ""
    var notes: String = ""

    enum CodingKeys: String, CodingKey {
        case name, address, notes
        case contactName = "contact_name"
        case contactPhone = "contact_phone"
        case contactEmail = "contact_email"
    }

    init() {}

    init(property: Property) {
        name = property.name
        address = property.address
        contactName = property.contactName
        contactPhone = property.contactPhone
        contactEmail = property.contactEmail
        notes = property.notes
    }

    var trimmed: PropertyInput {
        var copy = self
        copy.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.address = address.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.contactName = contactName.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.contactPhone = contactPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.contactEmail = contactEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return copy
    }
}

nonisolated struct PropertyInsert: Encodable, Sendable {
    let id: String
    let input: PropertyInput

    func encode(to encoder: Encoder) throws {
        try input.encode(to: encoder)
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
    }

    private enum Key: String, CodingKey { case id }
}
