import SwiftUI

/// Geofence summary on Property Detail. Admins can set it up or adjust it.
struct GeofenceSection: View {
    let property: Property
    let isAdmin: Bool

    @State private var editing: Bool = false

    private var g: Geofence { property.geofence }

    var body: some View {
        if g.isActive || isAdmin {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 11)
                            .fill((g.isActive ? Color.fwEmber : Color.fwInk3).opacity(0.14))
                            .frame(width: 44, height: 44)
                        Image(systemName: "mappin.and.ellipse.circle.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(g.isActive ? Color.fwEmber : Color.fwInk3)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text("Geofence").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                            HStack(spacing: 5) {
                                StatusDot(color: g.isActive ? .fwClear : .fwInk3, size: 6)
                                Text(g.isActive ? "ON" : "OFF").font(.system(.caption2, weight: .bold)).tracking(1)
                            }
                            .foregroundStyle(g.isActive ? Color.fwClear : Color.fwInk3)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background((g.isActive ? Color.fwClear : Color.fwInk3).opacity(0.12), in: Capsule())
                        }
                        Text(g.isActive
                             ? "Patrols can only be logged within \(Distance.format(Double(g.radiusM ?? 0))) of this site."
                             : "Require officers to be on site before they can log a patrol.")
                            .font(.footnote)
                            .foregroundStyle(Color.fwInk2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }

                if g.isActive, let center = g.center {
                    GeofenceMapView(center: center, radiusM: Double(g.radiusM ?? 0))
                        .frame(height: 170)
                        .clipShape(.rect(cornerRadius: 12))
                        .overlay(alignment: .bottomLeading) {
                            Text(Distance.format(Double(g.radiusM ?? 0), withFeet: true))
                                .font(FWFont.mono(.caption, weight: .semibold))
                                .foregroundStyle(Color.fwInk)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color.fwCanvas.opacity(0.88), in: Capsule())
                                .padding(10)
                        }
                        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.fwLine, lineWidth: 1) }
                }

                if isAdmin {
                    if g.isActive {
                        Button {
                            editing = true
                        } label: {
                            Label("Adjust Geofence", systemImage: "slider.horizontal.3")
                        }
                        .buttonStyle(OutlineButtonStyle(tint: .fwInk, compact: true))
                    } else {
                        Button {
                            editing = true
                        } label: {
                            Label("Set Up Geofence", systemImage: "plus.circle.fill")
                        }
                        .buttonStyle(EmberButtonStyle(compact: true))
                    }
                }
            }
            .fwCard()
            .sheet(isPresented: $editing) {
                NavigationStack { GeofenceEditorView(property: property) }
            }
        }
    }
}
