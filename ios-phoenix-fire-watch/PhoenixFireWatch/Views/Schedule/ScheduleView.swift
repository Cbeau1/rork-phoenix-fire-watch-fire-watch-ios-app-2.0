import SwiftUI

/// Weekly schedule (Monday → Sunday). Admins plan shifts per property and mark them paid;
/// officers get a read-only view with their own shifts highlighted.
struct ScheduleView: View {
    @Environment(ScheduleStore.self) private var schedule
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(NetworkMonitor.self) private var network

    @State private var propertyFilter: String?
    @State private var onlyMine: Bool = false
    @State private var draft: ShiftDraft?
    @State private var showStaff: Bool = false
    @State private var weekDirection: Edge = .trailing

    private var isAdmin: Bool { schedule.isAdmin }
    private var days: [Date] { ScheduleDates.days(from: schedule.weekStart) }
    private var isThisWeek: Bool {
        ScheduleDates.key(schedule.weekStart) == ScheduleDates.key(ScheduleDates.weekStart(of: Date()))
    }

    private var visible: [Shift] {
        let mine = schedule.myStaffIds
        return schedule.shifts
            .filter { propertyFilter == nil || $0.propertyId == propertyFilter }
            .filter { !onlyMine || mine.contains($0.staffId) }
            .sorted(by: Shift.byStart)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    WeekNavigator(
                        label: ScheduleDates.weekLabel(schedule.weekStart),
                        shifts: visible,
                        isAdmin: isAdmin,
                        isThisWeek: isThisWeek,
                        isRefreshing: schedule.isLoading && schedule.hasLoaded,
                        onMove: move(by:),
                        onToday: goToToday
                    )
                    filterChips
                    content
                }
                .padding(.vertical, 16)
                .fwReadable(900)
            }
            .refreshable { await schedule.refresh() }
            .background(CanvasBackground())
            .navigationTitle("Schedule")
            .fwNavigationChrome()
            .toolbar { toolbar }
            .sheet(item: $draft) { d in
                ShiftEditorSheet(draft: d, days: days)
                    .presentationDetents([.large])
            }
            .sheet(isPresented: $showStaff) { StaffRosterSheet() }
            .onChange(of: schedule.myStaffIds.isEmpty) { _, empty in
                if empty { onlyMine = false }
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isAdmin {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showStaff = true
                } label: {
                    Label("Staff", systemImage: "person.2")
                }
                .accessibilityLabel("Staff roster")
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    openAdd(date: nil)
                } label: {
                    Image(systemName: "calendar.badge.plus")
                }
                .accessibilityLabel("Add shift")
            }
        }
    }

    // MARK: - Filters

    @ViewBuilder
    private var filterChips: some View {
        let hasMine = !schedule.myStaffIds.isEmpty
        if store.properties.count > 1 || hasMine {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if hasMine {
                        FilterChip(title: "My shifts", symbol: "person.fill", isOn: onlyMine, solid: true) {
                            onlyMine.toggle()
                        }
                    }
                    if store.properties.count > 1 {
                        FilterChip(title: "All properties", symbol: nil, isOn: propertyFilter == nil, solid: false) {
                            propertyFilter = nil
                        }
                        ForEach(store.properties) { p in
                            FilterChip(title: p.name, symbol: "building.2", isOn: propertyFilter == p.id, solid: false) {
                                propertyFilter = p.id
                            }
                        }
                    }
                }
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .sensoryFeedback(.selection, trigger: "\(propertyFilter ?? "all")-\(onlyMine)")
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        Group {
            if !schedule.hasLoaded && schedule.isLoading {
                ProgressView().tint(Color.fwEmber).frame(maxWidth: .infinity).padding(.vertical, 80)
            } else if let error = schedule.loadError, !schedule.hasLoaded {
                VStack(spacing: 12) {
                    ErrorBanner(message: error)
                    Button("Try Again") { Task { await schedule.refresh() } }
                        .buttonStyle(OutlineButtonStyle())
                }
            } else if isAdmin && store.properties.isEmpty {
                VStack(spacing: 4) {
                    EmptyStateView(symbol: "building.2", title: "Add a property first", message: "Shifts are scheduled per property. Add your first site, then come back to build the week.")
                    Button("Go to Properties") { router.selectedTab = .properties }
                        .buttonStyle(EmberButtonStyle(fullWidth: false, compact: true))
                        .padding(.bottom, 20)
                }
                .fwCard()
            } else {
                weekContent
            }
        }
        .padding(.horizontal, 16)
    }

    private var weekContent: some View {
        let byDay = Dictionary(grouping: visible, by: \.date)
        let todayKey = ScheduleDates.key(Date())
        return VStack(alignment: .leading, spacing: 12) {
            if !isAdmin && visible.isEmpty {
                EmptyStateView(symbol: "calendar", title: "No shifts this week", message: "Your admin hasn't scheduled anyone for this week yet. Use the arrows to check another week.")
                    .fwCard()
            } else {
                ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                    let key = ScheduleDates.key(day)
                    DaySection(
                        day: day,
                        isToday: key == todayKey,
                        shifts: byDay[key] ?? [],
                        isAdmin: isAdmin,
                        showProperty: propertyFilter == nil && store.properties.count > 1,
                        myStaffIds: schedule.myStaffIds,
                        staffName: { schedule.staff(id: $0)?.name ?? "Removed staff" },
                        propertyName: { store.property(id: $0)?.name ?? "Removed property" },
                        onAdd: { openAdd(date: key) },
                        onEdit: { draft = ShiftDraft(shift: $0) },
                        onTogglePaid: togglePaid
                    )
                    .transition(.asymmetric(
                        insertion: .move(edge: weekDirection).combined(with: .opacity),
                        removal: .opacity
                    ))
                    .animation(.spring(response: 0.45, dampingFraction: 0.85).delay(Double(index) * 0.025), value: schedule.weekStart)
                }
                .id(ScheduleDates.key(schedule.weekStart))
            }
            if isAdmin {
                PaySummaryCard(
                    shifts: visible,
                    staffName: { schedule.staff(id: $0)?.name ?? "Removed staff" },
                    onMarkAll: markAll
                )
                .padding(.top, 8)
            }
        }
    }

    // MARK: - Actions

    private func move(by weeks: Int) {
        weekDirection = weeks > 0 ? .trailing : .leading
        Task { await schedule.shiftWeek(by: weeks) }
    }

    private func goToToday() {
        let target = ScheduleDates.weekStart(of: Date())
        weekDirection = target > schedule.weekStart ? .trailing : .leading
        Task { await schedule.goToWeek(target) }
    }

    private func openAdd(date: String?) {
        guard !store.properties.isEmpty else {
            router.show("Add a property first, then schedule staff to it.", style: .error)
            return
        }
        guard network.isOnline else {
            router.show("Schedule changes need a connection.", style: .error)
            return
        }
        draft = ShiftDraft(date: date, propertyId: propertyFilter)
    }

    private func togglePaid(_ shift: Shift) {
        Task {
            do {
                try await schedule.setPaid(ids: [shift.id], paid: !shift.isPaid)
            } catch {
                router.show(ErrorText.from(error), style: .error)
            }
        }
    }

    private func markAll(_ ids: [String], paid: Bool, name: String) {
        Task {
            do {
                try await schedule.setPaid(ids: ids, paid: paid)
                router.show(paid ? "\(name)'s week marked paid" : "\(name)'s week marked unpaid")
            } catch {
                router.show(ErrorText.from(error), style: .error)
            }
        }
    }
}

