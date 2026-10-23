import SwiftUI

/// Main tabs + global overlays (toasts, patrol-timer alerts, notification deep links).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(ScheduleStore.self) private var schedule
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(TimeClockStore.self) private var clock
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var clockInPrompt: PropertyRef?
    /// Set when the officer clocked in from the prompt; the form opens once the prompt has dismissed.
    @State private var continueToLog: String?

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            Tab("Dashboard", systemImage: "square.grid.2x2.fill", value: AppTab.dashboard) {
                DashboardView()
            }
            Tab("Properties", systemImage: "building.2.fill", value: AppTab.properties) {
                PropertiesView()
            }
            Tab("Schedule", systemImage: "calendar", value: AppTab.schedule) {
                ScheduleView()
            }
            Tab("Notes", systemImage: "note.text", value: AppTab.notes) {
                WatchNotesView()
            }
            .badge(store.notes.count)
            Tab("Settings", systemImage: "gearshape.fill", value: AppTab.account) {
                AccountView()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
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
        .sheet(item: $clockInPrompt, onDismiss: {
            if let id = continueToLog {
                continueToLog = nil
                router.logPatrolPropertyId = id
            }
        }) { ref in
            ClockInPromptSheet(propertyId: ref.id) {
                continueToLog = ref.id
                clockInPrompt = nil
            }
        }
        .onChange(of: router.logPatrolRequest) { _, request in
            guard let request else { return }
            router.logPatrolRequest = nil
            // Clocked out → ask to clock in first. Unknown clock state → open the form, which gates itself.
            if clock.hasLoaded && clock.open == nil {
                clockInPrompt = request
            } else {
                router.logPatrolPropertyId = request.id
            }
        }
        // Patrol timers only run while you're on the clock: clocking out (here or on the web) stops them.
        .onChange(of: isClockedOut, initial: true) { _, out in
            guard out, !timers.activePropertyIds.isEmpty else { return }
            timers.stopAll()
            router.show("Patrol timers stopped", detail: "You're clocked out, so patrol alerts are off.")
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
                await schedule.refresh()
                await clock.refresh()
            }
            timers.reschedule(properties: store.properties, patrols: store.patrols)
        }
    }

    private var isClockedOut: Bool { clock.hasLoaded && clock.open == nil }

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
