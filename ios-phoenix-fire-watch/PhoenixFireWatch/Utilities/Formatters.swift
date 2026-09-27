import Foundation

/// Parses Postgres/ISO-8601 timestamps with any number of fractional digits.
nonisolated enum DateParser {
    nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ raw: String) -> Date? {
        var s = raw.replacingOccurrences(of: " ", with: "T")
        if s.hasSuffix("+00") { s += ":00" }
        if let d = withFraction.date(from: s) ?? plain.date(from: s) { return d }
        // Trim fractional seconds (e.g. microseconds) and retry.
        if let dot = s.firstIndex(of: ".") {
            var end = s.index(after: dot)
            while end < s.endIndex, s[end].isNumber { end = s.index(after: end) }
            s.removeSubrange(dot..<end)
            return plain.date(from: s)
        }
        return nil
    }

    static func iso(_ date: Date) -> String {
        withFraction.string(from: date)
    }
}

extension KeyedDecodingContainer {
    /// Decodes a timestamp stored as an ISO string (server) or encoded Date (local cache).
    nonisolated func decodeDate(forKey key: Key) throws -> Date {
        if let s = try? decode(String.self, forKey: key), let d = DateParser.parse(s) { return d }
        return try decode(Date.self, forKey: key)
    }
}

nonisolated enum Fmt {
    static func time(_ d: Date) -> String {
        d.formatted(date: .omitted, time: .shortened)
    }

    static func day(_ d: Date) -> String {
        d.formatted(.dateTime.month(.abbreviated).day().year())
    }

    static func dateTime(_ d: Date) -> String {
        "\(day(d)) · \(time(d))"
    }

    static func relative(_ d: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(d)
        if seconds < 60 { return "just now" }
        return d.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }

    /// "45 min", "1 hr", "1 hr 30 min", "4 hrs"
    static func interval(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        if h == 0 { return "\(m) min" }
        let hours = "\(h) \(h == 1 ? "hr" : "hrs")"
        return m > 0 ? "\(hours) \(m) min" : hours
    }

    /// "04:59" or "1:04:59"
    static func countdown(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.up)))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }

    static func greeting(_ now: Date = Date()) -> String {
        let hour = Calendar.current.component(.hour, from: now)
        switch hour {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }
}

nonisolated enum IDs {
    static func make() -> String { UUID().uuidString.lowercased() }
}

extension String {
    nonisolated var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }

    nonisolated var isValidEmail: Bool {
        let t = trimmed
        guard let at = t.firstIndex(of: "@"), at != t.startIndex else { return false }
        let domain = t[t.index(after: at)...]
        return domain.contains(".") && !domain.hasSuffix(".") && !t.contains(" ")
    }
}
