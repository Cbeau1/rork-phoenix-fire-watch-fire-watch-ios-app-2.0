import Foundation
import SwiftUI

/// Payroll hours attached to a scheduled shift — a real clock punch (matched at clock-in)
/// or an entry an admin created with "Mark completed". Officers only receive their own.
nonisolated struct ShiftWork: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let shiftId: String
    let status: String
    let clockIn: Date
    let clockOut: Date?
    let source: String

    var isOpen: Bool { status == "open" }
    var isFromClock: Bool { source == "clock" }

    /// Higher wins when a shift has several entries (e.g. a rejected one and its replacement).
    var rank: Int {
        switch status {
        case "open": 3
        case "pending", "approved": 2
        default: 0
        }
    }

    var label: String {
        switch status {
        case "open": "On shift"
        case "approved": "Approved"
        case "rejected": "Rejected"
        default: "Needs approval"
        }
    }

    var symbol: String {
        switch status {
        case "open": "clock.fill"
        case "rejected": "xmark.circle.fill"
        default: "checkmark.circle.fill"
        }
    }

    var tint: Color {
        switch status {
        case "open": .fwLink
        case "approved": .fwClear
        case "rejected": .fwIncidentInk
        default: .fwFollow
        }
    }

    var timesLabel: String {
        let fmt: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }
        if isOpen { return "Clocked in \(fmt(clockIn))" }
        return "\(isFromClock ? "Clocked" : "Logged") \(fmt(clockIn)) – \(clockOut.map(fmt) ?? "now")"
    }

    enum CodingKeys: String, CodingKey {
        case id, status, source
        case shiftId = "shift_id"
        case clockIn = "clock_in"
        case clockOut = "clock_out"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        shiftId = try c.decode(String.self, forKey: .shiftId)
        status = try c.decode(String.self, forKey: .status)
        source = (try? c.decode(String.self, forKey: .source)) ?? "clock"
        clockIn = try c.decodeDate(forKey: .clockIn)
        if (try? c.decodeNil(forKey: .clockOut)) ?? true {
            clockOut = nil
        } else {
            clockOut = try c.decodeDate(forKey: .clockOut)
        }
    }
}
