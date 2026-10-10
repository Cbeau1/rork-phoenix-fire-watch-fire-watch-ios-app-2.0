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

    /// Readable text/icon color on the navy canvas (incident uses the lighter red).
    var textColor: Color {
        self == .incident ? .fwIncidentInk : color
    }

    var uiColor: UIColor { UIColor(color) }
}
