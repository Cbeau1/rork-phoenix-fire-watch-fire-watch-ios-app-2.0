import SwiftUI

struct DashboardView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var path: [Route] = []

    private var isWide: Bool { sizeClass == .regular }
    @State private var showNewProperty: Bool = false
    @State private var showQuickNote: Bool = false

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    TimeClockCardView(onOpenHours: { path.append(.myHours) })
                    SyncStatusBar()
                    if let error = store.loadError, !store.hasLoaded {
                        ErrorBanner(message: error)
                    }
                    if !timers.activePropertyIds.isEmpty {
                        activeTimers
                    }
                    sites
                    if isWide {
                        HStack(alignment: .top, spacing: 16) {
                            recentPatrols
                            notesPreview
                        }
                    } else {
                        recentPatrols
                        notesPreview
                    }
                }
                .padding(isWide ? 24 : 16)
                .padding(.bottom, 20)
                .fwReadable(1100)
            }
            .refreshable {
                await store.flush()
                await store.refresh()
            }
            .background(CanvasBackground())
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .fwNavigationChrome()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    CrestView(size: 30, glow: false)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showNewProperty = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add property")
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .property(let id): PropertyDetailView(propertyId: id)
                case .allPatrols: AllPatrolsView()
                case .myHours: MyHoursView()
                }
            }
            .sheet(isPresented: $showNewProperty) {
                NavigationStack { PropertyFormView(propertyId: nil) { id in path.append(.property(id)) } }
            }
            .sheet(isPresented: $showQuickNote) {
                QuickNoteSheet()
                    .presentationDetents([.medium])
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(Fmt.greeting()), \(auth.user?.name.split(separator: " ").first.map(String.init) ?? "Officer")")
                .font(FWFont.display(.title))
                .foregroundStyle(Color.fwInk)
            Text(auth.user?.orgName.isEmpty == false ? "\(auth.user?.orgName ?? "") · fire watch overview" : "Fire watch overview")
                .font(.subheadline)
                .foregroundStyle(Color.fwInk2)
        }
        .padding(.top, 4)
    }

    private var activeTimers: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Your running timers", color: .fwEmber)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(spacing: 8) {
                    ForEach(timers.activePropertyIds, id: \.self) { id in
                        if let property = store.property(id: id),
                           let s = timers.schedule(for: property, patrols: store.patrols, now: context.date) {
                            Button {
                                path.append(.property(id))
                            } label: {
                                timerRow(property, s, now: context.date)
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            }
        }
    }

    private func timerRow(_ property: Property, _ s: PatrolSchedule, now: Date) -> some View {
        let color: Color = s.isOverdue ? .fwIncident : s.isWarning ? .fwFollow : .fwEmber
        return HStack(spacing: 12) {
            ZStack {
                Circle().stroke(Color.fwLine, lineWidth: 4)
                Circle().trim(from: 0, to: s.progress).stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            }
            .frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(property.name).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk).lineLimit(1)
                Text(s.isOverdue ? "Overdue since \(Fmt.time(s.overdueSince ?? now))" : "Due at \(Fmt.time(s.dueAt))")
                    .font(.caption).foregroundStyle(s.isOverdue ? Color.fwIncident : Color.fwInk2)
            }
            Spacer()
            Text(s.isOverdue ? Fmt.countdown(now.timeIntervalSince(s.overdueSince ?? now)) : Fmt.countdown(s.remaining))
                .font(FWFont.mono(.subheadline, weight: .bold))
                .foregroundStyle(color)
                .monospacedDigit()
        }
        .fwCard(padding: 12, border: color.opacity(0.35))
    }

    private var sites: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sites").font(.system(.title3, weight: .bold)).foregroundStyle(Color.fwInk)
                Text("\(store.properties.count) \(store.properties.count == 1 ? "site" : "sites") available · tap to open")
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
            }
            if store.properties.isEmpty {
                VStack(spacing: 12) {
                    EmptyStateView(symbol: "building.2", title: "No sites yet", message: "Add your first monitored location to start logging fire watch patrols.")
                    Button("Add Property") { showNewProperty = true }
                        .buttonStyle(EmberButtonStyle())
                }
                .fwCard()
            } else {
                let latest = latestPatrolBySite
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    LazyVGrid(columns: siteColumns, spacing: 12) {
                        ForEach(store.properties) { property in
                            SiteCardView(
                                property: property,
                                lastPatrol: latest[property.id],
                                schedule: timers.isOn(property.id) ? timers.schedule(for: property, patrols: store.patrols, now: context.date) : nil,
                                now: context.date,
                                onOpen: { path.append(.property(property.id)) },
                                onLog: { router.openLogPatrol(propertyId: property.id) }
                            )
                        }
                    }
                }
            }
        }
    }

    private var siteColumns: [GridItem] {
        isWide
            ? [GridItem(.adaptive(minimum: 340), spacing: 12, alignment: .top)]
            : [GridItem(.flexible())]
    }

    private var latestPatrolBySite: [String: Patrol] {
        var map: [String: Patrol] = [:]
        for patrol in store.patrols {
            if let existing = map[patrol.propertyId], existing.dateTime >= patrol.dateTime { continue }
            map[patrol.propertyId] = patrol
        }
        return map
    }

    private var recentPatrols: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Recent Patrols").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                Spacer()
                if !store.patrols.isEmpty {
                    Button("View All") { path.append(.allPatrols) }
                        .font(.system(.subheadline, weight: .semibold))
                }
            }
            if store.patrols.isEmpty {
                EmptyStateView(symbol: "figure.walk", title: "No patrols yet", message: store.properties.isEmpty ? "Add a property, then log your first patrol." : "Open a property to log your first patrol.")
                if store.properties.isEmpty {
                    Button("Add Property") { showNewProperty = true }
                        .buttonStyle(EmberButtonStyle())
                }
            } else {
                ForEach(Array(store.patrols.prefix(6))) { patrol in
                    Button {
                        path.append(.property(patrol.propertyId))
                    } label: {
                        compactPatrol(patrol)
                    }
                    .buttonStyle(PressableStyle())
                    if patrol.id != store.patrols.prefix(6).last?.id {
                        Divider().overlay(Color.fwLine)
                    }
                }
            }
        }
        .fwCard()
    }

    private func compactPatrol(_ p: Patrol) -> some View {
        HStack(spacing: 12) {
            StatusDot(color: p.status.color, size: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(store.property(id: p.propertyId)?.name ?? "Property")
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.fwInk)
                    .lineLimit(1)
                Text("\(p.officerName) · \(p.areas.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(Color.fwInk2)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                Text(Fmt.time(p.dateTime)).font(FWFont.mono(.caption, weight: .semibold)).foregroundStyle(Color.fwInk)
                if let state = p.syncState {
                    Image(systemName: state == .pending ? "icloud.and.arrow.up" : "exclamationmark.icloud")
                        .font(.caption2).foregroundStyle(state == .pending ? Color.fwFollow : Color.fwIncident)
                } else {
                    Text(Fmt.relative(p.dateTime)).font(.caption2).foregroundStyle(Color.fwInk3)
                }
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var notesPreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Watch Notes").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                Spacer()
                Button {
                    showQuickNote = true
                } label: {
                    Image(systemName: "plus.circle.fill").font(.title3)
                }
                .accessibilityLabel("Add watch note")
            }
            if store.notes.isEmpty {
                Text("No active notes. Share shift updates with your team here.")
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk3)
            } else {
                ForEach(Array(store.notes.prefix(3))) { note in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note.content).font(.subheadline).foregroundStyle(Color.fwInk).lineLimit(3)
                        Text("\(note.authorName) · \(Fmt.relative(note.createdAt))").font(.caption).foregroundStyle(Color.fwInk3)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.fwRaised, in: .rect(cornerRadius: 10))
                    .overlay(alignment: .leading) {
                        UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10).fill(Color.fwEmber).frame(width: 3)
                    }
                }
                if store.notes.count > 3 {
                    Button("See all \(store.notes.count) notes") { router.selectedTab = .notes }
                        .font(.system(.subheadline, weight: .semibold))
                }
            }
        }
        .fwCard()
    }
}

