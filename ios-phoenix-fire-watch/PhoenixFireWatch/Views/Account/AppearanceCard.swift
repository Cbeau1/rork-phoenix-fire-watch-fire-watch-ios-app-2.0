import SwiftUI

/// Settings → Appearance: Light / Dark / System. Saved on device and applied instantly.
struct AppearanceCard: View {
    @AppStorage(AppearancePreference.storageKey) private var appearanceRaw: String = AppearancePreference.system.rawValue
    @Environment(\.colorScheme) private var colorScheme: ColorScheme

    private var selection: AppearancePreference { AppearancePreference.from(appearanceRaw) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Appearance", color: .fwLink)
            Text(selection == .system
                 ? "Following your device — currently \(colorScheme == .dark ? "Dark" : "Light")."
                 : "Choose how Phoenix Fire Watch looks on this device.")
                .font(.footnote)
                .foregroundStyle(Color.fwInk2)
            HStack(spacing: 10) {
                ForEach(AppearancePreference.allCases) { option in
                    AppearanceOptionTile(option: option, isSelected: option == selection) {
                        withAnimation(.easeInOut(duration: 0.25)) { appearanceRaw = option.rawValue }
                    }
                }
            }
        }
        .fwCard()
        .sensoryFeedback(.selection, trigger: appearanceRaw)
    }
}

private struct AppearanceOptionTile: View {
    let option: AppearancePreference
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                preview
                    .frame(height: 64)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .overlay(alignment: .topTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 18, weight: .bold))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Color.fwPrimary)
                                .padding(5)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                Divider().overlay(Color.fwLine)
                HStack(spacing: 6) {
                    Image(systemName: option.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isSelected ? Color.fwLink : Color.fwInk3)
                    Text(option.label)
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.fwInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
            }
            .background(Color.fwSurface)
            .clipShape(.rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isSelected ? Color.fwPrimary : Color.fwLine, lineWidth: isSelected ? 2 : 1)
            }
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("\(option.label) appearance")
        .accessibilityHint(option.hint)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    @ViewBuilder
    private var preview: some View {
        switch option {
        case .light: MiniScreen(isDark: false)
        case .dark: MiniScreen(isDark: true)
        case .system:
            HStack(spacing: 0) {
                MiniScreen(isDark: false)
                MiniScreen(isDark: true)
            }
        }
    }
}

/// Tiny app mock in fixed colors so each tile previews its theme regardless of the active one.
private struct MiniScreen: View {
    let isDark: Bool

    var body: some View {
        let canvas = Color(hex: isDark ? 0x0F172A : 0xF1F5F9)
        let card = Color(hex: isDark ? 0x1E293B : 0xFFFFFF)
        let line = Color(hex: isDark ? 0x334155 : 0xE2E8F0)
        let ink = Color(hex: isDark ? 0xF8FAFC : 0x0F172A)
        let ink2 = Color(hex: 0x94A3B8)
        VStack(alignment: .leading, spacing: 5) {
            Capsule().fill(ink).frame(width: 26, height: 4)
            VStack(alignment: .leading, spacing: 4) {
                Capsule().fill(ink2).frame(width: 30, height: 3)
                Capsule().fill(ink2).frame(width: 20, height: 3)
                RoundedRectangle(cornerRadius: 2).fill(Color.fwPrimary).frame(width: 18, height: 6)
            }
            .padding(6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(card, in: .rect(cornerRadius: 4))
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(line, lineWidth: 1) }
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(canvas)
    }
}
