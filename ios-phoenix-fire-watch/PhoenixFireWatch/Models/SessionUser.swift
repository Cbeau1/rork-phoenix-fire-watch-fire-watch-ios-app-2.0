import Foundation

nonisolated enum Role: String, Codable, Sendable, Hashable, CaseIterable {
    case admin
    case officer

    var label: String {
        switch self {
        case .admin: "Org Admin"
        case .officer: "Fire Watch Officer"
        }
    }
}

/// Signed-in officer with their organization details.
nonisolated struct SessionUser: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let email: String
    let role: Role
    let orgId: String
    let orgName: String
    /// Organization data-retention period in days; nil keeps records until deleted.
    let retentionDays: Int?
    let termsAccepted: Bool
    /// When the officer acknowledged the New Employee Field Guide (ISO string); nil = not yet.
    var guideAcknowledgedAt: String? = nil

    var isAdmin: Bool { role == .admin }
    /// Officers must acknowledge the field guide once before using the app; admins are exempt.
    var needsFieldGuide: Bool { role == .officer && guideAcknowledgedAt == nil }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map { String($0) }.joined()
        return letters.isEmpty ? "FW" : letters.uppercased()
    }
}

/// `profiles` row joined with its organization.
nonisolated struct ProfileRow: Decodable, Sendable {
    let id: String
    let fullName: String
    let email: String
    let role: String
    let active: Bool
    let orgId: String
    let termsAcceptedAt: String?
    let fieldGuideAcknowledgedAt: String?
    let organizations: OrgRow?

    nonisolated struct OrgRow: Decodable, Sendable {
        let name: String
        let retentionDays: Int?

        enum CodingKeys: String, CodingKey {
            case name
            case retentionDays = "retention_days"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, email, role, active, organizations
        case fullName = "full_name"
        case orgId = "org_id"
        case termsAcceptedAt = "terms_accepted_at"
        case fieldGuideAcknowledgedAt = "field_guide_acknowledged_at"
    }
}

/// Team member as shown to org admins.
nonisolated struct Member: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let fullName: String
    let email: String
    let role: String
    let active: Bool
    let createdAt: String

    var roleValue: Role { role == "admin" ? .admin : .officer }

    enum CodingKeys: String, CodingKey {
        case id, email, role, active
        case fullName = "full_name"
        case createdAt = "created_at"
    }
}

/// Data-retention choices offered to organization admins.
nonisolated enum RetentionOption {
    static let all: [(days: Int?, label: String)] = [
        (nil, "Keep until deleted"),
        (180, "6 months"),
        (365, "1 year"),
        (730, "2 years"),
        (1095, "3 years"),
        (1825, "5 years"),
        (2555, "7 years"),
    ]

    static func label(for days: Int?) -> String {
        all.first { $0.days == days }?.label ?? (days.map { "\($0) days" } ?? "Keep until deleted")
    }
}

/// Public business details used by legal and support links.
nonisolated enum Legal {
    static let siteURL = "https://oztxiyqp27gn6fu308my6-web-phoenix-fire-watch.rork.live"
    static let supportEmail = "support@phoenixfirewatch.com"
    static var privacyURL: URL { URL(string: "\(siteURL)/privacy") ?? URL(fileURLWithPath: "/") }
    static var termsURL: URL { URL(string: "\(siteURL)/terms") ?? URL(fileURLWithPath: "/") }
    static var supportURL: URL { URL(string: "\(siteURL)/support") ?? URL(fileURLWithPath: "/") }
}
