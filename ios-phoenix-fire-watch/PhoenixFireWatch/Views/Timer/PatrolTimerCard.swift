import SwiftUI

/// Repeating patrol timer for one property: officer on/off toggle, admin-only interval.
struct PatrolTimerCard: View {
    let property: Property

    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(AppRouter.self) private var router
    @State private var savingInterval: Bool = false

    private var isOn: Bool { timers.isOn(property.id) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let schedule = timers.schedule(for: property, patrols: store.patrols, now: context.date)
            content(schedule: schedule, now: context.date)
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: isOn)
    }

    private func tone(_ s: PatrolSchedule?) -> Color {
        guard let s else { return .fwInk3 }
        if s.isOverdue { return .fwIncident }
        if s.isWarning { return .fwFollow }
        return .fwEmber
    }

    @ViewBuilder
    private func content(schedule: PatrolSchedule?, now: Date) -> some View {
        let color = tone(schedule)
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 18) {
                ring(schedule: schedule, now: now, color: color)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("Patrol Timer")
                            .font(.system(.title3, weight: .heavy))
                            .foregroundStyle(Color.fwInk)
                        if isOn {
                            RunningPill()
                        }
                    }
                    Group {
                        if let s = schedule {
                            if let since = s.overdueSince {
                                Text("Was due at \(Fmt.time(since)). Log a patrol to restart.")
                                    .foregroundStyle(Color.fwIncident)
                            } else {
                                Text("Next due \(Text(Fmt.time(s.dueAt)).foregroundStyle(Color.fwInk).font(FWFont.mono(.subheadline))) · alert \(Fmt.time(s.warnAt))")
                            }
                        } else {
                            Text("Get an alert \(PatrolSchedule.warningMinutes) min before each patrol is due.")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            intervalRow

            Toggle(isOn: Binding(
                get: { isOn },
                set: { on in
                    Task {
                        await timers.setTimer(on, property: property, patrols: store.patrols)
                        timers.reschedule(properties: store.properties, patrols: store.patrols)
                        if on {
                            router.show("Patrol timer on", detail: "You'll be alerted \(PatrolSchedule.warningMinutes) minutes before each patrol is due.")
                        }
                    }
                }
            )) {
                HStack(spacing: 12) {
                    Image(systemName: isOn ? "bell.badge.fill" : "bell.slash")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(isOn ? Color.fwEmber : Color.fwInk3)
                        .frame(width: 26)
                        .contentTransition(.symbolEffect(.replace))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(isOn ? "Timer on" : "Timer off")
                            .font(.system(.body, weight: .semibold))
                            .foregroundStyle(Color.fwInk)
                        Text("Just for you, on this device")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk3)
                    }
                }
            }
            .tint(Color.fwEmber)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.fwRaised, in: .rect(cornerRadius: 12))
            .sensoryFeedback(.impact(weight: .medium), trigger: isOn)

            if isOn {
                extras.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .fwCard(padding: 18, border: isOn ? color.opacity(0.45) : .fwLine)
        .background(alignment: .topTrailing) {
            if isOn {
                Circle()
                    .fill(color.opacity(0.14))
                    .frame(width: 220, height: 220)
                    .blur(radius: 60)
                    .offset(x: 60, y: -70)
                    .allowsHitTesting(false)
            }
        }
        .clipShape(.rect(cornerRadius: 14))
    }

    private func ring(schedule: PatrolSchedule?, now: Date, color: Color) -> some View {
        ZStack {
            Circle().stroke(Color.fwLine, lineWidth: 7)
            if let s = schedule {
                Circle()
                    .trim(from: 0, to: s.progress)
                    .stroke(color, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 1), value: s.progress)
            }
            VStack(spacing: 3) {
                if let s = schedule {
                    Text(s.isOverdue ? Fmt.countdown(now.timeIntervalSince(s.overdueSince ?? now)) : Fmt.countdown(s.remaining))
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundStyle(Color.fwInk)
                        .monospacedDigit()
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                    Text(s.isOverdue ? "OVERDUE" : s.isWarning ? "DUE SOON" : "NEXT")
                        .font(.system(size: 9, weight: .bold))
                        .tracking(1.4)
                        .foregroundStyle(color)
                } else {
                    Image(systemName: "alarm")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Color.fwInk3)
                    Text("OFF")
                        .font(.system(size: 9, weight: .bold))
                        .tracking(1.4)
                        .foregroundStyle(Color.fwInk3)
                }
            }
            .padding(10)
        }
        .frame(width: 104, height: 104)
        .accessibilityElement(children: .combine)
    }

    private var intervalRow: some View {
        HStack(spacing: 10) {
            SectionLabel(text: "Interval")
            if auth.isAdmin {
                Menu {
                    Picker("Patrol interval", selection: Binding(
                        get: { property.patrolIntervalMinutes },
                        set: { minutes in Task { await changeInterval(minutes) } }
                    )) {
                        ForEach(intervalOptions, id: \.self) { m in
                            Text("Every \(Fmt.interval(m))").tag(m)
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text("Every \(Fmt.interval(property.patrolIntervalMinutes))")
                            .font(.system(.subheadline, weight: .semibold))
                            .foregroundStyle(Color.fwInk)
                        if savingInterval {
                            ProgressView().controlSize(.mini).tint(Color.fwEmber)
                        } else {
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Color.fwEmber)
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(Color.fwRaised, in: Capsule())
                    .overlay { Capsule().strokeBorder(Color.fwEmber.opacity(0.4), lineWidth: 1) }
                }
                .disabled(savingInterval)
                Spacer(minLength: 0)
            } else {
                Text("Every \(Fmt.interval(property.patrolIntervalMinutes))")
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.fwInk)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(Color.fwRaised, in: Capsule())
                Spacer(minLength: 0)
                Label("Set by admin", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(Color.fwInk3)
            }
        }
    }

    private var intervalOptions: [Int] {
        let base = PatrolSchedule.intervalOptions
        return base.contains(property.patrolIntervalMinutes) ? base : (base + [property.patrolIntervalMinutes]).sorted()
    }

    @ViewBuilder
    private var extras: some View {
        @Bindable var timers = timers
        VStack(alignment: .leading, spacing: 10) {
            switch timers.notificationStatus {
            case .denied:
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "bell.slash.fill").foregroundStyle(Color.fwFollow)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Notifications are off, so alerts can't reach you when the app is closed.")
                            .font(.footnote)
                            .foregroundStyle(Color.fwInk2)
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .font(.system(.footnote, weight: .semibold))
                    }
                }
                .padding(12)
                .background(Color.fwFollow.opacity(0.1), in: .rect(cornerRadius: 11))
            case .notDetermined:
                Button {
                    Task { await timers.requestNotifications() }
                } label: {
                    Label("Allow notifications for lock-screen alerts", systemImage: "bell.badge")
                        .font(.system(.footnote, weight: .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color.fwEmber.opacity(0.1), in: .rect(cornerRadius: 11))
                }
            default:
                Label("Alerts arrive even when the app is closed or the phone is locked.", systemImage: "lock.iphone")
                    .font(.footnote)
                    .foregroundStyle(Color.fwInk3)
            }
            Toggle(isOn: $timers.keepScreenOn) {
                Label("Keep screen on while timers run", systemImage: "sun.max")
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
            }
            .tint(Color.fwEmber)
        }
    }

    private func changeInterval(_ minutes: Int) async {
        guard minutes != property.patrolIntervalMinutes else { return }
        savingInterval = true
        do {
            try await store.setPatrolInterval(propertyId: property.id, minutes: minutes)
            router.show("Patrol interval updated", detail: "\(property.name) · every \(Fmt.interval(minutes))")
        } catch {
            router.show(ErrorText.from(error), style: .error)
        }
        savingInterval = false
    }
}

struct RunningPill: View {
    @State private var pulse: Bool = false

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.fwEmber)
                .frame(width: 6, height: 6)
                .opacity(pulse ? 0.35 : 1)
                .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
            Text("RUNNING")
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
        }
        .foregroundStyle(Color.fwEmber)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.fwEmber.opacity(0.12), in: Capsule())
        .onAppear { pulse = true }
    }
}
