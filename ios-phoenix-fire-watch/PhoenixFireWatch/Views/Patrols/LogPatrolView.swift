import SwiftUI

/// Log Fire Watch Patrol form. Saves on the device first; uploads when online.
struct LogPatrolView: View {
    let propertyId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(AppRouter.self) private var router

    @State private var dateTime: Date = Date()
    @State private var officerName: String = ""
    @State private var areas: String = ""
    @State private var status: PatrolStatus = .clear
    @State private var notes: String = ""
    @State private var photos: [CapturedPhoto] = []
    @State private var cameraOpen: Bool = false
    @State private var saving: Bool = false
    @State private var errors: [String: String] = [:]
    @State private var didPrefill: Bool = false
    @State private var location: LocationService = LocationService()

    private let maxPhotos = 5

    struct CapturedPhoto: Identifiable {
        let id = UUID()
        let data: Data
        let image: UIImage
    }

    private var property: Property? { store.property(id: propertyId) }

    var body: some View {
        Group {
            if let property {
                form(property)
            } else {
                EmptyStateView(symbol: "building.2", title: "Property not found", message: "It may have been deleted.")
            }
        }
        .background(CanvasBackground())
        .navigationTitle("Log Patrol")
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
        }
        .onAppear {
            prefill()
            if property?.geofence.isActive == true { location.start() }
        }
        .onDisappear { location.stop() }
        .onChange(of: property?.geofence.isActive ?? false) { _, active in
            if active { location.start() } else { location.stop() }
        }
        .interactiveDismissDisabled(saving || !photos.isEmpty)
    }

    private func prefill() {
        guard !didPrefill else { return }
        didPrefill = true
        officerName = store.patrols(for: propertyId).first?.officerName ?? auth.user?.name ?? ""
    }

    private func form(_ property: Property) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 11).fill(Color.fwEmber.opacity(0.12)).frame(width: 44, height: 44)
                        Image(systemName: "shield.lefthalf.filled").foregroundStyle(Color.fwEmber).font(.system(size: 20, weight: .semibold))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(property.name).font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                        Text(property.address).font(.caption).foregroundStyle(Color.fwInk2).lineLimit(1)
                    }
                }

                if property.geofence.isActive {
                    GeofenceStatusCard(property: property, location: location)
                }

                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Date & Time").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                        DatePicker("Date & Time", selection: $dateTime, in: ...Date().addingTimeInterval(300))
                            .labelsHidden()
                            .datePickerStyle(.compact)
                            .tint(Color.fwEmber)
                    }
                    FWField(label: "Officer Name", text: $officerName, placeholder: "Full name", required: true, contentType: .name, autocapitalization: .words, error: errors["officer"])
                    VStack(alignment: .leading, spacing: 5) {
                        FWField(label: "Areas Patrolled", text: $areas, placeholder: "e.g. Main lobby, Basement, Garage", required: true, error: errors["areas"])
                        if errors["areas"] == nil {
                            Text("Separate multiple areas with commas").font(.caption).foregroundStyle(Color.fwInk3)
                        }
                    }
                    statusPicker
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Additional Notes").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                        TextField("", text: $notes, prompt: Text("Any observations…").foregroundStyle(Color.fwInk3), axis: .vertical)
                            .lineLimit(3...8)
                            .foregroundStyle(Color.fwInk)
                            .padding(14)
                            .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                            .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
                    }
                }
                .fwCard()

                photoSection(property)

                let verdict = fenceVerdict(property)
                Button {
                    Task { await save(property) }
                } label: {
                    HStack(spacing: 8) {
                        if saving {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: verdict.allowsLogging ? "checkmark.shield.fill" : "location.slash.fill")
                        }
                        Text(saving ? (photos.isEmpty ? "Saving…" : "Uploading…") : saveLabel(verdict))
                    }
                }
                .buttonStyle(EmberButtonStyle())
                .disabled(saving || !verdict.allowsLogging)
                .padding(.bottom, 20)
            }
            .padding(16)
            .fwReadable(680)
        }
        .scrollDismissesKeyboard(.interactively)
        .fullScreenCover(isPresented: $cameraOpen) {
            CameraCaptureView(
                remaining: maxPhotos - photos.count,
                stampLines: [property.name, officerName.trimmed.isEmpty ? "" : "Officer \(officerName.trimmed)"]
            ) { data in
                guard photos.count < maxPhotos, let image = UIImage(data: data) else { return }
                photos.append(CapturedPhoto(data: data, image: image))
            }
        }
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 2) {
                Text("Status").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                Text("*").foregroundStyle(Color.fwEmber)
            }
            HStack(spacing: 8) {
                ForEach(PatrolStatus.allCases) { s in
                    let active = status == s
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) { status = s }
                    } label: {
                        HStack(spacing: 6) {
                            StatusDot(color: s.color, size: 8)
                            Text(s.label).font(.system(.subheadline, weight: .semibold))
                        }
                        .foregroundStyle(active ? s.color : Color.fwInk2)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(active ? s.color.opacity(0.14) : Color.fwRaised, in: .rect(cornerRadius: 11))
                        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(active ? s.color : Color.fwLineStrong, lineWidth: active ? 1.5 : 1) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .sensoryFeedback(.selection, trigger: status)
        }
    }

    private func photoSection(_ property: Property) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Patrol Photos").font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk)
                    Text("Live camera only · time-stamped · \(photos.count)/\(maxPhotos)")
                        .font(.caption)
                        .foregroundStyle(Color.fwInk3)
                }
                Spacer()
                Button {
                    cameraOpen = true
                } label: {
                    Label("Take Photo", systemImage: "camera.fill")
                }
                .buttonStyle(OutlineButtonStyle(fullWidth: false, tint: .fwInk, compact: true))
                .disabled(photos.count >= maxPhotos)
            }
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(photos) { photo in
                            Image(uiImage: photo.image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 96, height: 96)
                                .clipShape(.rect(cornerRadius: 11))
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        withAnimation { photos.removeAll { $0.id == photo.id } }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 22))
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.7))
                                            .frame(width: 44, height: 44)
                                    }
                                    .offset(x: 10, y: -10)
                                    .accessibilityLabel("Remove photo")
                                }
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .padding(.vertical, 10)
                }
                .contentMargins(.horizontal, 2)
            }
        }
        .fwCard()
    }

    private func fenceVerdict(_ property: Property) -> GeofenceVerdict {
        guard property.geofence.isActive else { return .inside(distance: 0) }
        return GeofenceVerdict.evaluate(property.geofence, location: location)
    }

    private func saveLabel(_ verdict: GeofenceVerdict) -> String {
        switch verdict {
        case .inside: "Log Patrol"
        case .checking: "Checking location…"
        case .outside, .blocked: "Must Be On Site"
        }
    }

    private func save(_ property: Property) async {
        let areaList = areas.split(separator: ",").map { String($0).trimmed }.filter { !$0.isEmpty }
        var next: [String: String] = [:]
        if officerName.trimmed.isEmpty { next["officer"] = "Officer name is required" }
        if areaList.isEmpty { next["areas"] = "List at least one area patrolled" }
        withAnimation { errors = next }
        guard next.isEmpty, !saving else { return }
        let fenced = property.geofence.isActive
        guard fenceVerdict(property).allowsLogging else {
            router.show("You're outside the geofence", detail: "Patrols for \(property.name) can only be logged on site.", style: .error)
            return
        }
        saving = true
        do {
            let result = try await store.addPatrol(.init(
                propertyId: property.id,
                dateTime: min(dateTime, Date()),
                officerName: officerName,
                areas: areaList,
                status: status,
                notes: notes,
                photos: photos.map(\.data),
                location: fenced ? location.fix : nil
            ))
            timers.reschedule(properties: store.properties, patrols: store.patrols)
            if result == .queued {
                router.show("Patrol saved on this device", detail: "It\(photos.isEmpty ? "" : " and its photos") will upload automatically when you're back online.", style: .info)
            } else {
                router.show("Patrol logged", detail: "\(status.label) · \(property.name)")
            }
            dismiss()
        } catch {
            router.show(ErrorText.from(error, fallback: "Couldn't log the patrol"), style: .error)
            saving = false
        }
    }
}
