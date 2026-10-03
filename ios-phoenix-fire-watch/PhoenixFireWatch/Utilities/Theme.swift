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

    // "Ember Command" palette — see .rork/DESIGN.md
    nonisolated static let fwCanvas = Color(hex: 0x0B0B0C)
    nonisolated static let fwRail = Color(hex: 0x0E0F10)
    nonisolated static let fwSurface = Color(hex: 0x17181A)
    nonisolated static let fwRaised = Color(hex: 0x1D1E21)
    nonisolated static let fwLine = Color(hex: 0x232427)
    nonisolated static let fwLineStrong = Color(hex: 0x34363B)
    nonisolated static let fwInk = Color(hex: 0xE9EAEC)
    nonisolated static let fwInk2 = Color(hex: 0x9A9DA3)
    nonisolated static let fwInk3 = Color(hex: 0x6B6E74)
    nonisolated static let fwSilver = Color(hex: 0xC6C9CE)
    nonisolated static let fwEmber = Color(hex: 0xDC2626)
    nonisolated static let fwEmberHover = Color(hex: 0xF04438)
    nonisolated static let fwClear = Color(hex: 0x22C55E)
    nonisolated static let fwFollow = Color(hex: 0xF5A524)
    nonisolated static let fwIncident = Color(hex: 0xEF4444)
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

/// Near-black canvas with a faint ember glow in the top-right corner.
struct CanvasBackground: View {
    var body: some View {
        ZStack {
            Color.fwCanvas
            RadialGradient(
                colors: [Color.fwEmber.opacity(0.16), Color.fwEmber.opacity(0)],
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
    }
}

extension View {
    func fwCard(padding: CGFloat = 18, border: Color = .fwLine) -> some View {
        modifier(FWCardModifier(padding: padding, borderColor: border))
    }

    /// Standard dark navigation chrome for every stack.
    func fwNavigationChrome() -> some View {
        self
            .toolbarBackground(Color.fwCanvas.opacity(0.92), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// Primary red action button with a press-down spring.
struct EmberButtonStyle: ButtonStyle {
    var fullWidth: Bool = true
    var compact: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        EmberButtonBody(configuration: configuration, fullWidth: fullWidth, compact: compact)
    }

    private struct EmberButtonBody: View {
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
                    (configuration.isPressed ? Color.fwEmberHover : Color.fwEmber).opacity(isEnabled ? 1 : 0.45),
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
            .background(configuration.isPressed ? Color.fwRaised : Color.fwSurface, in: .rect(cornerRadius: 12))
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
