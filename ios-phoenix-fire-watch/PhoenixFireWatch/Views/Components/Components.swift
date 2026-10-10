import SwiftUI

/// Silver phoenix crest with its brand ember glow (brand colors are kept as-is).
struct CrestView: View {
    var size: CGFloat = 72
    var glow: Bool = true

    var body: some View {
        Image("PhoenixCrest")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .background {
                if glow {
                    Circle()
                        .fill(Color.fwBrandEmber.opacity(0.35))
                        .blur(radius: size * 0.28)
                        .scaleEffect(1.05)
                }
            }
            .accessibilityHidden(true)
    }
}

/// "PHOENIX / FIRE WATCH" wordmark.
struct Wordmark: View {
    var scale: CGFloat = 1

    var body: some View {
        VStack(spacing: 4 * scale) {
            Text("PHOENIX")
                .font(FWFont.wordmark(30 * scale))
                .tracking(5 * scale)
                .foregroundStyle(Color.fwSilver)
            Text("FIRE WATCH")
                .font(.system(size: 11 * scale, weight: .semibold))
                .tracking(5 * scale)
                .foregroundStyle(Color.fwLink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Phoenix Fire Watch")
    }
}

struct SectionLabel: View {
    let text: String
    var color: Color = .fwInk3

    var body: some View {
        Text(text.uppercased())
            .font(FWFont.label)
            .tracking(1.6)
            .foregroundStyle(color)
    }
}

struct StatusDot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
    }
}

struct StatusPill: View {
    let status: PatrolStatus

    var body: some View {
        HStack(spacing: 6) {
            StatusDot(color: status.color, size: 7)
            Text(status.label)
                .font(.system(.caption, weight: .semibold))
        }
        .foregroundStyle(status.textColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(status.color.opacity(0.12), in: Capsule())
        .overlay { Capsule().strokeBorder(status.color.opacity(0.3), lineWidth: 1) }
    }
}

struct SyncBadge: View {
    let state: SyncState

    var body: some View {
        Label(state == .pending ? "Waiting to upload" : "Upload failed", systemImage: state == .pending ? "icloud.and.arrow.up" : "exclamationmark.icloud")
            .font(.system(.caption2, weight: .semibold))
            .foregroundStyle(state == .pending ? Color.fwFollow : Color.fwIncidentInk)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background((state == .pending ? Color.fwFollow : Color.fwIncident).opacity(0.12), in: Capsule())
    }
}

/// Big numeral tile with a colored status dot label.
struct StatTile: View {
    let label: String
    let value: Int
    let color: Color
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 7) {
                    StatusDot(color: color, size: 7)
                    SectionLabel(text: label)
                }
                Spacer(minLength: 4)
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(color.opacity(0.9))
            }
            Text("\(value)")
                .font(.system(size: 34, weight: .heavy))
                .foregroundStyle(Color.fwInk)
                .contentTransition(.numericText())
                .monospacedDigit()
        }
        .fwCard(padding: 16)
        .accessibilityElement(children: .combine)
    }
}

/// Labeled dark text field.
struct FWField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var required: Bool = false
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType?
    var secure: Bool = false
    var autocapitalization: TextInputAutocapitalization = .sentences
    var error: String?
    @FocusState private var isFocused: Bool

    private var borderColor: Color {
        if error != nil { return .fwIncident }
        return isFocused ? .fwLink : .fwLineStrong
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 2) {
                Text(label).font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                if required { Text("*").foregroundStyle(Color.fwLink) }
            }
            Group {
                if secure {
                    SecureField("", text: $text, prompt: Text(placeholder).foregroundStyle(Color.fwInk3))
                } else {
                    TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Color.fwInk3))
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(autocapitalization)
                }
            }
            .textContentType(contentType)
            .autocorrectionDisabled(keyboard == .emailAddress || secure)
            .focused($isFocused)
            .foregroundStyle(Color.fwInk)
            .tint(Color.fwLink)
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(Color.fwField, in: .rect(cornerRadius: 11))
            .overlay {
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(borderColor, lineWidth: isFocused ? 1.5 : 1)
            }
            .animation(.easeOut(duration: 0.15), value: isFocused)
            if let error {
                Text(error).font(.caption).foregroundStyle(Color.fwIncidentInk)
            }
        }
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.fwIncidentInk)
            Text(message).font(.subheadline).foregroundStyle(Color.fwInk)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color.fwIncident.opacity(0.1), in: .rect(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwIncident.opacity(0.35), lineWidth: 1) }
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

/// Patrol photo from the private bucket or this device, with a loading state.
struct PatrolPhotoView: View {
    let ref: String
    @State private var image: UIImage?
    @State private var failed: Bool = false

    var body: some View {
        Color.fwRaised
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .allowsHitTesting(false)
                        .transition(.opacity)
                } else if failed {
                    Image(systemName: "photo.badge.exclamationmark").foregroundStyle(Color.fwInk3)
                } else {
                    ProgressView().tint(Color.fwInk3)
                }
            }
            .clipped()
            .task(id: ref) {
                let loaded = await PhotoLoader.shared.image(for: ref)
                withAnimation(.easeOut(duration: 0.2)) {
                    image = loaded
                    failed = loaded == nil
                }
            }
    }
}

extension Patrol {
    /// Photo references for display (`local:` files until the patrol uploads).
    var photoRefs: [String] {
        localPhotoFiles.isEmpty ? photos : localPhotoFiles.map { "local:\($0)" }
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.fwPrimary.opacity(0.1)).frame(width: 64, height: 64)
                Image(systemName: symbol)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Color.fwLink)
            }
            Text(title).font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.fwInk2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 20)
    }
}

/// Toast shown at the top of the app.
struct ToastView: View {
    let toast: Toast

    private var color: Color {
        switch toast.style {
        case .success: .fwClear
        case .error: .fwIncidentInk
        case .info: .fwFollow
        }
    }

    private var symbol: String {
        switch toast.style {
        case .success: "checkmark.circle.fill"
        case .error: "xmark.octagon.fill"
        case .info: "icloud.and.arrow.up.fill"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.message).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk)
                if let detail = toast.detail {
                    Text(detail).font(.caption).foregroundStyle(Color.fwInk2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color.fwSurface.opacity(0.97), in: .rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.35), lineWidth: 1) }
        .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
        .padding(.horizontal, 16)
    }
}

struct LegalLinks: View {
    var body: some View {
        HStack(spacing: 14) {
            Link("Privacy", destination: Legal.privacyURL)
            Text("·").foregroundStyle(Color.fwInk3)
            Link("Terms", destination: Legal.termsURL)
            Text("·").foregroundStyle(Color.fwInk3)
            Link("Support", destination: Legal.supportURL)
        }
        .font(.footnote)
        .tint(Color.fwInk2)
    }
}