// MARK: - Week navigator

private struct WeekNavigator: View {
    let label: String
    let shifts: [Shift]
    let isAdmin: Bool
    let isThisWeek: Bool
    let isRefreshing: Bool
    let onMove: (Int) -> Void
    let onToday: () -> Void

    private var minutes: Int { shifts.reduce(0) { $0 + $1.minutes } }
    private var paidCount: Int { shifts.filter(\.isPaid).count }

    var body: some View {
        HStack(spacing: 10) {
            arrow("chevron.left", label: "Previous week") { onMove(-1) }
            VStack(spacing: 3) {
                Text(label)
                    .font(.system(.headline, weight: .heavy))
                    .foregroundStyle(Color.fwInk)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 4) {
                    Text("\(shifts.count) \(shifts.count == 1 ? "shift" : "shifts") · \(ScheduleDates.hours(minutes))")
                        .foregroundStyle(Color.fwInk3)
                    if isAdmin && !shifts.isEmpty {
                        Text("· \(paidCount)/\(shifts.count) paid")
                            .foregroundStyle(paidCount == shifts.count ? Color.fwClear : Color.fwInk3)
                    }
                    if isRefreshing {
                        ProgressView().controlSize(.mini).tint(Color.fwInk3)
                    }
                }
                .font(FWFont.mono(.caption2))
                .contentTransition(.numericText())
                if !isThisWeek {
                    Button("Back to this week", action: onToday)
                        .font(.system(.caption, weight: .bold))
                        .foregroundStyle(Color.fwEmber)
                        .frame(minHeight: 28)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .frame(maxWidth: .infinity)
            arrow("chevron.right", label: "Next week") { onMove(1) }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: label)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isThisWeek)
        .padding(10)
        .background(Color.fwSurface, in: .rect(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(Color.fwLine, lineWidth: 1) }
        .padding(.horizontal, 16)
        .sensoryFeedback(.selection, trigger: label)
    }

    private func arrow(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.fwInk)
                .frame(width: 46, height: 46)
                .background(Color.fwRaised, in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

// MARK: - Filter chip

private struct FilterChip: View {
    let title: String
    let symbol: String?
    let isOn: Bool
    let solid: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)) }
                Text(title).lineLimit(1)
            }
            .font(.system(.subheadline, weight: .medium))
            .foregroundStyle(isOn ? (solid ? Color.white : Color.fwEmber) : Color.fwInk2)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .frame(maxWidth: 200)
            .background(isOn ? (solid ? Color.fwEmber : Color.fwEmber.opacity(0.15)) : Color.fwSurface, in: Capsule())
            .overlay { Capsule().strokeBorder(isOn ? Color.fwEmber.opacity(0.6) : Color.fwLine, lineWidth: 1) }
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

