import Foundation

/// Week math and shift-time formatting for the Schedule. Weeks run Monday → Sunday.
/// Shift times are "HH:mm"; an end at or before the start ends the next morning.
nonisolated enum ScheduleDates {
    nonisolated(unsafe) private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Midnight on the Monday of the week containing `date`.
    static func weekStart(of date: Date) -> Date {
        let cal = Calendar.current
        let day = cal.startOfDay(for: date)
        let weekday = cal.component(.weekday, from: day) // 1 = Sunday … 7 = Saturday
        let back = (weekday + 5) % 7
        return cal.date(byAdding: .day, value: -back, to: day) ?? day
    }

    static func addDays(_ days: Int, to date: Date) -> Date {
        Calendar.current.date(byAdding: .day, value: days, to: date) ?? date
    }

    static func days(from weekStart: Date) -> [Date] {
        (0..<7).map { addDays($0, to: weekStart) }
    }

    /// "yyyy-MM-dd" in the device's time zone (the calendar day a shift starts).
    static func key(_ date: Date) -> String {
        keyFormatter.timeZone = .current
        return keyFormatter.string(from: date)
    }

    static func date(fromKey key: String) -> Date? {
        keyFormatter.timeZone = .current
        return keyFormatter.date(from: key)
    }

    /// "Sep 29 – Oct 5, 2026"
    static func weekLabel(_ start: Date) -> String {
        let end = addDays(6, to: start)
        let cal = Calendar.current
        let sameMonth = cal.component(.month, from: start) == cal.component(.month, from: end)
        let s = start.formatted(.dateTime.month(.abbreviated).day())
        let e = sameMonth ? end.formatted(.dateTime.day()) : end.formatted(.dateTime.month(.abbreviated).day())
        return "\(s) – \(e), \(end.formatted(.dateTime.year()))"
    }

    // MARK: - Shift times

    /// Postgres `time` ("19:00:00") → "19:00".
    static func fromDb(_ raw: String) -> String { String(raw.prefix(5)) }

    static func minutes(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        return (parts.first ?? 0) * 60 + (parts.dropFirst().first ?? 0)
    }

    static func isOvernight(start: String, end: String) -> Bool {
        minutes(end) <= minutes(start)
    }

    static func duration(start: String, end: String) -> Int {
        let diff = minutes(end) - minutes(start)
        return diff <= 0 ? diff + 24 * 60 : diff
    }

    /// "19:00" → "7 PM", "06:30" → "6:30 AM"
    static func clock(_ hhmm: String) -> String {
        let total = minutes(hhmm)
        let h = total / 60
        let m = total % 60
        let suffix = h < 12 ? "AM" : "PM"
        let h12 = h % 12 == 0 ? 12 : h % 12
        return m == 0 ? "\(h12) \(suffix)" : String(format: "%d:%02d %@", h12, m, suffix)
    }

    /// "7 PM – 7 AM"
    static func range(start: String, end: String) -> String {
        "\(clock(start)) – \(clock(end))"
    }

    /// 720 → "12h", 450 → "7.5h"
    static func hours(_ minutes: Int) -> String {
        minutes % 60 == 0 ? "\(minutes / 60)h" : String(format: "%.1fh", Double(minutes) / 60)
    }

    static func hhmm(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Today at the given "HH:mm" (for time pickers).
    static func date(fromHHMM hhmm: String) -> Date {
        let total = minutes(hhmm)
        let start = Calendar.current.startOfDay(for: Date())
        return Calendar.current.date(byAdding: .minute, value: total, to: start) ?? start
    }
}
