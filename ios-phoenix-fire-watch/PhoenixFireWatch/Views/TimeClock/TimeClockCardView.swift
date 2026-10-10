import SwiftUI

/// Big clock in / clock out control with a live shift timer and this week's hours.
struct TimeClockCardView: View {
    @Environment(TimeClockStore.self) private var clock
    @Environment(AppRouter.self) private var router
    var onOpenHours: (() -> Void)?
    @State private var punchCount: Int = 0

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            content(now: context.date)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: punchCount)
    }

    private func content(now: Date) -> some View {
        let isOn = clock.open != nil
        let accent: Color = isOn ? .fwClear : .fwInk3
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(isOn ? Color.fwClear.opacity(0.15) : Color.fwRaised).frame(width: 54, height: 54)
                    Circle().strokeBorder(isOn ? Color.fwClear.opacity(0.45) : Color.fwLine, lineWidth: 1).frame(width: 54, height: 54)
                    Image(systemName: "clock.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(isOn ? Color.fwClear : Color.fwInk2)
                        .symbolEffect(.pulse, isActive: isOn)
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        StatusDot(color: accent, size: 7)
                        SectionLabel(text: isOn ? "On the clock" : "Off the clock", color: accent)
                    }
                    if let open = clock.open {
                        Text(HoursFormat.elapsed(now.timeIntervalSince(open.clockIn)))
                            .font(FWFont.mono(.title, weight: .bold))
                            .foregroundStyle(Color.fwInk)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                        Text("Clocked in at \(Fmt.time(open.clockIn))")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk2)
                    } else {
                        Text("Ready to start?")
                            .font(.system(.title3, weight: .bold))
                            .foregroundStyle(Color.fwInk)
                        Text("Clock in when your shift begins")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk2)
                    }
                }
                Spacer(minLength: 0)
            }

            Button {
                Task { await punch() }
            } label: {
                HStack(spacing: 8) {
                    if clock.isPunching {
                        ProgressView().tint(isOn ? Color.fwInk : .white)
                    } else {
                        Image(systemName: isOn ? "rectangle.portrait.and.arrow.right" : "arrow.right.to.line")
                    }
                    Text(isOn ? "Clock Out" : "Clock In")
                }
            }
            .modifier(PunchButtonStyle(isOn: isOn))
            .disabled(clock.isPunching || (!clock.hasLoaded && clock.loadError == nil))

            Button {
                onOpenHours?()
            } label: {
                HStack {
                    Text("This week").font(.subheadline).foregroundStyle(Color.fwInk2)
                    Spacer()
                    Text(HoursFormat.duration(clock.weekMinutes(now: now)))
                        .font(FWFont.mono(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.fwInk)
                        .monospacedDigit()
                    if onOpenHours != nil {
                        Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
                    }
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Color.fwRaised, in: .rect(cornerRadius: 10))
            }
            .buttonStyle(PressableStyle())
            .disabled(onOpenHours == nil)
            .accessibilityLabel("Hours this week, \(HoursFormat.duration(clock.weekMinutes(now: now)))")
        }
        .fwCard(padding: 16, border: isOn ? Color.fwClear.opacity(0.45) : .fwLine)
        .background(alignment: .topTrailing) {
            if isOn {
                Circle().fill(Color.fwClear.opacity(0.18)).frame(width: 160, height: 160).blur(radius: 50).offset(x: 40, y: -40)
                    .allowsHitTesting(false)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isOn)
    }

    private func punch() async {
        let wasOn = clock.open != nil
        do {
            if wasOn {
                let finished = try await clock.clockOut()
                punchCount += 1
                let worked = finished.map { HoursFormat.duration($0.minutes()) } ?? ""
                router.show("Clocked out", detail: worked.isEmpty ? "Sent for approval" : "\(worked) recorded · sent for approval")
            } else {
                try await clock.clockIn()
                punchCount += 1
                router.show("Clocked in", detail: "Started at \(Fmt.time(clock.open?.clockIn ?? Date()))")
            }
        } catch {
            router.show(ErrorText.from(error), style: .error)
        }
    }
}

private struct PunchButtonStyle: ViewModifier {
    let isOn: Bool

    func body(content: Content) -> some View {
        if isOn {
            content.buttonStyle(OutlineButtonStyle())
        } else {
            content.buttonStyle(PrimaryButtonStyle())
        }
    }
}