// MARK: - Day

private struct DaySection: View {
    let day: Date
    let isToday: Bool
    let shifts: [Shift]
    let isAdmin: Bool
    let showProperty: Bool
    let myStaffIds: Set<String>
    let staffName: (String) -> String
    let propertyName: (String) -> String
    let onAdd: () -> Void
    let onEdit: (Shift) -> Void
    let onTogglePaid: (Shift) -> Void

    private var dayColor: Color { DayPalette.color(for: day) }

    var body: some View {
        if !isAdmin && shifts.isEmpty {
            HStack(spacing: 12) {
                dayLabel(muted: true)
                Spacer()
                Text("Off").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk3)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background {
                ZStack(alignment: .top) {
                    LinearGradient(colors: [dayColor.opacity(0.09), .clear], startPoint: .top, endPoint: .bottom)
                    LinearGradient(colors: [dayColor.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(height: 3)
                }
                .clipShape(.rect(cornerRadius: 14))
            }
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.fwLine.opacity(0.7), lineWidth: 1) }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    dayLabel(muted: false)
                    Spacer()
                    if isAdmin {
                        Button(action: onAdd) {
                            Image(systemName: "plus")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Color.fwEmber)
                                .frame(width: 44, height: 44)
                                .background(Color.fwEmber.opacity(0.1), in: .rect(cornerRadius: 11))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("Add shift on \(day.formatted(.dateTime.weekday(.wide).month().day()))")
                    } else {
                        Text("\(shifts.count)").font(FWFont.mono(.caption)).foregroundStyle(Color.fwInk3)
                    }
                }
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .padding(.vertical, 6)
                Divider().overlay(dayColor.opacity(0.35))
                if shifts.isEmpty {
                    Button(action: onAdd) {
                        Text("No shifts · tap to add")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk3)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .overlay {
                                RoundedRectangle(cornerRadius: 11)
                                    .strokeBorder(Color.fwLine, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            }
                            .contentShape(.rect)
                    }
                    .buttonStyle(PressableStyle())
                    .padding(10)
                } else {
                    VStack(spacing: 8) {
                        ForEach(shifts) { shift in
                            ShiftCardView(
                                shift: shift,
                                staffName: staffName(shift.staffId),
                                propertyName: showProperty ? propertyName(shift.propertyId) : nil,
                                isAdmin: isAdmin,
                                isMine: myStaffIds.contains(shift.staffId),
                                onEdit: isAdmin ? { onEdit(shift) } : nil,
                                onTogglePaid: isAdmin ? { onTogglePaid(shift) } : nil
                            )
                        }
                    }
                    .padding(10)
                }
            }
            .background {
                ZStack(alignment: .top) {
                    Color.fwSurface
                    LinearGradient(
                        colors: [dayColor.opacity(0.15), dayColor.opacity(0.05), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    LinearGradient(colors: [dayColor, .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(height: 3)
                }
                .clipShape(.rect(cornerRadius: 14))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14).strokeBorder(isToday ? Color.fwEmber.opacity(0.5) : Color.fwLine, lineWidth: 1)
            }
        }
    }

    private func dayLabel(muted: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
                Text(day.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .foregroundStyle(muted ? dayColor.opacity(0.6) : dayColor)
                if isToday {
                    Text(" · TODAY").foregroundStyle(Color.fwEmber)
                }
            }
            .font(FWFont.label)
            .tracking(1.4)
            Text(day.formatted(.dateTime.month(.abbreviated).day()))
                .font(.system(.headline, weight: .heavy))
                .foregroundStyle(muted ? Color.fwInk3 : Color.fwInk)
        }
    }
}

