import MapKit
import SwiftUI

/// Map showing a property's circular geofence and, optionally, the officer's live position.
struct GeofenceMapView: View {
    let center: CLLocationCoordinate2D
    let radiusM: Double
    var you: PatrolLocation?
    var tint: Color = .fwEmber
    var interactive: Bool = false

    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $position, interactionModes: interactive ? .all : []) {
            MapCircle(center: center, radius: radiusM)
                .foregroundStyle(tint.opacity(0.16))
                .stroke(tint, lineWidth: 2)
            Annotation("Geofence center", coordinate: center, anchor: .center) {
                Circle()
                    .fill(tint)
                    .frame(width: 14, height: 14)
                    .overlay { Circle().strokeBorder(.white, lineWidth: 2.5) }
            }
            .annotationTitles(.hidden)
            if let you {
                MapCircle(center: you.coordinate, radius: max(you.accuracyM, 3))
                    .foregroundStyle(Color.blue.opacity(0.14))
                Annotation("You", coordinate: you.coordinate, anchor: .center) {
                    Circle()
                        .fill(Color.blue)
                        .frame(width: 16, height: 16)
                        .overlay { Circle().strokeBorder(.white, lineWidth: 3) }
                        .shadow(color: .blue.opacity(0.5), radius: 6)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .allowsHitTesting(interactive)
        .onAppear(perform: fit)
        .onChange(of: you != nil) { _, _ in fit() }
        .onChange(of: radiusM) { _, _ in fit() }
        .onChange(of: center.latitude) { _, _ in fit() }
        .accessibilityElement()
        .accessibilityLabel("Geofence map, \(Distance.format(radiusM)) radius")
    }

    private func fit() {
        position = .rect(GeofenceMapView.frame(center: center, radiusM: radiusM, including: you?.coordinate))
    }

    /// Map rect covering the circle (with breathing room) and an optional extra point.
    static func frame(center: CLLocationCoordinate2D, radiusM: Double, including point: CLLocationCoordinate2D? = nil) -> MKMapRect {
        var rect = MKCircle(center: center, radius: radiusM * 1.25).boundingMapRect
        if let point {
            let p = MKMapPoint(point)
            rect = rect.union(MKMapRect(x: p.x, y: p.y, width: 0, height: 0))
        }
        let pad = max(rect.size.width, rect.size.height) * 0.12
        return rect.insetBy(dx: -pad, dy: -pad)
    }
}
