import SwiftUI

/// Shown when "Log Patrol" is tapped while off the clock: clock in, then continue to the patrol form.
struct ClockInPromptSheet: View {
    let propertyId: String
    /// Called after a successful clock-in; the presenter opens the Log Patrol form.
    let onClockedIn: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(TimeClockStore.self) private var clock
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var errorMessage: String?

    private var propertyName: String? { store.property(id: propertyId)?.name }

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(Color.fwFollow.opacity(0.14)).frame(width: 64, height: 64)
                Circle().strokeBorder(Color.fwFollow.opacity(0.4), lineWidth: 1).frame(width: 64, height: 64)
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(Color.fwFollow)
                    .symbolEffect(.bounce, value: errorMessage)
            }
            .padding(.top, 8)

            VStack(spacing: 8) {
                Text("Clock in first")
                    .font(FWFont.display(.title2))
                    .foregroundStyle(Color.fwInk)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let errorMessage {
                ErrorBanner(message: errorMessage)
            }

            VStack(spacing: 10) {
                Button {
                    Task { await clockIn() }
                } label: {
                    HStack(spacing: 8) {
                        if clock.isPunching {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "arrow.right.to.line")
                        }
                        Text(clock.isPunching ? "Clocking in…" : "Clock In & Log Patrol")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(clock.isPunching)

                Button("Not Now") { dismiss() }
                    .buttonStyle(OutlineButtonStyle())
                    .disabled(clock.isPunching)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.fwSurface)
        .presentationDetents([.height(errorMessage == nil ? 380 : 450)])
        .presentationDragIndicator(.visible)
        .presentationBackground(Color.fwSurface)
        .interactiveDismissDisabled(clock.isPunching)
    }

    private var message: String {
        if let propertyName {
            return "You need to be on the clock to log a patrol at \(propertyName). Clock in now to start your shift and continue."
        }
        return "You need to be on the clock to log a patrol. Clock in now to start your shift and continue."
    }

    private func clockIn() async {
        errorMessage = nil
        do {
            try await clock.clockIn()
            router.show("Clocked in", detail: "Started at \(Fmt.time(clock.open?.clockIn ?? Date()))")
            onClockedIn()
        } catch {
            errorMessage = ErrorText.from(error, fallback: "Couldn't clock in. Try again.")
        }
    }
}
