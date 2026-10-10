import CoreText
import SwiftUI

@main
struct PhoenixFireWatchApp: App {
    @State private var auth = AuthStore()
    @State private var store = FireWatchStore()
    @State private var schedule = ScheduleStore()
    @State private var timers = PatrolTimerStore()
    @State private var clock = TimeClockStore()
    @State private var network = NetworkMonitor()
    @State private var router = AppRouter.shared
    @AppStorage(AppearancePreference.storageKey) private var appearanceRaw: String = AppearancePreference.system.rawValue

    private var appearance: AppearancePreference { AppearancePreference.from(appearanceRaw) }

    init() {
        NotificationDelegate.shared.register()
        if let url = Bundle.main.url(forResource: "GreatVibes-Regular", withExtension: "ttf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .environment(store)
                .environment(schedule)
                .environment(timers)
                .environment(clock)
                .environment(network)
                .environment(router)
                .preferredColorScheme(appearance.colorScheme)
                .tint(Color.fwLink)
                .onChange(of: appearanceRaw, initial: true) { _, _ in
                    AppearanceController.apply(appearance)
                }
        }
    }
}
