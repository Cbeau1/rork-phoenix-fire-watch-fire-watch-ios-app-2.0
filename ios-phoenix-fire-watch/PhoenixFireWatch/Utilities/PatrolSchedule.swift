import Foundation

/// Repeating patrol schedule. Each patrol logged at the property restarts the countdown; if a
/// due time passes without a patrol, the timer keeps cycling so alerts continue.
nonisolated struct PatrolSchedule: Sendable, Equatable {
    static let warningMinutes = 5
    static let minInterval = 10
    static let maxInterval = 720
    static let intervalOptions: [Int] = [15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720]

    let interval: TimeInterval
    /// When the next patrol is due.
    let dueAt: Date
    /// When the 5-minute warning fires for `dueAt`.
    let warnAt: Date
    let remaining: TimeInterval
    /// 0 → 1 across the current interval.
    let progress: Double
    let isWarning: Bool
    let missed: Int
    /// Most recent due time that passed without a patrol.
    let lastDueAt: Date?
    /// First due time missed since the last patrol (the patrol is overdue).
    let overdueSince: Date?

    var isOverdue: Bool { overdueSince != nil }

    static func compute(startAt: Date, lastPatrolAt: Date?, intervalMinutes: Int, now: Date) -> PatrolSchedule {
        let interval = TimeInterval(max(minInterval, intervalMinutes) * 60)
        let anchor = max(startAt, lastPatrolAt ?? .distantPast)
        let elapsed = max(0, now.timeIntervalSince(anchor))
        let missed = Int(floor(elapsed / interval))
        let dueAt = anchor.addingTimeInterval(Double(missed + 1) * interval)
        let warnAt = dueAt.addingTimeInterval(-Double(warningMinutes * 60))
        let remaining = dueAt.timeIntervalSince(now)
        return PatrolSchedule(
            interval: interval,
            dueAt: dueAt,
            warnAt: warnAt,
            remaining: remaining,
            progress: min(1, max(0, 1 - remaining / interval)),
            isWarning: now >= warnAt,
            missed: missed,
            lastDueAt: missed > 0 ? anchor.addingTimeInterval(Double(missed) * interval) : nil,
            overdueSince: missed > 0 ? anchor.addingTimeInterval(interval) : nil
        )
    }
}

/// 24-hour fire watch session: starts at its first patrol and includes every patrol within
/// the following 24 hours.
nonisolated struct FireWatchSession: Identifiable, Hashable, Sendable {
    let id: String
    let number: Int
    let start: Date
    let end: Date
    /// Newest first.
    let patrols: [Patrol]

    var range: String {
        let a = Fmt.day(start)
        let b = Fmt.day(end)
        return a == b ? a : "\(a) – \(b)"
    }

    var title: String { "Fire Watch #\(number)" }

    static func group(_ patrols: [Patrol]) -> [FireWatchSession] {
        let asc = patrols.sorted { $0.dateTime < $1.dateTime }
        var buckets: [(start: Date, list: [Patrol])] = []
        for p in asc {
            if let last = buckets.last, p.dateTime < last.start.addingTimeInterval(86_400) {
                buckets[buckets.count - 1].list.append(p)
            } else {
                buckets.append((p.dateTime, [p]))
            }
        }
        return buckets.enumerated().map { index, bucket in
            FireWatchSession(
                id: "session-\(index + 1)-\(bucket.list.first?.id ?? "")",
                number: index + 1,
                start: bucket.list.first?.dateTime ?? bucket.start,
                end: bucket.list.last?.dateTime ?? bucket.start,
                patrols: bucket.list.reversed()
            )
        }
        .reversed()
    }
}

/// Patrol counts for a set of patrols.
nonisolated struct PatrolStats: Sendable {
    let total: Int
    let thisMonth: Int
    let clear: Int
    let followUp: Int
    let incidents: Int

    init(_ patrols: [Patrol], now: Date = Date()) {
        let cal = Calendar.current
        var month = 0, clear = 0, follow = 0, incident = 0
        for p in patrols {
            if cal.isDate(p.dateTime, equalTo: now, toGranularity: .month) { month += 1 }
            switch p.status {
            case .clear: clear += 1
            case .followUp: follow += 1
            case .incident: incident += 1
            }
        }
        total = patrols.count
        thisMonth = month
        self.clear = clear
        followUp = follow
        incidents = incident
    }
}
