import Foundation
import Observation
import Supabase

/// The signed-in person's time clock: clock in / clock out and their own hours worked.
/// Approval and payroll are web-admin only; this store never loads anyone else's entries.
@Observable
final class TimeClockStore {
    private(set) var open: TimeEntry?
    private(set) var entries: [TimeEntry] = []
    private(set) var weekStart: Date = ScheduleDates.weekStart(of: Date())
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    private(set) var isPunching: Bool = false
    private(set) var loadError: String?
    var isOnline: Bool = true

    @ObservationIgnored private var userId: String?
    @ObservationIgnored private var generation: Int = 0

    var isCurrentWeek: Bool { ScheduleDates.key(weekStart) == ScheduleDates.key(ScheduleDates.weekStart(of: Date())) }

    func configure(userId: String?) async {
        guard userId != self.userId else { return }
        self.userId = userId
        open = nil
        entries = []
        hasLoaded = false
        loadError = nil
        weekStart = ScheduleDates.weekStart(of: Date())
        guard userId != nil else { return }
        await refresh()
    }

    func shiftWeek(by weeks: Int) async {
        let next = ScheduleDates.addDays(weeks * 7, to: weekStart)
        guard next <= ScheduleDates.weekStart(of: Date()) else { return }
        weekStart = next
        entries = []
        await refresh()
    }

    func refresh() async {
        guard let userId else { return }
        generation += 1
        let gen = generation
        let from = DateParser.iso(weekStart)
        let to = DateParser.iso(ScheduleDates.addDays(7, to: weekStart))
        isLoading = true
        defer { if gen == generation { isLoading = false } }
        do {
            let db = Backend.client
            let openRows: [TimeEntry] = try await db.from("time_entries")
                .select("id, clock_in, clock_out, status")
                .eq("profile_id", value: userId)
                .is("clock_out", value: nil)
                .limit(1)
                .execute().value
            let rows: [TimeEntry] = try await db.from("time_entries")
                .select("id, clock_in, clock_out, status")
                .eq("profile_id", value: userId)
                .gte("clock_in", value: from)
                .lt("clock_in", value: to)
                .order("clock_in", ascending: false)
                .execute().value
            guard gen == generation else { return }
            open = openRows.first
            entries = rows
            hasLoaded = true
            loadError = nil
        } catch {
            print("[TimeClock] refresh failed: \(error.localizedDescription)")
            guard gen == generation else { return }
            loadError = ErrorText.isRetryable(error)
                ? "You're offline. Your hours will load when you reconnect."
                : ErrorText.from(error, fallback: "Couldn't load your hours.")
        }
    }

    /// Minutes worked this week (rejected entries excluded; an open shift counts up to `now`).
    func weekMinutes(now: Date = Date()) -> Int {
        entries.filter { $0.status != "rejected" }.reduce(0) { $0 + $1.minutes(now: now) }
    }

    private nonisolated struct NoteParams: Encodable, Sendable {
        let p_note: String
    }

    func clockIn() async throws {
        try await punch(function: "tc_clock_in")
    }

    @discardableResult
    func clockOut() async throws -> TimeEntry? {
        let finished = open
        try await punch(function: "tc_clock_out")
        guard let finished else { return nil }
        return entries.first { $0.id == finished.id }
    }

    private func punch(function: String) async throws {
        guard isOnline else { throw AppError("You're offline. Clocking in or out needs a connection.") }
        isPunching = true
        defer { isPunching = false }
        do {
            let entry: TimeEntry = try await Backend.client.rpc(function, params: NoteParams(p_note: "")).execute().value
            open = entry.isOpen ? entry : nil
            if !isCurrentWeek { weekStart = ScheduleDates.weekStart(of: Date()) }
            entries.removeAll { $0.id == entry.id }
            entries.insert(entry, at: 0)
            entries.sort { $0.clockIn > $1.clockIn }
        } catch {
            await refresh()
            throw AppError(ErrorText.from(error, fallback: "Couldn't reach the time clock. Try again."))
        }
    }
}
