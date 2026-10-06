import SwiftUI

/// Employee view: clock in/out plus the clock-in, clock-out and hours worked for each shift.
/// Approval and payroll live on the website (admins only).
struct MyHoursView: View {
    @Environment(TimeClockStore.self) private var clock

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TimeClockCardView()
                weekHeader
                if let error = clock.loadError, !clock.hasLoaded {
                    ErrorBanner(message: error)
                }
                entriesList
            }
            .padding(16)
            .padding(.bottom, 20)
        }
        .refreshable { await clock.refresh() }
        .background(CanvasBackground())
        .navigationTitle("My Hours")
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
        .task { await clock.refresh() }
    }

    private var weekHeader: some View {
        HStack(spacing: 10) {
            Button {
                Task { await clock.shiftWeek(by: -1) }
            } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }
            .accessibilityLabel("Previous week")
            VStack(spacing: 2) {
                Text(ScheduleDates.weekLabel(clock.weekStart))
                    .font(.system(.headline, weight: .bold))
                    .foregroundStyle(Color.fwInk)
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text("\(HoursFormat.duration(clock.weekMinutes(now: context.date))) worked")
                        .font(FWFont.mono(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.fwInk2)
                        .monospacedDigit()
                }
            }
            .frame(maxWidth: .infinity)
            Button {
                Task { await clock.shiftWeek(by: 1) }
            } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }
            .disabled(clock.isCurrentWeek)
            .accessibilityLabel("Next week")
        }
        .font(.system(.body, weight: .semibold))
        .fwCard(padding: 8)
    }

    @ViewBuilder
    private var entriesList: some View {
        if clock.isLoading && clock.entries.isEmpty {
            ProgressView().tint(Color.fwInk3).frame(maxWidth: .infinity).padding(.vertical, 30)
        } else if clock.entries.isEmpty {
            EmptyStateView(symbol: "clock", title: "No hours this week", message: "Your clock-ins will appear here.")
                .fwCard()
        } else {
            VStack(spacing: 0) {
                ForEach(clock.entries) { entry in
                    EntryRowView(entry: entry)
                    if entry.id != clock.entries.last?.id {
                        Divider().overlay(Color.fwLine)
                    }
                }
            }
            .fwCard(padding: 14)
        }
    }
}

private struct EntryRowView: View {
    let entry: TimeEntry

    var body: some View {
        TimelineView(.periodic(from: .now, by: entry.isOpen ? 30 : 3600)) { context in
            HStack(spacing: 14) {
                VStack(spacing: 1) {
                    Text(entry.clockIn.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(FWFont.label)
                        .tracking(1)
                        .foregroundStyle(Color.fwInk3)
                    Text(entry.clockIn.formatted(.dateTime.day()))
                        .font(.system(.title2, weight: .heavy))
                        .foregroundStyle(Color.fwInk)
                }
                .frame(width: 46)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(Fmt.time(entry.clockIn)) → \(entry.clockOut.map { Fmt.time($0) } ?? "now")")
                        .font(FWFont.mono(.subheadline))
                        .foregroundStyle(Color.fwInk)
                        .monospacedDigit()
                    HStack(spacing: 5) {
                        StatusDot(color: entry.statusColor, size: 6)
                        Text(entry.statusLabel).font(.caption.weight(.semibold)).foregroundStyle(entry.statusColor)
                    }
                }
                Spacer(minLength: 6)
                Text(HoursFormat.duration(entry.minutes(now: context.date)))
                    .font(FWFont.mono(.headline, weight: .bold))
                    .foregroundStyle(entry.status == "rejected" ? Color.fwInk3 : Color.fwInk)
                    .strikethrough(entry.status == "rejected")
                    .monospacedDigit()
            }
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
        }
    }
}