// MARK: - Pay summary

private struct PaySummaryCard: View {
    let shifts: [Shift]
    let staffName: (String) -> String
    let onMarkAll: (_ ids: [String], _ paid: Bool, _ name: String) -> Void

    private struct Row: Identifiable {
        let id: String
        let name: String
        var shifts: [Shift]
        var minutes: Int
        var paidMinutes: Int
        var paidCount: Int { shifts.filter(\.isPaid).count }
        var allPaid: Bool { paidCount == shifts.count }
        var progress: Double { minutes == 0 ? 0 : Double(paidMinutes) / Double(minutes) }
    }

    private var rows: [Row] {
        var map: [String: Row] = [:]
        for s in shifts {
            var row = map[s.staffId] ?? Row(id: s.staffId, name: staffName(s.staffId), shifts: [], minutes: 0, paidMinutes: 0)
            row.shifts.append(s)
            row.minutes += s.minutes
            if s.isPaid { row.paidMinutes += s.minutes }
            map[s.staffId] = row
        }
        return map.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "dollarsign.circle")
                    .font(.system(size: 28, weight: .regular))
                    .foregroundStyle(Color.fwClear)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pay this week").font(FWFont.display(.title3)).foregroundStyle(Color.fwInk)
                    Text("Tap Mark Paid on a shift, or settle a person's whole week here. Only admins can see pay status.")
                        .font(.footnote)
                        .foregroundStyle(Color.fwInk2)
                }
            }
            .padding(18)
            if rows.isEmpty {
                Text("No shifts scheduled for this week yet.")
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk3)
                    .padding([.horizontal, .bottom], 18)
            } else {
                Divider().overlay(Color.fwLine)
                ForEach(rows) { row in
                    rowView(row)
                    if row.id != rows.last?.id { Divider().overlay(Color.fwLine) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.fwSurface, in: .rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.fwLine, lineWidth: 1) }
    }

    private func rowView(_ row: Row) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(row.allPaid ? Color.fwClear.opacity(0.15) : Color.fwRaised).frame(width: 40, height: 40)
                    Circle().strokeBorder(row.allPaid ? Color.fwClear.opacity(0.45) : Color.fwLine, lineWidth: 1).frame(width: 40, height: 40)
                    Text(initials(row.name))
                        .font(.system(.subheadline, weight: .bold))
                        .foregroundStyle(row.allPaid ? Color.fwClear : Color.fwSilver)
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.name).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk).lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(ScheduleDates.hours(row.paidMinutes)) / \(ScheduleDates.hours(row.minutes))")
                            .font(FWFont.mono(.caption))
                            .foregroundStyle(Color.fwInk2)
                            .contentTransition(.numericText())
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.fwRaised)
                            Capsule().fill(Color.fwClear).frame(width: geo.size.width * row.progress)
                        }
                    }
                    .frame(height: 6)
                    Text("\(row.paidCount) of \(row.shifts.count) \(row.shifts.count == 1 ? "shift" : "shifts") paid")
                        .font(.caption)
                        .foregroundStyle(Color.fwInk3)
                        .contentTransition(.numericText())
                }
            }
            Button {
                let ids = row.shifts.filter { row.allPaid ? $0.isPaid : !$0.isPaid }.map(\.id)
                onMarkAll(ids, !row.allPaid, row.name)
            } label: {
                Label(row.allPaid ? "Mark week unpaid" : "Mark week paid", systemImage: row.allPaid ? "arrow.uturn.backward" : "checkmark.circle")
            }
            .buttonStyle(OutlineButtonStyle(tint: row.allPaid ? .fwInk2 : .fwClear, compact: true))
        }
        .padding(16)
        .animation(.spring(response: 0.5, dampingFraction: 0.85), value: row.paidMinutes)
    }

    private func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}
