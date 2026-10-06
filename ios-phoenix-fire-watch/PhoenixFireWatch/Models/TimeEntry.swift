import Foundation
import SwiftUI

/// One clock-in → clock-out punch. Server time is the official time for both punches.
/// Officers only ever receive their own entries (enforced by the server).
nonisolated struct TimeEntry: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let clockIn: Date
    let clockOut: Date?
    let status: String

    var isOpen: Bool { clockOut == nil }

    /// Whole minutes worked; open entries count up to `now`.
    func minutes(now: Date = Date()) -> Int {
        max(0, Int((clockOut ?? now).timeIntervalSince(clockIn) / 60))
    }

    var statusLabel: String {
        switch status {
        case "open": "Clocked in"
        case "approved": "Approved"
        case "rejected": "Rejected"
        default: "Needs approval"
        }
    }

    var statusColor: Color {
        switch status {
        case "open": .fwClear
        case "approved": .fwClear
        case "rejected": .fwIncident
        default: .fwFollow
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, status
        case clockIn = "clock_in"
        case clockOut = "clock_out"
    }

    init(id: String, clockIn: Date, clockOut: Date?, status: String) {
        self.id = id
        self.clockIn = clockIn
        self.clockOut = clockOut
        self.status = status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(String.self, forKey: .status)
        clockIn = try c.decodeDate(forKey: .clockIn)
        if (try? c.decodeNil(forKey: .clockOut)) ?? true {
            clockOut = nil
        } else {
            clockOut = try c.decodeDate(forKey: .clockOut)
        }
    }
}

nonisolated enum HoursFormat {
    /// "7h 45m"
    static func duration(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        return h == 0 ? "\(m)m" : "\(h)h \(String(format: "%02d", m))m"
    }

    /// Live timer "3:04:09"
    static func elapsed(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        return String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
}
