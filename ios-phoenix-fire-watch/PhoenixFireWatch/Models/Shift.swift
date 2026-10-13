import Foundation

/// One scheduled shift at a property. `date` is "yyyy-MM-dd"; `start`/`end` are "HH:mm".
/// `paidAt` is only ever set for org admins — pay data is admin-only on the server.
nonisolated struct Shift: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var propertyId: String
    var staffId: String
    var date: String
    var start: String
    var end: String
    var notes: String
    var paidAt: Date?

    var isPaid: Bool { paidAt != nil }
    var minutes: Int { ScheduleDates.duration(start: start, end: end) }
    var isOvernight: Bool { ScheduleDates.isOvernight(start: start, end: end) }
    var rangeLabel: String { ScheduleDates.range(start: start, end: end) }
    /// Scheduled start in the device's time zone.
    var startDate: Date? {
        ScheduleDates.date(fromKey: date).map { $0.addingTimeInterval(TimeInterval(ScheduleDates.minutes(start) * 60)) }
    }

    static func byStart(_ a: Shift, _ b: Shift) -> Bool {
        a.date == b.date ? ScheduleDates.minutes(a.start) < ScheduleDates.minutes(b.start) : a.date < b.date
    }
}

/// `shifts` row as returned by the server, optionally with its embedded `shift_payments`.
nonisolated struct ShiftRow: Decodable, Sendable {
    let id: String
    let propertyId: String
    let staffId: String
    let shiftDate: String
    let startTime: String
    let endTime: String
    let notes: String
    let paidAt: String?

    private nonisolated struct PaymentRef: Decodable, Sendable {
        let paidAt: String
        enum CodingKeys: String, CodingKey { case paidAt = "paid_at" }
    }

    enum CodingKeys: String, CodingKey {
        case id, notes
        case propertyId = "property_id"
        case staffId = "staff_id"
        case shiftDate = "shift_date"
        case startTime = "start_time"
        case endTime = "end_time"
        case payments = "shift_payments"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        propertyId = try c.decode(String.self, forKey: .propertyId)
        staffId = try c.decode(String.self, forKey: .staffId)
        shiftDate = try c.decode(String.self, forKey: .shiftDate)
        startTime = try c.decode(String.self, forKey: .startTime)
        endTime = try c.decode(String.self, forKey: .endTime)
        notes = (try? c.decodeIfPresent(String.self, forKey: .notes)) ?? ""
        if let single = try? c.decodeIfPresent(PaymentRef.self, forKey: .payments) {
            paidAt = single.paidAt
        } else if let list = try? c.decodeIfPresent([PaymentRef].self, forKey: .payments) {
            paidAt = list.first?.paidAt
        } else {
            paidAt = nil
        }
    }

    var shift: Shift {
        Shift(
            id: id, propertyId: propertyId, staffId: staffId, date: shiftDate,
            start: ScheduleDates.fromDb(startTime), end: ScheduleDates.fromDb(endTime),
            notes: notes, paidAt: paidAt.flatMap(DateParser.parse)
        )
    }
}

/// What an admin fills in when adding or editing shifts.
nonisolated struct ShiftInput: Hashable, Sendable {
    var staffId: String
    var propertyId: String
    var start: String
    var end: String
    var notes: String
}

nonisolated struct ShiftWrite: Encodable, Sendable {
    let staffId: String
    let propertyId: String
    let shiftDate: String
    let startTime: String
    let endTime: String
    let notes: String

    init(input: ShiftInput, date: String) {
        staffId = input.staffId
        propertyId = input.propertyId
        shiftDate = date
        startTime = input.start
        endTime = input.end
        notes = String(input.notes.trimmed.prefix(500))
    }

    enum CodingKeys: String, CodingKey {
        case notes
        case staffId = "staff_id"
        case propertyId = "property_id"
        case shiftDate = "shift_date"
        case startTime = "start_time"
        case endTime = "end_time"
    }
}

nonisolated struct ShiftPaymentWrite: Encodable, Sendable {
    let shiftId: String
    enum CodingKeys: String, CodingKey { case shiftId = "shift_id" }
}

nonisolated struct ShiftPreset: Hashable, Sendable, Identifiable {
    let label: String
    let start: String
    let end: String
    var id: String { label }

    static let all: [ShiftPreset] = [
        ShiftPreset(label: "Day", start: "07:00", end: "19:00"),
        ShiftPreset(label: "Night", start: "19:00", end: "07:00"),
        ShiftPreset(label: "1st", start: "06:00", end: "14:00"),
        ShiftPreset(label: "2nd", start: "14:00", end: "22:00"),
        ShiftPreset(label: "3rd", start: "22:00", end: "06:00"),
    ]
}
