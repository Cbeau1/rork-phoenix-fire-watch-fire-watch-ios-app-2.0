import Foundation
import Observation
import Supabase

/// Staff roster + one week of shifts, shared live with the website.
/// Admins edit everything and see pay status; officers get a read-only view
/// (pay rows are hidden from them by the server, not just the UI).
/// The last loaded week stays viewable offline; changes need a connection.
@Observable
final class ScheduleStore {
    private(set) var staff: [StaffMember] = []
    private(set) var shifts: [Shift] = []
    private(set) var members: [Member] = []
    private(set) var weekStart: Date = ScheduleDates.weekStart(of: Date())
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    private(set) var loadError: String?
    var isOnline: Bool = true

    @ObservationIgnored private var user: SessionUser?
    @ObservationIgnored private var channel: RealtimeChannelV2?
    @ObservationIgnored private var realtimeTasks: [Task<Void, Never>] = []
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var loadGeneration: Int = 0

    var isAdmin: Bool { user?.isAdmin ?? false }

    // MARK: - Lifecycle

    func configure(for user: SessionUser?) async {
        guard user?.id != self.user?.id || user?.orgId != self.user?.orgId || user?.role != self.user?.role else { return }
        await stopRealtime()
        self.user = user
        staff = []
        shifts = []
        members = []
        hasLoaded = false
        loadError = nil
        weekStart = ScheduleDates.weekStart(of: Date())
        guard user != nil else { return }
        staff = LocalStore.load([StaffMember].self, from: cacheName("staff")) ?? []
        shifts = LocalStore.load([Shift].self, from: weekCacheName) ?? []
        hasLoaded = !staff.isEmpty || !shifts.isEmpty
        await refresh()
        await startRealtime()
    }

    private func cacheName(_ kind: String) -> String { "cache-\(user?.id ?? "anon")-schedule-\(kind).json" }
    private var weekCacheName: String { cacheName("week-\(ScheduleDates.key(weekStart))") }

    func goToWeek(_ start: Date) async {
        let normalized = ScheduleDates.weekStart(of: start)
        guard ScheduleDates.key(normalized) != ScheduleDates.key(weekStart) else { return }
        weekStart = normalized
        shifts = LocalStore.load([Shift].self, from: weekCacheName) ?? []
        await refresh()
    }

    func shiftWeek(by weeks: Int) async {
        await goToWeek(ScheduleDates.addDays(weeks * 7, to: weekStart))
    }

    // MARK: - Loading

    func refresh() async {
        guard user != nil else { return }
        loadGeneration += 1
        let generation = loadGeneration
        let from = ScheduleDates.key(weekStart)
        let to = ScheduleDates.key(ScheduleDates.addDays(6, to: weekStart))
        let cacheFile = weekCacheName
        isLoading = true
        defer { if generation == loadGeneration { isLoading = false } }
        do {
            let db = Backend.client
            let staffRows: [StaffMember] = try await db.from("staff").select("id, name, profile_id")
                .order("name", ascending: true).execute().value
            let rows: [ShiftRow] = try await db.from("shifts")
                .select(isAdmin ? "*, shift_payments(paid_at)" : "*")
                .gte("shift_date", value: from)
                .lte("shift_date", value: to)
                .order("shift_date", ascending: true)
                .order("start_time", ascending: true)
                .execute().value
            guard generation == loadGeneration else { return }
            staff = staffRows.sorted(by: StaffMember.byName)
            shifts = rows.map(\.shift).sorted(by: Shift.byStart)
            LocalStore.save(staff, as: cacheName("staff"))
            LocalStore.save(shifts, as: cacheFile)
            hasLoaded = true
            loadError = nil
            if isAdmin { await loadMembers() }
        } catch {
            print("[Schedule] refresh failed: \(error.localizedDescription)")
            guard generation == loadGeneration else { return }
            if !hasLoaded {
                loadError = ErrorText.isRetryable(error)
                    ? "You're offline and this week isn't saved on this device yet."
                    : ErrorText.from(error, fallback: "Couldn't load the schedule.")
            }
        }
    }

    private func loadMembers() async {
        guard let orgId = user?.orgId else { return }
        do {
            members = try await Backend.client.from("profiles")
                .select("id, full_name, email, role, active, created_at")
                .eq("org_id", value: orgId)
                .order("created_at", ascending: true)
                .execute().value
        } catch {
            print("[Schedule] members load failed: \(error.localizedDescription)")
        }
    }

