import SwiftUI

/// One shift on the weekly schedule. Paid shifts turn Clear green (admins only);
/// the signed-in officer's own shifts are tinted ember with a YOU tag.
struct ShiftCardView: View {
    let shift: Shift
    let staffName: String
    let propertyName: String?
    let isAdmin: Bool
    let isMine: Bool
    var onEdit: (() -> Void)?
    var onTogglePaid: (() -> Void)?

    private var paid: Bool { isAdmin && shift.isPaid }

    private var accent: Color {
        if paid { return .fwClear }
        if isMine { return .fwPrimary }
        return .fwLineStrong
    }

    private var fill: Color {
        if paid { return Color.fwClear.opacity(0.10) }
        if isMine { return Color.fwPrimary.opacity(0.09) }
        return .fwRaised
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let onEdit {
                Button(action: onEdit) { details }
                    .buttonStyle(PressableStyle())
                    .accessibilityHint("Edit shift")
            } else {
                details
            }
            if isAdmin, let onTogglePaid {
                PayToggleButton(isPaid: shift.isPaid, action: onTogglePaid)
            }
        }
        .padding(.vertical, 11)
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .background(fill, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(paid ? Color.fwClear.opacity(0.45) : isMine ? Color.fwPrimary.opacity(0.4) : Color.fwLine, lineWidth: 1)
        }
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12)
                .fill(accent)
                .frame(width: 3)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: paid)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(staffName)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.fwInk)
                    .lineLimit(1)
                if isMine {
                    Text("YOU")
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(1)
                        .foregroundStyle(Color.fwLink)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.fwPrimary.opacity(0.15), in: Capsule())
                }
            }
            HStack(spacing: 6) {
                if shift.isOvernight {
                    Image(systemName: "moon.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.fwSilver)
                        .accessibilityLabel("Overnight")
                }
                Text(shift.rangeLabel)
                    .font(FWFont.mono(.caption, weight: .semibold))
                    .foregroundStyle(paid ? Color.fwClear : Color.fwInk2)
                Text("· \(ScheduleDates.hours(shift.minutes))")
                    .font(FWFont.mono(.caption))
                    .foregroundStyle(Color.fwInk3)
            }
            if let propertyName {
                Label(propertyName, systemImage: "building.2")
                    .font(.caption)
                    .foregroundStyle(Color.fwInk3)
                    .lineLimit(1)
                    .labelStyle(TightLabelStyle())
            }
            if !shift.notes.isEmpty {
                Text(shift.notes)
                    .font(.caption)
                    .foregroundStyle(Color.fwInk2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }
}

/// Green "Mark Paid" / "Paid" toggle on a shift.
struct PayToggleButton: View {
    let isPaid: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: isPaid ? "checkmark.circle.fill" : "dollarsign.circle")
                    .font(.system(size: 13, weight: .bold))
                    .contentTransition(.symbolEffect(.replace))
                Text(isPaid ? "Paid" : "Mark Paid")
                    .font(.system(.caption, weight: .bold))
            }
            .foregroundStyle(isPaid ? Color.fwOnClear : Color.fwClear)
            .padding(.horizontal, 11)
            .frame(minHeight: 34)
            .background(isPaid ? Color.fwClear : Color.fwClear.opacity(0.08), in: Capsule())
            .overlay { Capsule().strokeBorder(Color.fwClear.opacity(isPaid ? 0 : 0.5), lineWidth: 1) }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.success, trigger: isPaid) { _, new in new }
        .sensoryFeedback(.impact(weight: .light), trigger: isPaid) { _, new in !new }
        .accessibilityLabel(isPaid ? "Paid. Tap to mark unpaid" : "Mark paid")
    }
}

struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 10, weight: .semibold))
            configuration.title
        }
    }
}
