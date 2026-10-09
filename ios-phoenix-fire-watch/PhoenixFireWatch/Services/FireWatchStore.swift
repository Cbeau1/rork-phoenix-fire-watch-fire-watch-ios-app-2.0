import Foundation
import Observation
import Supabase

/// Organization data (properties, patrols, watch notes) shared live with the website.
/// Every change is saved on the device first and uploads automatically — works offline.
@Observable
final class FireWatchStore {
    private(set) var serverProperties: [Property] = []
    private(set) var serverPatrols: [Patrol] = []
    private(set) var serverNotes: [WatchNote] = []
    private(set) var ops: [OutboxOp] = []
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    private(set) var loadError: String?
    private(set) var syncing: Bool = false
    private(set) var lastSyncedAt: Date?
    var isOnline: Bool = true {
        didSet { if isOnline && !oldValue { Task { await self.onReconnect() } } }
    }

    @ObservationIgnored private(set) var user: SessionUser?
    @ObservationIgnored private var flushTask: Task<Void, Never>?
    @ObservationIgnored private var rerunFlush: Bool = false
    @ObservationIgnored private var realtimeChannel: RealtimeChannelV2?
    @ObservationIgnored private var realtimeTasks: [Task<Void, Never>] = []
    @ObservationIgnored private var refreshDebounce: Task<Void, Never>?

    // MARK: - Session lifecycle

    func configure(for user: SessionUser?) async {
        guard user?.id != self.user?.id || user?.orgId != self.user?.orgId else {
            self.user = user
            return
        }
        await stopRealtime()
        self.user = user
        serverProperties = []
        serverPatrols = []
        serverNotes = []
        ops = []
        hasLoaded = false
        loadError = nil
        guard let user else { return }
        serverProperties = LocalStore.load([Property].self, from: cacheName("properties")) ?? []
        serverPatrols = LocalStore.load([Patrol].self, from: cacheName("patrols")) ?? []
        serverNotes = LocalStore.load([WatchNote].self, from: cacheName("notes")) ?? []
        ops = (LocalStore.load([OutboxOp].self, from: outboxName) ?? []).sorted { $0.createdAt < $1.createdAt }
        hasLoaded = !serverProperties.isEmpty || !serverPatrols.isEmpty
        await refresh()
        await startRealtime()
        await flush()
    }

    private func cacheName(_ kind: String) -> String { "cache-\(user?.id ?? "anon")-\(kind).json" }
    private var outboxName: String { "outbox-\(user?.id ?? "anon").json" }

    private func onReconnect() async {
        guard user != nil else { return }
        await flush()
        await refresh()
    }

    // MARK: - Loading

