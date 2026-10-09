import SwiftUI

/// Result of the on-site check on the Log Patrol form.
enum GeofenceVerdict: Equatable {
    case checking
    case inside(distance: Double)
    case outside(distance: Double)
    case blocked

    var allowsLogging: Bool {
        if case .inside = self { return true }
        return false
    }

    static func evaluate(_ geofence: Geofence, location: LocationService) -> GeofenceVerdict {
        switch location.status {
        case .denied, .unavailable: return .blocked
        case .ready:
            guard let fix = location.fix else { return .checking }
            let result = geofence.check(fix)
            return result.inside ? .inside(distance: result.distance) : .outside(distance: result.distance)
        case .idle, .locating: return .checking
        }
    }
}

/// Live "are you on site?" panel at the top of Log Patrol for geofenced properties.
struct GeofenceStatusCard: View {
    let property: Property
    let location: LocationService

    @Environment(\.openURL) private var openURL

    private var verdict: GeofenceVerdict { GeofenceVerdict.evaluate(property.geofence, location: location) }
    private var radius: Double { Double(property.geofence.radiusM ?? 0) }

    var body: some View {
        let v = verdict
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                icon(v)
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 26)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title(v)).font(.system(.subheadline, weight: .bold)).foregroundStyle(Color.fwInk)
                    Text(detail(v)).font(.footnote).foregroundStyle(Color.fwInk2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            if case .blocked = v {
                actionRow
            } else if case .outside = v {
                Button {
                    location.restart()
                } label: {
                    Label("Recheck location", systemImage: "location.fill")
                }
                .buttonStyle(OutlineButtonStyle(tint: .fwInk, compact: true))
                .padding([.horizontal, .bottom], 14)
            }
            if let center = property.geofence.center {
                GeofenceMapView(center: center, radiusM: radius, you: location.fix, tint: color(v))
                    .frame(height: 190)
            }
        }
        .background(color(v).opacity(0.08), in: .rect(cornerRadius: 14))
        .clipShape(.rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(color(v).opacity(0.45), lineWidth: 1) }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: v)
        .sensoryFeedback(trigger: v.allowsLogging) { _, inside in inside ? .success : nil }
        .accessibilityElement(children: .contain)
    }

    private var actionRow: some View {
        HStack(spacing: 10) {
            if location.status == .denied {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                } label: {
                    Label("Open Settings", systemImage: "gearshape.fill")
                }
                .buttonStyle(EmberButtonStyle(compact: true))
            }
            Button {
                location.restart()
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(OutlineButtonStyle(tint: .fwInk, compact: true))
        }
        .padding([.horizontal, .bottom], 14)
    }

    private func color(_ v: GeofenceVerdict) -> Color {
        switch v {
        case .inside: .fwClear
        case .checking: .fwFollow
        case .outside, .blocked: .fwIncident
        }
    }

    @ViewBuilder
    private func icon(_ v: GeofenceVerdict) -> some View {
        switch v {
        case .checking: ProgressView().tint(Color.fwFollow)
        case .inside: Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.fwClear)
        case .outside: Image(systemName: "location.slash.fill").foregroundStyle(Color.fwIncident)
        case .blocked: Image(systemName: "location.slash.circle.fill").foregroundStyle(Color.fwIncident)
        }
    }

    private func title(_ v: GeofenceVerdict) -> String {
        switch v {
        case .checking: "Checking your location…"
        case .inside: "You're on site"
        case .outside: "Outside the geofence"
        case .blocked: location.status == .denied ? "Location access is off" : "Can't get your location"
        }
    }

    private func detail(_ v: GeofenceVerdict) -> String {
        let accuracy = location.fix?.accuracyM ?? 0
        switch v {
        case .checking:
            return "You need to be within \(Distance.format(radius)) of \(property.name) to log a patrol."
        case .inside(let d):
            return "\(Distance.format(d)) from the center · GPS ±\(Distance.format(accuracy))"
        case .outside(let d):
            var text = "You're about \(Distance.format(d)) away. Move within \(Distance.format(radius)) of \(property.name) to log this patrol."
            if accuracy > 100 { text += " GPS accuracy is low (±\(Distance.format(accuracy)))." }
            return text
        case .blocked:
            if case .unavailable(let message) = location.status { return message }
            return "This property requires you to be on site. Allow location access for Phoenix Fire Watch while using the app."
        }
    }
}
