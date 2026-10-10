import SwiftUI

/// Dashboard tile for one site: tap opens the property; one-tap Log Patrol with live timer state.
struct SiteCardView: View {
    let property: Property
    let lastPatrol: Patrol?
    let schedule: PatrolSchedule?
    let now: Date
    let onOpen: () -> Void
    let onLog: () -> Void

    private var tone: Color {
        guard let schedule else { return .fwLine }
        if schedule.isOverdue { return .fwIncident }
        if schedule.isWarning { return .fwFollow }
        return .fwEmber
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onOpen) {
                HStack(alignment: .top, spacing: 14) {
                    SiteThumbView(imagePath: property.imagePath, size: 60, tint: .fwSilver)
                        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.fwLine, lineWidth: 1) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(property.name)
                            .font(.system(.headline, weight: .bold))
                            .foregroundStyle(Color.fwInk)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                        if !property.address.isEmpty {
                            Label(property.address, systemImage: "mappin.and.ellipse")
                                .font(.subheadline)
                                .foregroundStyle(Color.fwInk2)
                                .lineLimit(1)
                        }
                        HStack(spacing: 6) {
                            if let lastPatrol {
                                StatusDot(color: lastPatrol.status.color, size: 8)
                                Text("Last patrol \(Fmt.relative(lastPatrol.dateTime, now: now))")
                            } else {
                                Image(systemName: "clock")
                                Text("No patrols yet")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(Color.fwInk3)
                        .padding(.top, 2)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Color.fwInk3)
                        .padding(.top, 4)
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Open \(property.name)")

            Divider().overlay(Color.fwLine)

            HStack(spacing: 10) {
                timerStatus
                Spacer(minLength: 8)
                Button(action: onLog) {
                    Label("Log Patrol", systemImage: "plus")
                }
                .buttonStyle(EmberButtonStyle(fullWidth: false, compact: true))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Color.fwSurface, in: .rect(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(schedule == nil ? Color.fwLine : tone.opacity(0.45), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var timerStatus: some View {
        if let schedule {
            Label {
                Text(schedule.isOverdue ? "Patrol overdue" : "Due in \(Fmt.countdown(schedule.remaining))")
                    .monospacedDigit()
            } icon: {
                Image(systemName: "alarm.fill")
            }
            .font(.system(.subheadline, weight: .semibold))
            .foregroundStyle(schedule.isOverdue ? Color.fwIncident : schedule.isWarning ? Color.fwFollow : Color.fwInk2)
            .lineLimit(1)
        } else {
            Label("Timer off", systemImage: "alarm")
                .font(.subheadline)
                .foregroundStyle(Color.fwInk3)
        }
    }
}