/// Offline / uploading / needs-attention status with the upload queue.
struct SyncStatusBar: View {
    @Environment(FireWatchStore.self) private var store
    @State private var showQueue: Bool = false

    var body: some View {
        if !store.isOnline || store.pendingCount > 0 || store.failedCount > 0 {
            Button {
                showQueue = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: symbol)
                        .foregroundStyle(color)
                        .symbolEffect(.pulse, isActive: store.syncing)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk)
                        Text(detail).font(.caption).foregroundStyle(Color.fwInk2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
                }
                .padding(12)
                .background(color.opacity(0.1), in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.35), lineWidth: 1) }
            }
            .buttonStyle(PressableStyle())
            .sheet(isPresented: $showQueue) { SyncQueueSheet().presentationDetents([.medium, .large]) }
        }
    }

    private var color: Color {
        if store.failedCount > 0 { return .fwIncident }
        if !store.isOnline { return .fwFollow }
        return .fwEmber
    }

    private var symbol: String {
        if store.failedCount > 0 { return "exclamationmark.icloud.fill" }
        if !store.isOnline { return "wifi.slash" }
        return "icloud.and.arrow.up.fill"
    }

    private var title: String {
        if store.failedCount > 0 { return "\(store.failedCount) change\(store.failedCount == 1 ? "" : "s") need attention" }
        if !store.isOnline { return "Offline — saving on this device" }
        return store.syncing ? "Uploading…" : "Waiting to upload"
    }

    private var detail: String {
        let n = store.pendingCount
        if n == 0 { return "Keep logging — everything uploads when you reconnect." }
        return "\(n) change\(n == 1 ? "" : "s") queued · uploads automatically"
    }
}

