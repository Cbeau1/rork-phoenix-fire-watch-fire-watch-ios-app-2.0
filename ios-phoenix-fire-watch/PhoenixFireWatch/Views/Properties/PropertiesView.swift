import SwiftUI

struct PropertiesView: View {
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var path: [Route] = []
    @State private var query: String = ""
    @State private var showNew: Bool = false

    private var filtered: [Property] {
        let q = query.trimmed
        guard !q.isEmpty else { return store.properties }
        return store.properties.filter {
            $0.name.localizedStandardContains(q) || $0.address.localizedStandardContains(q) || $0.contactName.localizedStandardContains(q)
        }
    }

    private var columns: [GridItem] {
        sizeClass == .regular && !filtered.isEmpty
            ? [GridItem(.adaptive(minimum: 340), spacing: 12, alignment: .top)]
            : [GridItem(.flexible())]
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 10) {
                    if store.properties.isEmpty && store.hasLoaded {
                        EmptyStateView(symbol: "building.2.fill", title: "No properties yet", message: "Add the buildings your team monitors to start logging patrols.")
                        Button("Add Property") { showNew = true }
                            .buttonStyle(EmberButtonStyle())
                    } else if store.properties.isEmpty && store.isLoading {
                        ProgressView().tint(Color.fwEmber).padding(.top, 60)
                    } else if filtered.isEmpty {
                        EmptyStateView(symbol: "magnifyingglass", title: "No matches", message: "Try a different name or address.")
                    }
                    ForEach(filtered) { property in
                        NavigationLink(value: Route.property(property.id)) {
                            PropertyRowView(property: property, lastPatrol: store.patrols(for: property.id).first, timerOn: timers.isOn(property.id), pending: store.isPending(propertyId: property.id))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(sizeClass == .regular ? 24 : 16)
                .fwReadable(1100)
            }
            .refreshable { await store.refresh() }
            .searchable(text: $query, prompt: "Search properties")
            .background(CanvasBackground())
            .navigationTitle("Properties")
            .fwNavigationChrome()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showNew = true
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
            .sheet(isPresented: $showNew) {
                NavigationStack { PropertyFormView(propertyId: nil) { id in path.append(.property(id)) } }
            }
        }
    }
}

struct PropertyRowView: View {
    let property: Property
    let lastPatrol: Patrol?
    let timerOn: Bool
    let pending: Bool

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.fwEmber.opacity(0.12)).frame(width: 48, height: 48)
                Image(systemName: "building.2.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(Color.fwEmber)
                if timerOn {
                    Circle().fill(Color.fwEmber).frame(width: 12, height: 12)
                        .overlay { Circle().strokeBorder(Color.fwSurface, lineWidth: 2) }
                        .offset(x: 20, y: -20)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(property.name).font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk).lineLimit(1)
                if !property.address.isEmpty {
                    Text(property.address).font(.footnote).foregroundStyle(Color.fwInk2).lineLimit(1)
                }
                HStack(spacing: 8) {
                    if let lastPatrol {
                        HStack(spacing: 5) {
                            StatusDot(color: lastPatrol.status.color, size: 6)
                            Text("Last patrol \(Fmt.relative(lastPatrol.dateTime))")
                        }
                    } else {
                        Text("No patrols yet")
                    }
                    Text("· every \(Fmt.interval(property.patrolIntervalMinutes))")
                }
                .font(.caption)
                .foregroundStyle(Color.fwInk3)
                if pending { SyncBadge(state: .pending) }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
        }
        .fwCard(padding: 14)
        .contentShape(Rectangle())
    }
}
