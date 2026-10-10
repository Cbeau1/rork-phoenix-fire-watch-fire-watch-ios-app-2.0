import SwiftUI

extension Color {
    nonisolated init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    // "Navy Command" palette — see .rork/DESIGN.md. Mirrors web tailwind.config.ts + src/lib/theme.ts.
    /// Main background.
    nonisolated static let fwCanvas = Color(hex: 0x0F172A)
    /// Full-screen viewers (camera, report, map backdrops).
    nonisolated static let fwCanvasDeep = Color(hex: 0x0B1220)
    /// Navigation bars, tab bar, sheets' chrome.
    nonisolated static let fwRail = Color(hex: 0x1E293B)
    /// Cards, headers and elevated surfaces.
    nonisolated static let fwSurface = Color(hex: 0x1E293B)
    /// Tiles, chips and rows sitting inside a card.
    nonisolated static let fwRaised = Color(hex: 0x273449)
    /// Text inputs — inset, darker than the card so fields are obvious.
    nonisolated static let fwField = Color(hex: 0x0F172A)
    /// Borders and dividers.
    nonisolated static let fwLine = Color(hex: 0x334155)
    /// Input / outline-button borders.
    nonisolated static let fwLineStrong = Color(hex: 0x475569)
    nonisolated static let fwInk = Color(hex: 0xF8FAFC)
    nonisolated static let fwInk2 = Color(hex: 0xCBD5E1)
    nonisolated static let fwInk3 = Color(hex: 0x94A3B8)
    nonisolated static let fwSilver = Color(hex: 0xE2E8F0)
    /// Primary actions (white text on top).
    nonisolated static let fwPrimary = Color(hex: 0x2563EB)
    nonisolated static let fwPrimaryPressed = Color(hex: 0x1D4ED8)
    /// Links, accent text/icons and focus.
    nonisolated static let fwLink = Color(hex: 0x60A5FA)
    nonisolated static let fwLinkHover = Color(hex: 0x93C5FD)
    /// Success / active.
    nonisolated static let fwClear = Color(hex: 0x22C55E)
    /// Warnings.
    nonisolated static let fwFollow = Color(hex: 0xF59E0B)
    /// Critical alerts and destructive actions (fills, borders).
    nonisolated static let fwIncident = Color(hex: 0xDC2626)
    /// Red for text/icons on navy (readable contrast).
    nonisolated static let fwIncidentInk = Color(hex: 0xF87171)
    /// Phoenix logo glow only — part of the brand mark, never used for UI.
    nonisolated static let fwBrandEmber = Color(hex: 0xDC2626)
}

/// One hue per weekday (Mon → Sun) so Schedule days scan at a glance. Mirrors the web app.
nonisolated enum DayPalette {
    private static let hexes: [UInt32] = [
        0xF87171, 0xFB923C, 0xFBBF24, 0x4ADE80, 0x38BDF8, 0xA78BFA, 0xF472B6,
    ]

    static func color(for day: Date) -> Color {
        let weekday = Calendar.current.component(.weekday, from: day) // 1 = Sunday … 7 = Saturday
        return Color(hex: hexes[(weekday + 5) % 7])
    }
}

enum FWFont {
    /// Heavy grotesque for titles and stat numerals.
    static func display(_ style: Font.TextStyle = .largeTitle) -> Font {
        .system(style, design: .default, weight: .heavy)
    }

    /// Serif wordmark ("PHOENIX").
    static func wordmark(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .serif)
    }

    static func mono(_ style: Font.TextStyle = .body, weight: Font.Weight = .medium) -> Font {
        .system(style, design: .monospaced, weight: weight)
    }

    /// Small uppercase section label.
    static let label: Font = .system(.caption2, design: .default, weight: .semibold)
}

/// Navy canvas with a faint blue glow in the top-right corner.
struct CanvasBackground: View {
    var body: some View {
        ZStack {
            Color.fwCanvas
            RadialGradient(
                colors: [Color.fwPrimary.opacity(0.14), Color.fwPrimary.opacity(0)],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 420
            )
        }
        .ignoresSafeArea()
    }
}

struct FWCardModifier: ViewModifier {
    var padding: CGFloat = 18
    var borderColor: Color = .fwLine

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.fwSurface, in: .rect(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14).strokeBorder(borderColor, lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.25), radius: 2, y: 1)
    }
}

extension View {
    func fwCard(padding: CGFloat = 18, border: Color = .fwLine) -> some View {
        modifier(FWCardModifier(padding: padding, borderColor: border))
    }

    /// Caps content to a comfortable reading width and centers it, so screens
    /// look composed on iPad instead of stretching edge to edge. No effect on iPhone.
    func fwReadable(_ maxWidth: CGFloat = 760) -> some View {
        self
            .frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity)
    }

    /// Standard dark navigation chrome for every stack.
    func fwNavigationChrome() -> some View {
        self
            .toolbarBackground(Color.fwRail.opacity(0.94), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// Primary blue action button (white label) with a press-down spring.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth: Bool = true
    var compact: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonBody(configuration: configuration, fullWidth: fullWidth, compact: compact)
    }

    private struct PrimaryButtonBody: View {
        let configuration: Configuration
        let fullWidth: Bool
        let compact: Bool
        @Environment(\.isEnabled) private var isEnabled: Bool

        var body: some View {
            configuration.label
                .font(.system(compact ? .subheadline : .body, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, compact ? 14 : 18)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: compact ? 40 : 52)
                .background(
                    (configuration.isPressed ? Color.fwPrimaryPressed : Color.fwPrimary).opacity(isEnabled ? 1 : 0.45),
                    in: .rect(cornerRadius: 12)
                )
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
        }
    }
}

/// Hairline outline button.
struct OutlineButtonStyle: ButtonStyle {
    var fullWidth: Bool = true
    var tint: Color = .fwInk
    var compact: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(compact ? .subheadline : .body, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, compact ? 14 : 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: compact ? 40 : 50)
            .background(configuration.isPressed ? Color.fwRaised : Color.clear, in: .rect(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Subtle scale on press for tappable cards and rows.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.75), value: configuration.isPressed)
    }
}
