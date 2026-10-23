import Foundation
import Observation
import UIKit
import UserNotifications

/// Per-officer, per-device repeating patrol timers. Alerts are scheduled as local
/// notifications, so they fire even when the app is closed or the phone is locked.
@Observable
final class PatrolTimerStore {
    /// propertyId → time the officer turned the timer on.
    private(set) var timers: [String: Date] = [:]
    private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined
    var keepScreenOn: Bool = false {
        didSet {
            persist()
            applyIdleTimer()
        }
    }

    @ObservationIgnored private var userId: String?
    @ObservationIgnored private var lastSignature: String = ""
    @ObservationIgnored private var rescheduleTask: Task<Void, Never>?

    /// Cycles scheduled ahead per property (2 alerts each; iOS allows 64 pending in total).
    private static let cyclesAhead = 12

    private var storageKey: String { "pfw-patrol-timers-\(userId ?? "anon")" }

    private struct Saved: Codable {
        var timers: [String: Date]
        var keepScreenOn: Bool
    }

    func configure(userId: String?) {
        guard userId != self.userId else { return }
        self.userId = userId
        lastSignature = ""
        if let userId, let data = UserDefaults.standard.data(forKey: "pfw-patrol-timers-\(userId)"),
           let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            timers = saved.timers
            keepScreenOn = saved.keepScreenOn
        } else {
            timers = [:]
            keepScreenOn = false
        }
        if userId == nil {
            UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        }
        Task { await refreshNotificationStatus() }
    }

    private func persist() {
        guard userId != nil, let data = try? JSONEncoder().encode(Saved(timers: timers, keepScreenOn: keepScreenOn)) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    private func applyIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = keepScreenOn && !timers.isEmpty
    }

    func isOn(_ propertyId: String) -> Bool { timers[propertyId] != nil }

    var activePropertyIds: [String] { timers.keys.sorted() }

    static func lastPatrolDate(for propertyId: String, in patrols: [Patrol], now: Date = Date()) -> Date? {
        patrols.lazy.filter { $0.propertyId == propertyId }.map { min($0.dateTime, now) }.max()
    }

    func schedule(for property: Property, patrols: [Patrol], now: Date) -> PatrolSchedule? {
        guard let start = timers[property.id] else { return nil }
        return PatrolSchedule.compute(
            startAt: start,
            lastPatrolAt: Self.lastPatrolDate(for: property.id, in: patrols, now: now),
            intervalMinutes: property.patrolIntervalMinutes,
            now: now
        )
    }

    /// Turns a property's timer on or off for this officer.
    func setTimer(_ on: Bool, property: Property, patrols: [Patrol]) async {
        if on {
            let now = Date()
            let last = Self.lastPatrolDate(for: property.id, in: patrols, now: now)
            // If a patrol was just logged, count from it; otherwise start the countdown now.
            if let last, now.timeIntervalSince(last) < Double(property.patrolIntervalMinutes * 60) {
                timers[property.id] = last
            } else {
                timers[property.id] = now
            }
            await requestNotifications()
        } else {
            timers[property.id] = nil
        }
        persist()
        applyIdleTimer()
    }

    /// Turns every timer off and cancels all pending patrol alerts (used on clock-out).
    func stopAll() {
        guard !timers.isEmpty else { return }
        timers = [:]
        persist()
        applyIdleTimer()
        lastSignature = ""
        rescheduleTask?.cancel()
        rescheduleTask = nil
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    // MARK: - Notifications

    func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = settings.authorizationStatus
    }

    func requestNotifications() async {
        await refreshNotificationStatus()
        guard notificationStatus == .notDetermined else { return }
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            print("[Timer] notification permission failed: \(error.localizedDescription)")
        }
        await refreshNotificationStatus()
    }

    /// Re-plans every pending alert from the current timers, intervals and last patrols.
    func reschedule(properties: [Property], patrols: [Patrol]) {
        let now = Date()
        var plans: [(property: Property, schedule: PatrolSchedule)] = []
        for property in properties {
            guard let s = schedule(for: property, patrols: patrols, now: now) else { continue }
            plans.append((property, s))
        }
        // Drop timers for properties that no longer exist.
        let known = Set(properties.map(\.id))
        if !properties.isEmpty {
            let stale = timers.keys.filter { !known.contains($0) }
            if !stale.isEmpty {
                stale.forEach { timers[$0] = nil }
                persist()
            }
        }
        applyIdleTimer()

        let signature = plans
            .map { "\($0.property.id):\($0.property.patrolIntervalMinutes):\(Int($0.schedule.dueAt.timeIntervalSince1970 / 60))" }
            .sorted()
            .joined(separator: "|") + "#\(Int(now.timeIntervalSince1970 / 3600))"
        guard signature != lastSignature else { return }
        lastSignature = signature

        rescheduleTask?.cancel()
        rescheduleTask = Task {
            let center = UNUserNotificationCenter.current()
            center.removeAllPendingNotificationRequests()
            guard !plans.isEmpty else { return }
            let perProperty = max(1, min(Self.cyclesAhead, 30 / plans.count))
            for plan in plans {
                for cycle in 0..<perProperty {
                    let due = plan.schedule.dueAt.addingTimeInterval(Double(cycle) * plan.schedule.interval)
                    let warn = due.addingTimeInterval(-Double(PatrolSchedule.warningMinutes * 60))
                    if warn > now {
                        await add(center, id: "warn-\(plan.property.id)-\(cycle)", at: warn, property: plan.property, kind: .warning, due: due)
                    }
                    if due > now {
                        await add(center, id: "due-\(plan.property.id)-\(cycle)", at: due, property: plan.property, kind: .due, due: due)
                    }
                }
            }
        }
    }

    private enum AlertKind { case warning, due }

    private func add(_ center: UNUserNotificationCenter, id: String, at date: Date, property: Property, kind: AlertKind, due: Date) async {
        let content = UNMutableNotificationContent()
        switch kind {
        case .warning:
            content.title = "Patrol due in \(PatrolSchedule.warningMinutes) minutes"
            content.body = "\(property.name) · due at \(Fmt.time(due)). Tap to log it."
        case .due:
            content.title = "Patrol due now"
            content.body = "\(property.name) · log your patrol to restart the timer."
        }
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.categoryIdentifier = NotificationDelegate.categoryId
        content.threadIdentifier = property.id
        content.userInfo = ["propertyId": property.id]
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        } catch {
            print("[Timer] schedule failed: \(error.localizedDescription)")
        }
    }
}
