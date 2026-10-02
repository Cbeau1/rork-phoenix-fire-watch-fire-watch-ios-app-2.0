import Foundation

/// A person who can be scheduled. Mirrors `staff`. Optionally linked to a team login
/// so that officer sees their own shifts highlighted.
nonisolated struct StaffMember: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var profileId: String?

    enum CodingKeys: String, CodingKey {
        case id, name
        case profileId = "profile_id"
    }

    var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    static func byName(_ a: StaffMember, _ b: StaffMember) -> Bool {
        a.name.localizedStandardCompare(b.name) == .orderedAscending
    }
}

/// Insert / update payload for `staff`. Always sends `profile_id` so unlinking writes null.
nonisolated struct StaffWrite: Encodable, Sendable {
    let name: String
    let profileId: String?

    enum CodingKeys: String, CodingKey {
        case name
        case profileId = "profile_id"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(profileId, forKey: .profileId)
    }
}
