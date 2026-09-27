import SwiftUI

/// Main tabs + global overlays (toasts, patrol-timer alerts, notification deep links).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            Tab("Dashboard", systemImage: "square.grid.2x2.fill", value: AppTab.dashboard) {
                DashboardView()
            }
            Tab("Properties", systemImage: "building.2.fill", value: AppTab.properties) {
                PropertiesView()
            }
            Tab("Notes", systemImage: "note.text", value: AppTab.notes) {
                WatchNotesView()
            }
            .badge(store.notes.count)
            if auth.isAdmin {
                Tab("Team", systemImage: "person.2.fill", value: AppTab.team) {
                    TeamView()
                }
            }
            Tab("Account", systemImage: "person.crop.circle", value: AppTab.account) {
                AccountView()
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                TimerAlertBanner()
                if let toast = router.toast {
                    ToastView(toast: toast)
                        .id(toast.id)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onTapGesture { router.toast = nil }
                        .task(id: toast.id) {
                            try? await Task.sleep(for: .seconds(3.2))
                            if router.toast?.id == toast.id {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { router.toast = nil }
                            }
                        }
                }
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.82), value: router.toast)
        }
        .sheet(item: logPatrolBinding) { ref in
            NavigationStack {
                LogPatrolView(propertyId: ref.id)
            }
        }
        .onChange(of: planKey, initial: true) { _, _ in
            timers.reschedule(properties: store.properties, patrols: store.patrols)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await timers.refreshNotificationStatus()
                await store.flush()
                await store.refresh()
            }
            timers.reschedule(properties: store.properties, patrols: store.patrols)
        }
        .onChange(of: auth.isAdmin) { _, isAdmin in
            if !isAdmin && router.selectedTab == .team { router.selectedTab = .dashboard }
        }
    }

    /// Changes whenever timers, intervals, or latest patrols change.
    private var planKey: String {
        let ids = timers.activePropertyIds
        let parts = ids.map { id -> String in
            let interval = store.property(id: id)?.patrolIntervalMinutes ?? 0
            let last = PatrolTimerStore.lastPatrolDate(for: id, in: store.patrols)?.timeIntervalSince1970 ?? 0
            return "\(id):\(interval):\(Int(last))"
        }
        return parts.joined(separator: "|") + "#\(store.properties.count)"
    }

    private var logPatrolBinding: Binding<PropertyRef?> {
        Binding(
            get: { router.logPatrolPropertyId.map(PropertyRef.init) },
            set: { router.logPatrolPropertyId = $0?.id }
        )
    }
}
