import MapKit
import SwiftUI

/// Admin editor: tap the map to place the area, then make it larger or smaller.
struct GeofenceEditorView: View {
    let property: Property

    @Environment(\.dismiss) private var dismiss
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router

    @State private var enabled: Bool = true
    @State private var center: CLLocationCoordinate2D?
    @State private var radius: Double = Double(Geofence.defaultRadius)
    @State private var position: MapCameraPosition = .automatic
    @State private var query: String = ""
    @State private var searching: Bool = false
    @State private var saving: Bool = false
    @State private var location: LocationService = LocationService()
    @State private var locating: Bool = false
    @State private var didLoad: Bool = false

    private let presets: [Int] = [50, 100, 250, 500, 1000]
    private static let ratio = Double(Geofence.maxRadius) / Double(Geofence.minRadius)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Toggle(isOn: $enabled.animation()) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Require officers to be on site").font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk)
                        Text(enabled ? "Patrols outside the area are blocked." : "Off — patrols can be logged from anywhere.")
                            .font(.caption).foregroundStyle(Color.fwInk3)
                    }
                }
                .tint(Color.fwPrimary)
                .fwCard(padding: 14)

                Group {
                    searchRow
                    mapSection
                    radiusCard
                }
                .disabled(!enabled)
                .opacity(enabled ? 1 : 0.45)
            }
            .padding(16)
            .fwReadable(760)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(CanvasBackground())
        .navigationTitle("Geofence")
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }.disabled(saving)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text("Save").fontWeight(.semibold) }
                }
                .disabled(saving || (enabled && center == nil))
            }
        }
        .interactiveDismissDisabled(saving)
        .task { await load() }
        .onDisappear { location.stop() }
    }

    private var searchRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Color.fwInk3)
                TextField("", text: $query, prompt: Text("Search an address").foregroundStyle(Color.fwInk3))
                    .foregroundStyle(Color.fwInk)
                    .textContentType(.fullStreetAddress)
                    .submitLabel(.search)
                    .onSubmit { Task { await search(query) } }
                if searching { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(Color.fwField, in: .rect(cornerRadius: 11))
            .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }

            Button {
                Task { await locateMe() }
            } label: {
                Group {
                    if locating { ProgressView() } else { Image(systemName: "location.fill") }
                }
                .frame(width: 44, height: 44)
            }
            .buttonStyle(OutlineButtonStyle(fullWidth: false, tint: .fwInk, compact: true))
            .accessibilityLabel("Use my location")
        }
    }

    private var mapSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            MapReader { proxy in
                Map(position: $position) {
                    if let center {
                        MapCircle(center: center, radius: radius)
                            .foregroundStyle(Color.fwPrimary.opacity(0.16))
                            .stroke(Color.fwPrimary, lineWidth: 2)
                        Annotation("Center", coordinate: center, anchor: .center) {
                            Circle()
                                .fill(Color.fwPrimary)
                                .frame(width: 18, height: 18)
                                .overlay { Circle().strokeBorder(.white, lineWidth: 3) }
                        }
                        .annotationTitles(.hidden)
                    }
                    UserAnnotation()
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
                .mapControls { MapCompass() }
                .onTapGesture { point in
                    guard enabled, let coordinate = proxy.convert(point, from: .local) else { return }
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { center = coordinate }
                }
                .sensoryFeedback(.selection, trigger: center?.latitude)
            }
            .frame(height: 340)
            .clipShape(.rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.fwLine, lineWidth: 1) }
            .overlay {
                if center == nil {
                    Label(searching ? "Finding the address…" : "Tap the map to place the area", systemImage: "scope")
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(Color.fwInk)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.fwCanvas.opacity(0.9), in: Capsule())
                        .allowsHitTesting(false)
                }
            }
            Text("Tap the map to move the center. Use the slider or presets to make the area larger or smaller.")
                .font(.caption)
                .foregroundStyle(Color.fwInk3)
        }
    }

    private var radiusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel(text: "Radius", color: .fwInk3)
                Spacer()
                Text(Distance.format(radius, withFeet: true))
                    .font(FWFont.mono(.headline, weight: .semibold))
                    .foregroundStyle(Color.fwInk)
                    .contentTransition(.numericText())
            }
            Slider(value: sliderBinding, in: 0...1, onEditingChanged: { editing in
                if !editing { refit() }
            })
            .tint(Color.fwPrimary)
            .accessibilityLabel("Geofence radius")
            .accessibilityValue(Distance.format(radius))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(presets, id: \.self) { m in
                        let active = Int(radius) == m
                        Button {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { radius = Double(m) }
                            refit()
                        } label: {
                            Text(Distance.format(Double(m)))
                                .font(FWFont.mono(.footnote, weight: .medium))
                                .foregroundStyle(active ? Color.fwLinkHover : Color.fwInk2)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 36)
                                .background(active ? Color.fwPrimary.opacity(0.15) : Color.fwRaised, in: Capsule())
                                .overlay { Capsule().strokeBorder(active ? Color.fwPrimary : Color.fwLine, lineWidth: 1) }
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: Int(radius))
        }
        .fwCard(padding: 16)
    }

    /// Log scale: fine control for small sites, still reaches 5 km.
    private var sliderBinding: Binding<Double> {
        Binding(
            get: { log(radius / Double(Geofence.minRadius)) / log(Self.ratio) },
            set: { v in
                let raw = Double(Geofence.minRadius) * pow(Self.ratio, v)
                let step: Double = raw < 200 ? 5 : raw < 1000 ? 10 : 50
                radius = min(Double(Geofence.maxRadius), max(Double(Geofence.minRadius), (raw / step).rounded() * step))
            }
        )
    }

    private func refit() {
        guard let center else { return }
        withAnimation(.easeInOut(duration: 0.35)) {
            position = .rect(GeofenceMapView.frame(center: center, radiusM: radius))
        }
    }

    private func load() async {
        guard !didLoad else { return }
        didLoad = true
        let g = property.geofence
        enabled = g.enabled || g.lat == nil
        radius = Double(g.radiusM ?? Geofence.defaultRadius)
        query = property.address
        if let c = g.center {
            center = c
            refit()
        } else if !property.address.trimmed.isEmpty {
            await search(property.address, quiet: true)
        }
    }

    private func search(_ text: String, quiet: Bool = false) async {
        let q = text.trimmed
        guard !q.isEmpty else { return }
        searching = true
        defer { searching = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = q
        request.resultTypes = [.address, .pointOfInterest]
        do {
            let response = try await MKLocalSearch(request: request).start()
            guard let item = response.mapItems.first else {
                if !quiet { router.show("Address not found", detail: "Try a fuller address, or tap the map.", style: .error) }
                return
            }
            center = item.placemark.coordinate
            refit()
        } catch {
            if !quiet { router.show("Address not found", detail: "Try a fuller address, or tap the map.", style: .error) }
        }
    }

    private func locateMe() async {
        locating = true
        defer { locating = false }
        do {
            let fix = try await location.currentLocation()
            center = fix.coordinate
            refit()
        } catch {
            router.show(ErrorText.from(error, fallback: "Couldn't get your location"), style: .error)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let next = Geofence(
            enabled: enabled,
            lat: center?.latitude,
            lng: center?.longitude,
            radiusM: center == nil ? nil : Int(radius)
        )
        do {
            try await store.setGeofence(propertyId: property.id, geofence: next)
            router.show(
                enabled ? "Geofence saved" : "Geofence turned off",
                detail: enabled ? "Patrols must be logged within \(Distance.format(radius))." : "Patrols can be logged from anywhere."
            )
            dismiss()
        } catch {
            router.show(ErrorText.from(error, fallback: "Couldn't save the geofence"), style: .error)
        }
    }
}