struct SyncQueueSheet: View {
    @Environment(FireWatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if store.ops.isEmpty {
                    Text("Everything is uploaded.").foregroundStyle(Color.fwInk2)
                }
                ForEach(store.ops) { op in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(op.summary).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk)
                            Spacer()
                            SyncBadge(state: op.failed ? .failed : .pending)
                        }
                        Text(Fmt.dateTime(op.createdAt)).font(.caption).foregroundStyle(Color.fwInk3)
                        if let error = op.error {
                            Text(error).font(.caption).foregroundStyle(op.failed ? Color.fwIncident : Color.fwInk2)
                        }
                        if op.failed {
                            HStack {
                                Button("Retry") { Task { await store.retry(op.id) } }
                                    .buttonStyle(.bordered)
                                Button("Discard", role: .destructive) { store.discard(op.id) }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                    .listRowBackground(Color.fwSurface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.fwCanvas)
            .navigationTitle("Upload Queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sync Now") { Task { await store.flush() } }
                        .disabled(!store.isOnline || store.syncing)
                }
            }
        }
    }
}

struct AllPatrolsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @State private var filter: PatrolStatus?

    private var filtered: [Patrol] {
        guard let filter else { return store.patrols }
        return store.patrols.filter { $0.status == filter }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("All", count: store.patrols.count, color: .fwEmber, value: nil)
                        ForEach(PatrolStatus.allCases) { s in
                            chip(s.label, count: store.patrols.filter { $0.status == s }.count, color: s.color, value: s)
                        }
                    }
                }
                .contentMargins(.horizontal, 16)
                VStack(spacing: 0) {
                    if filtered.isEmpty {
                        EmptyStateView(symbol: "line.3.horizontal.decrease.circle", title: "No patrols", message: "Nothing matches this filter.")
                    }
                    ForEach(filtered) { patrol in
                        PatrolRow(patrol: patrol, propertyName: store.property(id: patrol.propertyId)?.name ?? "Property")
                        if patrol.id != filtered.last?.id { Divider().overlay(Color.fwLine) }
                    }
                }
                .fwCard(padding: 14)
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 12)
            .fwReadable(860)
        }
        .background(CanvasBackground())
        .navigationTitle("All Patrols")
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
        .sensoryFeedback(.selection, trigger: filter)
    }

    private func chip(_ title: String, count: Int, color: Color, value: PatrolStatus?) -> some View {
        let active = filter == value
        return Button {
            withAnimation(.spring(response: 0.3)) { filter = value }
        } label: {
            HStack(spacing: 6) {
                StatusDot(color: color, size: 7)
                Text(title).font(.system(.subheadline, weight: .semibold))
                Text("\(count)").font(FWFont.mono(.caption)).foregroundStyle(Color.fwInk3)
            }
            .foregroundStyle(active ? Color.fwInk : Color.fwInk2)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background(active ? color.opacity(0.16) : Color.fwSurface, in: Capsule())
            .overlay { Capsule().strokeBorder(active ? color.opacity(0.6) : Color.fwLine, lineWidth: 1) }
        }
        .buttonStyle(.plain)
    }
}
