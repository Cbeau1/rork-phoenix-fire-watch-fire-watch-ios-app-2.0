import SwiftUI

/// Log Fire Watch Patrol form. Saves on the device first; uploads when online.
struct LogPatrolView: View {
    let propertyId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(TimeClockStore.self) private var clock
    @Environment(AppRouter.self) private var router

    @State private var dateTime: Date = Date()
    @State private var officerName: String = ""
    @State private var areas: String = ""
    @State private var status: PatrolStatus = .clear
    @State private var notes: String = ""
    @State private var photos: [CapturedPhoto] = []
    @State private var cameraOpen: Bool = false
    @State private var saving: Bool = false
    /// Set on the first Log Patrol tap; from then on field errors update live as they're completed.
    @State private var attempted: Bool = false
    /// Bumped on each blocked submit to scroll to the first incomplete field (and play a haptic).
    @State private var scrollRequest: Int = 0
    @State private var didPrefill: Bool = false
    @State private var location: LocationService = LocationService()

    private let maxPhotos = 5

    struct CapturedPhoto: Identifiable {
        let id = UUID()
        let data: Data
        let image: UIImage
    }

    private var property: Property? { store.property(id: propertyId) }

    /// Required fields in on-screen order: scroll id + label.
    private static let requiredFields: [(id: String, label: String)] = [("officer", "Officer Name"), ("areas", "Areas Patrolled")]

    private var areaList: [String] {
        areas.split(separator: ",").map { String($0).trimmed }.filter { !$0.isEmpty }
    }

    private var errors: [String: String] {
        guard attempted else { return [:] }
        var found: [String: String] = [:]
        if officerName.trimmed.isEmpty { found["officer"] = "Officer name is required" }
        if areaList.isEmpty { found["areas"] = "List at least one area patrolled" }
        return found
    }

    private var missingFields: [(id: String, label: String)] {
        Self.requiredFields.filter { errors[$0.id] != nil }
    }

    /// A patrol can only be started or submitted while on the clock.
    private var needsClockIn: Bool { clock.hasLoaded && clock.open == nil }

    var body: some View {
        Group {
            if let property {
                if needsClockIn {
                    clockInRequired(property)
                } else {
                    form(property)
                }
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

    /// Shown instead of the form until the officer clocks in on the time clock.
    private func clockInRequired(_ property: Property) -> some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 14) {
                ZStack {
                    Circle().fill(Color.fwPrimary.opacity(0.12)).frame(width: 64, height: 64)
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Color.fwLink)
                }
                VStack(spacing: 6) {
                    Text("Clock in to log patrols")
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.fwInk)
                    Text("Start your shift on the time clock before logging a patrol at \(property.name).")
                        .font(.subheadline)
                        .foregroundStyle(Color.fwInk2)
                        .multilineTextAlignment(.center)
                }
                Button {
                    Task {
                        do {
                            try await clock.clockIn()
                            router.show("Clocked in", detail: "Started at \(Fmt.time(clock.open?.clockIn ?? Date()))")
                        } catch {
                            router.show(ErrorText.from(error, fallback: "Couldn't clock in. Try again."), style: .error)
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if clock.isPunching {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "arrow.right.to.line")
                        }
                        Text(clock.isPunching ? "Clocking in…" : "Clock In")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(clock.isPunching)
            }
            .padding(24)
            .fwCard()
            .padding(16)
            .fwReadable(420)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func form(_ property: Property) -> some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 11).fill(Color.fwPrimary.opacity(0.12)).frame(width: 44, height: 44)
                        Image(systemName: "shield.lefthalf.filled").foregroundStyle(Color.fwLink).font(.system(size: 20, weight: .semibold))
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
                            .tint(Color.fwPrimary)
                    }
                    FWField(label: "Officer Name", text: $officerName, placeholder: "Full name", required: true, contentType: .name, autocapitalization: .words, error: errors["officer"])
                        .id("officer")
                    VStack(alignment: .leading, spacing: 5) {
                        FWField(label: "Areas Patrolled", text: $areas, placeholder: "e.g. Main lobby, Basement, Garage", required: true, error: errors["areas"])
                        if errors["areas"] == nil {
                            Text("Separate multiple areas with commas").font(.caption).foregroundStyle(Color.fwInk3)
                        }
                    }
                    .id("areas")
                    statusPicker
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Additional Notes").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                        TextField("", text: $notes, prompt: Text("Any observations…").foregroundStyle(Color.fwInk3), axis: .vertical)
                            .lineLimit(3...8)
                            .foregroundStyle(Color.fwInk)
                            .padding(14)
                            .background(Color.fwField, in: .rect(cornerRadius: 11))
                            .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
                    }
                }
                .fwCard()

                photoSection(property)

                if !missingFields.isEmpty {
                    incompleteBanner {
                        if let first = missingFields.first {
                            withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(first.id, anchor: .center) }
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

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
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving || !verdict.allowsLogging)
                .padding(.bottom, 20)
            }
            .padding(16)
            .fwReadable(680)
        }
        .scrollDismissesKeyboard(.interactively)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: missingFields.count)
        .sensoryFeedback(.error, trigger: scrollRequest)
        .onChange(of: scrollRequest) { _, _ in
            guard let first = missingFields.first else { return }
            withAnimation(.easeInOut(duration: 0.4)) { proxy.scrollTo(first.id, anchor: .center) }
        }
        }
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

    /// Above the submit button: says which required fields are missing, with a jump back up to the first one.
    private func incompleteBanner(goToFirst: @escaping () -> Void) -> some View {
        let count = missingFields.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.fwIncidentInk)
                VStack(alignment: .leading, spacing: 3) {
                    Text(count == 1 ? "Complete 1 required field" : "Complete \(count) required fields")
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.fwInk)
                    Text("Scroll up to fill in: \(missingFields.map(\.label).joined(separator: ", "))")
                        .font(.footnote)
                        .foregroundStyle(Color.fwInk2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button(action: goToFirst) {
                Label("Go to \(missingFields.first?.label ?? "field")", systemImage: "arrow.up")
            }
            .buttonStyle(OutlineButtonStyle(compact: true))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.fwIncident.opacity(0.08), in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.fwIncident.opacity(0.4), lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 2) {
                Text("Status").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                Text("*").foregroundStyle(Color.fwLink)
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
                        .foregroundStyle(active ? s.textColor : Color.fwInk2)
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
        guard !saving else { return }
        attempted = true
        let missing = missingFields
        if let first = missing.first {
            router.show(
                missing.count == 1 ? "1 required field is incomplete" : "\(missing.count) required fields are incomplete",
                detail: "Scroll up to complete \(first.label)\(missing.count > 1 ? " and the other highlighted fields" : "").",
                style: .error
            )
            scrollRequest += 1
            return
        }
        guard clock.open != nil else {
            router.show("Clock in first", detail: "Clock in before logging a patrol.", style: .error)
            return
        }
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
