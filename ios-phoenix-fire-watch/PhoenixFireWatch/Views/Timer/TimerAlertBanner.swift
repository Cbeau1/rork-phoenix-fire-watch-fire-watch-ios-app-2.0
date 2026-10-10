import SwiftUI

/// In-app banner for running timers that are due soon or overdue, with a Log Patrol shortcut.
struct TimerAlertBanner: View {
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(AppRouter.self) private var router
    @State private var dismissed: [String: Date] = [:]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let alert = currentAlert(now: context.date) {
                banner(alert, now: context.date)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .sensoryFeedback(.warning, trigger: alert.key)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.8), value: timers.activePropertyIds)
    }

    private struct Alert {
        let property: Property
        let schedule: PatrolSchedule
        var key: String { "\(property.id)-\(schedule.isOverdue ? "due" : "warn")-\(Int(schedule.dueAt.timeIntervalSince1970))" }
    }

    private func currentAlert(now: Date) -> Alert? {
        var best: Alert?
        for id in timers.activePropertyIds {
            guard let property = store.property(id: id),
                  let s = timers.schedule(for: property, patrols: store.patrols, now: now),
                  s.isWarning || s.isOverdue else { continue }
            let alert = Alert(property: property, schedule: s)
            if let until = dismissed[alert.key], until > now { continue }
            if best == nil || (s.isOverdue && !(best?.schedule.isOverdue ?? false)) { best = alert }
        }
        return best
    }

    private func banner(_ alert: Alert, now: Date) -> some View {
        let overdue = alert.schedule.isOverdue
        let color: Color = overdue ? .fwIncident : .fwFollow
        return HStack(spacing: 12) {
            Image(systemName: overdue ? "alarm.waves.left.and.right.fill" : "alarm.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(color)
                .symbolEffect(.pulse, isActive: overdue)
            VStack(alignment: .leading, spacing: 2) {
                Text(overdue ? "Patrol overdue" : "Patrol due in \(Fmt.countdown(alert.schedule.remaining))")
                    .font(.system(.subheadline, weight: .bold))
                    .foregroundStyle(Color.fwInk)
                    .monospacedDigit()
                Text(alert.property.name)
                    .font(.caption)
                    .foregroundStyle(Color.fwInk2)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Log") {
                router.openLogPatrol(propertyId: alert.property.id)
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: false, compact: true))
            Button {
                withAnimation { dismissed[alert.key] = alert.schedule.dueAt.addingTimeInterval(overdue ? 600 : 0) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.fwInk3)
                    .frame(width: 32, height: 40)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
        .background(Color.fwSurface.opacity(0.97), in: .rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.55), lineWidth: 1) }
        .shadow(color: color.opacity(0.25), radius: 18, y: 8)
        .padding(.horizontal, 16)
    }
}