    private func scheduleRefresh() {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await self?.refresh()
        }
    }

    // MARK: - Realtime

    private func startRealtime() async {
        guard let user else { return }
        let channel = Backend.client.channel("ios-schedule-\(user.orgId)")
        let streams = [
            channel.postgresChange(AnyAction.self, schema: "public", table: "staff"),
            channel.postgresChange(AnyAction.self, schema: "public", table: "shifts"),
            channel.postgresChange(AnyAction.self, schema: "public", table: "shift_payments"),
        ]
        realtimeTasks = streams.map { stream in
            Task { [weak self] in
                for await _ in stream { self?.scheduleRefresh() }
            }
        }
        self.channel = channel
        await channel.subscribe()
    }

    private func stopRealtime() async {
        realtimeTasks.forEach { $0.cancel() }
        realtimeTasks = []
        if let channel { await Backend.client.removeChannel(channel) }
        channel = nil
    }

    // MARK: - Lookups

    func staff(id: String) -> StaffMember? { staff.first { $0.id == id } }

    /// Staff entries linked to the signed-in login.
    var myStaffIds: Set<String> {
        guard let uid = user?.id else { return [] }
        return Set(staff.filter { $0.profileId == uid }.map(\.id))
    }

    // MARK: - Mutations (need a connection)

    private func requireOnline() throws {
        guard isOnline else { throw AppError("You're offline. Schedule changes need a connection — try again once you're back online.") }
    }

    private func perform(_ work: () async throws -> Void) async throws {
        try requireOnline()
        do {
            try await work()
        } catch {
            throw AppError(ErrorText.from(error))
        }
    }

    @discardableResult
    func addStaff(name: String, profileId: String?) async throws -> StaffMember {
        var created: StaffMember?
        try await perform {
            created = try await Backend.client.from("staff")
                .insert(StaffWrite(name: String(name.trimmed.prefix(80)), profileId: profileId))
                .select("id, name, profile_id")
                .single()
                .execute().value
        }
        guard let created else { throw AppError("Couldn't add this person.") }
        staff.removeAll { $0.id == created.id }
        staff.append(created)
        staff.sort(by: StaffMember.byName)
        return created
    }

    func updateStaff(id: String, name: String, profileId: String?) async throws {
        try await perform {
            try await Backend.client.from("staff")
                .update(StaffWrite(name: String(name.trimmed.prefix(80)), profileId: profileId))
                .eq("id", value: id)
                .execute()
        }
        if let i = staff.firstIndex(where: { $0.id == id }) {
            staff[i].name = name.trimmed
            staff[i].profileId = profileId
            staff.sort(by: StaffMember.byName)
        }
    }

    /// Removes the person and every shift they're on.
    func deleteStaff(id: String) async throws {
        try await perform {
            try await Backend.client.from("staff").delete().eq("id", value: id).execute()
        }
        staff.removeAll { $0.id == id }
        shifts.removeAll { $0.staffId == id }
    }

    func addShifts(_ input: ShiftInput, dates: [String]) async throws {
        guard !dates.isEmpty else { return }
        try await perform {
            try await Backend.client.from("shifts")
                .insert(dates.map { ShiftWrite(input: input, date: $0) })
                .execute()
        }
        await refresh()
    }

    func updateShift(id: String, date: String, input: ShiftInput) async throws {
        try await perform {
            try await Backend.client.from("shifts")
                .update(ShiftWrite(input: input, date: date))
                .eq("id", value: id)
                .execute()
        }
        await refresh()
    }

    func deleteShift(id: String) async throws {
        try await perform {
            try await Backend.client.from("shifts").delete().eq("id", value: id).execute()
        }
        shifts.removeAll { $0.id == id }
    }

    /// Marks shifts paid / unpaid. Updates instantly and rolls back if the server refuses.
    func setPaid(ids: [String], paid: Bool) async throws {
        guard !ids.isEmpty else { return }
        try requireOnline()
        let previous = shifts
        let idSet = Set(ids)
        let stamp = Date()
        for i in shifts.indices where idSet.contains(shifts[i].id) {
            shifts[i].paidAt = paid ? (shifts[i].paidAt ?? stamp) : nil
        }
        do {
            if paid {
                try await Backend.client.from("shift_payments")
                    .upsert(ids.map { ShiftPaymentWrite(shiftId: $0) }, onConflict: "shift_id", returning: .minimal, ignoreDuplicates: true)
                    .execute()
            } else {
                try await Backend.client.from("shift_payments").delete().in("shift_id", values: ids).execute()
            }
            LocalStore.save(shifts, as: weekCacheName)
        } catch {
            shifts = previous
            throw AppError(ErrorText.from(error, fallback: "Couldn't update pay status."))
        }
    }
}
