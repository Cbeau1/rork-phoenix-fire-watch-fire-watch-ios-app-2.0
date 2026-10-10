import SwiftUI

/// Routes between splash, sign-in, terms, and the main app based on the auth state.
struct ContentView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(ScheduleStore.self) private var schedule
    @Environment(PatrolTimerStore.self) private var timers
    @Environment(TimeClockStore.self) private var clock
    @Environment(NetworkMonitor.self) private var network

    var body: some View {
        ZStack {
            CanvasBackground()
            content
                .transition(.opacity)
        }
        .animation(.easeInOut(duration: 0.3), value: statusKey)
        .task { auth.start() }
        .onChange(of: auth.user, initial: true) { _, user in
            timers.configure(userId: user?.id)
            Task { await store.configure(for: user) }
            Task { await schedule.configure(for: user) }
            Task { await clock.configure(userId: user?.id) }
        }
        .onChange(of: network.isOnline, initial: true) { _, online in
            store.isOnline = online
            schedule.isOnline = online
            clock.isOnline = online
            if online {
                Task { await schedule.refresh() }
                Task { await clock.refresh() }
            }
        }
    }

    private var statusKey: String {
        switch auth.status {
        case .loading: "loading"
        case .signedOut: "signedOut"
        case .needsTerms: "terms"
        case .needsFieldGuide: "fieldGuide"
        case .noAccess: "noAccess"
        case .ready: "ready"
        }
    }

    @ViewBuilder
    private var content: some View {
        switch auth.status {
        case .loading:
            SplashView()
        case .signedOut:
            SignInView()
        case .needsTerms:
            AcceptTermsView()
        case .needsFieldGuide:
            FieldGuideGateView()
        case .noAccess(let message):
            NoAccessView(message: message)
        case .ready:
            MainTabView()
        }
    }
}

struct SplashView: View {
    @State private var pulse: Bool = false

    var body: some View {
        VStack(spacing: 22) {
            CrestView(size: 104)
                .scaleEffect(pulse ? 1.04 : 0.98)
                .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: pulse)
            Wordmark()
        }
        .onAppear { pulse = true }
    }
}

struct NoAccessView: View {
    let message: String
    @Environment(AuthStore.self) private var auth
    @State private var busy: Bool = false

    var body: some View {
        VStack(spacing: 20) {
            CrestView(size: 80)
            Text("Can't open your account")
                .font(FWFont.display(.title2))
                .foregroundStyle(Color.fwInk)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.fwInk2)
                .multilineTextAlignment(.center)
            VStack(spacing: 10) {
                Button {
                    busy = true
                    Task {
                        await auth.retry()
                        busy = false
                    }
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Try Again") }
                }
                .buttonStyle(EmberButtonStyle())
                Button("Sign Out") { Task { await auth.signOut() } }
                    .buttonStyle(OutlineButtonStyle())
            }
            .padding(.top, 8)
        }
        .padding(28)
        .frame(maxWidth: 440)
    }
}

#Preview {
    SplashView()
        .background(CanvasBackground())
}