    func refresh() async {
        guard user != nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let p: [Property] = try await Backend.client.from("properties").select().order("created_at", ascending: false).execute().value
            let n: [WatchNote] = try await Backend.client.from("watch_notes").select()
                .filter("resolved_at", operator: "is", value: "null")
                .order("created_at", ascending: false).limit(500).execute().value
            let pa: [Patrol] = try await fetchAllPatrols()
            serverProperties = p
            serverNotes = n
            serverPatrols = pa
            LocalStore.save(p, as: cacheName("properties"))
            LocalStore.save(n, as: cacheName("notes"))
            LocalStore.save(pa, as: cacheName("patrols"))
            hasLoaded = true
            loadError = nil
        } catch {
            print("[FireWatch] refresh failed: \(error.localizedDescription)")
            if !hasLoaded {
                loadError = ErrorText.isRetryable(error)
                    ? "You're offline and nothing is saved on this device yet."
                    : ErrorText.from(error, fallback: "Couldn't load your data.")
            }
        }
    }

    private func fetchAllPatrols() async throws -> [Patrol] {
        var rows: [Patrol] = []
        let page = 1000
        var from = 0
        while from < 50_000 {
            let batch: [Patrol] = try await Backend.client
                .from("patrols")
                .select()
                .order("date_time", ascending: false)
                .range(from: from, to: from + page - 1)
                .execute()
                .value
            rows.append(contentsOf: batch)
            if batch.count < page { break }
            from += page
        }
        return rows
    }

    private func scheduleRefresh() {
        refreshDebounce?.cancel()
        refreshDebounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await self?.refresh()
        }
    }

    // MARK: - Realtime

    private func startRealtime() async {
        guard let user else { return }
        let channel = Backend.client.channel("ios-org-\(user.orgId)")
        let streams = [
            channel.postgresChange(AnyAction.self, schema: "public", table: "properties"),
            channel.postgresChange(AnyAction.self, schema: "public", table: "patrols"),
            channel.postgresChange(AnyAction.self, schema: "public", table: "watch_notes"),
        ]
        realtimeTasks = streams.map { stream in
            Task { [weak self] in
                for await _ in stream {
                    self?.scheduleRefresh()
                }
            }
        }
        realtimeChannel = channel
        await channel.subscribe()
    }

    private func stopRealtime() async {
        realtimeTasks.forEach { $0.cancel() }
        realtimeTasks = []
        if let channel = realtimeChannel {
            await Backend.client.removeChannel(channel)
        }
        realtimeChannel = nil
    }

    // MARK: - Views (server data + local changes waiting to sync)

    var properties: [Property] {
        var list = serverProperties
        for op in ops {
            switch op.kind {
            case .propertyCreate:
                guard let id = op.propertyId, let input = op.propertyInput, !list.contains(where: { $0.id == id }) else { continue }
                list.insert(
                    Property(
                        id: id, name: input.name, address: input.address, contactName: input.contactName,
                        contactPhone: input.contactPhone, contactEmail: input.contactEmail, notes: input.notes,
                        patrolIntervalMinutes: Property.defaultInterval, createdAt: op.createdAt
                    ),
                    at: 0
                )
            case .propertyUpdate:
                guard let id = op.propertyId, let input = op.propertyInput, let i = list.firstIndex(where: { $0.id == id }) else { continue }
                list[i].name = input.name
                list[i].address = input.address
                list[i].contactName = input.contactName
                list[i].contactPhone = input.contactPhone
                list[i].contactEmail = input.contactEmail
                list[i].notes = input.notes
            default:
                continue
            }
        }
        return list
    }

    var patrols: [Patrol] {
        let local: [Patrol] = ops.compactMap { op in
            guard op.kind == .patrolCreate, var p = op.patrol, !serverPatrols.contains(where: { $0.id == p.id }) else { return nil }
            p.syncState = op.failed ? .failed : .pending
            p.localPhotoFiles = op.photoFiles
            return p
        }
        if local.isEmpty { return serverPatrols }
        return (local + serverPatrols).sorted { $0.dateTime > $1.dateTime }
    }

    var notes: [WatchNote] {
        var list = serverNotes
        for op in ops {
            if op.kind == .noteCreate, let n = op.note, !list.contains(where: { $0.id == n.id }) {
                list.append(n)
            } else if op.kind == .noteResolve, let id = op.noteId {
                list.removeAll { $0.id == id }
            }
        }
        return list.sorted { $0.createdAt > $1.createdAt }
    }

    func property(id: String) -> Property? { properties.first { $0.id == id } }
    func patrols(for propertyId: String) -> [Patrol] { patrols.filter { $0.propertyId == propertyId } }
    func isPending(propertyId: String) -> Bool {
        ops.contains { ($0.kind == .propertyCreate || $0.kind == .propertyUpdate) && $0.propertyId == propertyId }
    }
    func isPending(noteId: String) -> Bool { ops.contains { $0.kind == .noteCreate && $0.note?.id == noteId } }

    var pendingCount: Int { ops.filter { !$0.failed }.count }
    var failedCount: Int { ops.filter(\.failed).count }

    // MARK: - Outbox

    private func persistOps() {
        LocalStore.save(ops, as: outboxName)
    }

    private func enqueue(_ op: OutboxOp) {
        ops.append(op)
        persistOps()
    }

    private func replace(_ op: OutboxOp) {
        guard let i = ops.firstIndex(where: { $0.id == op.id }) else { return }
        ops[i] = op
        persistOps()
    }

    private func drop(_ id: String) {
        ops.removeAll { $0.id == id }
        persistOps()
    }

    /// Replays queued changes. Safe to call repeatedly; concurrent calls coalesce.
    func flush() async {
        if let running = flushTask {
            rerunFlush = true
            await running.value
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.rerunFlush = false
                await self.flushOnce()
            } while self.rerunFlush
        }
        flushTask = task
        await task.value
        flushTask = nil
        syncing = false
    }

    private func flushOnce() async {
        guard isOnline, user != nil else { return }
        let queue = ops.filter { !$0.failed }
        guard !queue.isEmpty else { return }
        guard (try? await Backend.client.auth.session) != nil else { return }
        syncing = true
        var touched = false
        for queued in queue {
            guard isOnline, let current = ops.first(where: { $0.id == queued.id }), !current.failed else { continue }
            do {
                let done = try await run(current)
                applySynced(done)
                if done.kind == .patrolCreate { PhotoStore.delete(done.photoFiles) }
                drop(done.id)
                touched = true
            } catch {
                var next = ops.first(where: { $0.id == queued.id }) ?? current
                next.attempts += 1
                next.error = ErrorText.from(error)
                if ErrorText.isRetryable(error) {
                    replace(next)
                    break
                }
                print("[Sync] change rejected: \(current.kind.rawValue) — \(next.error ?? "")")
                next.failed = true
                replace(next)
            }
        }
        if touched {
            lastSyncedAt = Date()
            scheduleRefresh()
        }
    }

    /// Sends one queued change. Idempotent: safe to replay after a dropped connection.
    private func run(_ op: OutboxOp) async throws -> OutboxOp {
        guard let user else { throw AppError("Please sign in again.") }
        let db = Backend.client
        switch op.kind {
        case .patrolCreate:
            guard let p = op.patrol else { return op }
            var progress = op
            for index in progress.uploaded.count..<op.photoFiles.count {
                guard let data = PhotoStore.data(for: op.photoFiles[index]) else { continue }
                let path = "\(user.orgId)/\(p.id)/\(index + 1).jpg"
                do {
                    _ = try await db.storage.from(Backend.photoBucket).upload(
                        path,
                        data: data,
                        options: FileOptions(contentType: "image/jpeg", upsert: false)
                    )
                } catch {
                    if !ErrorText.isDuplicate(error) && "\(error)".range(of: "exists", options: .caseInsensitive) == nil {
                        throw error
                    }
                }
                progress.uploaded.append(path)
                replace(progress)
            }
            let row = PatrolInsert(
                id: p.id, propertyId: p.propertyId, dateTime: DateParser.iso(p.dateTime), officerName: p.officerName,
                areas: p.areas, status: p.status.rawValue, notes: p.notes, photos: progress.uploaded,
                latitude: p.location?.lat, longitude: p.location?.lng,
                locationAccuracyM: p.location.map { ($0.accuracyM * 10).rounded() / 10 }
            )
            do {
                try await db.from("patrols").insert(row).execute()
            } catch let error where ErrorText.isDuplicate(error) { _ = error }
            return progress
        case .propertyCreate:
            guard let id = op.propertyId, let input = op.propertyInput else { return op }
            do {
                try await db.from("properties").insert(PropertyInsert(id: id, input: input)).execute()
            } catch let error where ErrorText.isDuplicate(error) { _ = error }
            return op
        case .propertyUpdate:
            guard let id = op.propertyId, let input = op.propertyInput else { return op }
            try await db.from("properties").update(input).eq("id", value: id).execute()
            return op
        case .noteCreate:
            guard let n = op.note else { return op }
            do {
                try await db.from("watch_notes").insert(
                    WatchNoteInsert(id: n.id, content: n.content, authorName: n.authorName, createdAt: DateParser.iso(n.createdAt))
                ).execute()
            } catch let error where ErrorText.isDuplicate(error) { _ = error }
            return op
        case .noteResolve:
            guard let id = op.noteId else { return op }
            try await db.from("watch_notes").update(["resolved_at": AnyJSON.string(DateParser.iso(op.createdAt))]).eq("id", value: id).execute()
            return op
        }
    }

    /// Writes a synced change into the local copy so it never flickers out of view.
    private func applySynced(_ op: OutboxOp) {
        switch op.kind {
        case .patrolCreate:
            guard var p = op.patrol else { return }
            p = Patrol(
                id: p.id, propertyId: p.propertyId, dateTime: p.dateTime, officerName: p.officerName, areas: p.areas,
                status: p.status, notes: p.notes, photos: op.uploaded, loggedBy: user?.id, createdAt: op.createdAt,
                location: p.location
            )
            serverPatrols.removeAll { $0.id == p.id }
            serverPatrols.append(p)
            serverPatrols.sort { $0.dateTime > $1.dateTime }
        case .propertyCreate, .propertyUpdate:
            guard let id = op.propertyId, let input = op.propertyInput else { return }
            if let i = serverProperties.firstIndex(where: { $0.id == id }) {
                serverProperties[i].name = input.name
                serverProperties[i].address = input.address
                serverProperties[i].contactName = input.contactName
                serverProperties[i].contactPhone = input.contactPhone
                serverProperties[i].contactEmail = input.contactEmail
                serverProperties[i].notes = input.notes
            } else {
                serverProperties.insert(
                    Property(
                        id: id, name: input.name, address: input.address, contactName: input.contactName,
                        contactPhone: input.contactPhone, contactEmail: input.contactEmail, notes: input.notes,
                        patrolIntervalMinutes: Property.defaultInterval, createdAt: op.createdAt
                    ),
                    at: 0
                )
            }
        case .noteCreate:
            guard let n = op.note else { return }
            serverNotes.removeAll { $0.id == n.id }
            serverNotes.insert(n, at: 0)
        case .noteResolve:
            serverNotes.removeAll { $0.id == op.noteId }
        }
    }

    enum SubmitResult { case synced, queued }

    /// Saves a change locally and tries to send it right away. Throws (and discards the
    /// change) if the server rejects it.
    private func submit(_ op: OutboxOp) async throws -> SubmitResult {
        enqueue(op)
        if isOnline { await flush() }
        guard let after = ops.first(where: { $0.id == op.id }) else { return .synced }
        if after.failed {
            drop(op.id)
            if op.kind == .patrolCreate { PhotoStore.delete(op.photoFiles) }
            throw AppError(after.error ?? "Couldn't save this change.")
        }
        return .queued
    }

    func retry(_ id: String) async {
        guard var op = ops.first(where: { $0.id == id }) else { return }
        op.failed = false
        op.attempts = 0
        op.error = nil
        replace(op)
        await flush()
    }

    func discard(_ id: String) {
        if let op = ops.first(where: { $0.id == id }), op.kind == .patrolCreate { PhotoStore.delete(op.photoFiles) }
        drop(id)
    }

    // MARK: - Mutations

    @discardableResult
    func addProperty(_ input: PropertyInput) async throws -> (id: String, result: SubmitResult) {
        let id = IDs.make()
        let op = OutboxOp(id: IDs.make(), kind: .propertyCreate, createdAt: Date(), propertyId: id, propertyInput: input.trimmed)
        let result = try await submit(op)
        return (id, result)
    }

    @discardableResult
    func updateProperty(id: String, input: PropertyInput) async throws -> SubmitResult {
        let op = OutboxOp(id: IDs.make(), kind: .propertyUpdate, createdAt: Date(), propertyId: id, propertyInput: input.trimmed)
        return try await submit(op)
    }

    /// Admin-only: changes how often a property must be patrolled. Needs a connection.
    func setPatrolInterval(propertyId: String, minutes: Int) async throws {
        if ops.contains(where: { $0.kind == .propertyCreate && $0.propertyId == propertyId }) {
            throw AppError("This property hasn't uploaded yet. Try again once it's synced.")
        }
        guard isOnline else { throw AppError(ErrorText.offlineAction) }
        do {
            try await Backend.client.from("properties")
                .update(["patrol_interval_minutes": AnyJSON.integer(minutes)])
                .eq("id", value: propertyId)
                .execute()
        } catch {
            throw AppError(ErrorText.from(error))
        }
        if let i = serverProperties.firstIndex(where: { $0.id == propertyId }) {
            serverProperties[i].patrolIntervalMinutes = minutes
            LocalStore.save(serverProperties, as: cacheName("properties"))
        }
    }

    /// Admin-only: sets or clears the area officers must be inside to log patrols. Needs a connection.
    func setGeofence(propertyId: String, geofence: Geofence) async throws {
        if ops.contains(where: { $0.kind == .propertyCreate && $0.propertyId == propertyId }) {
            throw AppError("This property hasn't uploaded yet. Try again once it's synced.")
        }
        guard isOnline else { throw AppError(ErrorText.offlineAction) }
        do {
            try await Backend.client.from("properties")
                .update(GeofenceUpdate(geofence: geofence))
                .eq("id", value: propertyId)
                .execute()
        } catch {
            throw AppError(ErrorText.from(error))
        }
        if let i = serverProperties.firstIndex(where: { $0.id == propertyId }) {
            serverProperties[i].geofence = geofence
            LocalStore.save(serverProperties, as: cacheName("properties"))
        }
    }

    func deleteProperty(id: String) async throws {
        if let pending = ops.first(where: { $0.kind == .propertyCreate && $0.propertyId == id }) {
            let related = ops.filter {
                $0.id == pending.id || ($0.kind == .propertyUpdate && $0.propertyId == id) || ($0.kind == .patrolCreate && $0.patrol?.propertyId == id)
            }
            related.forEach { discard($0.id) }
            return
        }
        guard isOnline else { throw AppError(ErrorText.offlineAction) }
        let photoPaths = serverPatrols.filter { $0.propertyId == id }.flatMap(\.photos)
        do {
            try await Backend.client.from("properties").delete().eq("id", value: id).execute()
        } catch {
            throw AppError(ErrorText.from(error))
        }
        removePhotos(photoPaths)
        ops.filter { ($0.kind == .patrolCreate && $0.patrol?.propertyId == id) || ($0.kind == .propertyUpdate && $0.propertyId == id) }
            .forEach { discard($0.id) }
        serverProperties.removeAll { $0.id == id }
        serverPatrols.removeAll { $0.propertyId == id }
    }

    struct NewPatrol {
        var propertyId: String
        var dateTime: Date
        var officerName: String
        var areas: [String]
        var status: PatrolStatus
        var notes: String
        /// JPEG photo data captured live with the camera.
        var photos: [Data]
        /// Where the officer was when logging (required at geofenced properties).
        var location: PatrolLocation? = nil
    }

    @discardableResult
    func addPatrol(_ input: NewPatrol) async throws -> SubmitResult {
        let files = try input.photos.map { try PhotoStore.save($0) }
        let patrol = Patrol(
            id: IDs.make(), propertyId: input.propertyId, dateTime: input.dateTime, officerName: input.officerName.trimmed,
            areas: input.areas, status: input.status, notes: input.notes.trimmed, photos: [], loggedBy: user?.id, createdAt: Date(),
            location: input.location
        )
        let op = OutboxOp(id: IDs.make(), kind: .patrolCreate, createdAt: Date(), patrol: patrol, photoFiles: files)
        return try await submit(op)
    }

    func deletePatrol(_ patrol: Patrol) async throws {
        if let pending = ops.first(where: { $0.kind == .patrolCreate && $0.patrol?.id == patrol.id }) {
            discard(pending.id)
            return
        }
        guard isOnline else { throw AppError(ErrorText.offlineAction) }
        do {
            try await Backend.client.from("patrols").delete().eq("id", value: patrol.id).execute()
        } catch {
            throw AppError(ErrorText.from(error))
        }
        removePhotos(patrol.photos)
        serverPatrols.removeAll { $0.id == patrol.id }
    }

    private func removePhotos(_ paths: [String]) {
        guard !paths.isEmpty else { return }
        Task {
            do {
                _ = try await Backend.client.storage.from(Backend.photoBucket).remove(paths: paths)
            } catch {
                print("[FireWatch] photo cleanup failed: \(error.localizedDescription)")
            }
        }
    }

    @discardableResult
    func addNote(_ content: String) async throws -> SubmitResult {
        let note = WatchNote(id: IDs.make(), content: content.trimmed, authorName: user?.name ?? "Officer", authorId: user?.id, createdAt: Date())
        return try await submit(OutboxOp(id: IDs.make(), kind: .noteCreate, createdAt: Date(), note: note))
    }

    func resolveNote(_ id: String) async throws {
        _ = try await submit(OutboxOp(id: IDs.make(), kind: .noteResolve, createdAt: Date(), noteId: id))
    }
}
