import SwiftUI

/// Outcome recorded for a patrol. Raw values match the database.
nonisolated enum PatrolStatus: String, Codable, CaseIterable, Identifiable, Sendable, Hashable {
    case clear
    case followUp = "follow-up"
    case incident

    var id: String { rawValue }

    init(databaseValue: String) {
        self = PatrolStatus(rawValue: databaseValue) ?? .clear
    }

    var label: String {
        switch self {
        case .clear: "Clear"
        case .followUp: "Follow-up"
        case .incident: "Incident"
        }
    }

    var symbol: String {
        switch self {
        case .clear: "checkmark.shield.fill"
        case .followUp: "exclamationmark.bubble.fill"
        case .incident: "exclamationmark.triangle.fill"
        }
    }

    var color: Color {
        switch self {
        case .clear: .fwClear
        case .followUp: .fwFollow
        case .incident: .fwIncident
        }
    }

    var uiColor: UIColor {
        switch self {
        case .clear: UIColor(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255, alpha: 1)
        case .followUp: UIColor(red: 0xF5 / 255, green: 0xA5 / 255, blue: 0x24 / 255, alpha: 1)
        case .incident: UIColor(red: 0xEF / 255, green: 0x44 / 255, blue: 0x44 / 255, alpha: 1)
        }
    }
}
