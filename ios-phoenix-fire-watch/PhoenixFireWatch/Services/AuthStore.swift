import Foundation
import Observation
import Supabase

enum AuthStatus: Equatable {
    case loading
    case signedOut
    case needsTerms
    case ready
    case noAccess(String)
}

/// Supabase Auth session + the officer's profile. Works offline from the device copy.
@Observable
final class AuthStore {
    private(set) var status: AuthStatus = .loading
    private(set) var user: SessionUser?

    @ObservationIgnored private var listenTask: Task<Void, Never>?
    @ObservationIgnored private var recovering: Bool = false
    @ObservationIgnored private var sessionUserId: String?

    private static let profileCacheFile = "session-profile.json"

    var isAdmin: Bool { user?.isAdmin ?? false }

    func start() {
        guard listenTask == nil else { return }
        listenTask = Task { [weak self] in
            for await (event, session) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                await self.handle(event: event, session: session)
            }
        }
    }

    private func handle(event: AuthChangeEvent, session: Session?) async {
        if recovering { return }
        guard let session else {
            sessionUserId = nil
            user = nil
            status = .signedOut
            return
        }
        let id = session.user.id.uuidString.lowercased()
        let isNewUser = id != sessionUserId
        sessionUserId = id
        if isNewUser, let cached = LocalStore.load(SessionUser.self, from: Self.profileCacheFile), cached.id == id {
            apply(cached)
        }
        switch event {
        case .initialSession, .signedIn, .userUpdated:
            await loadProfile()
        case .tokenRefreshed:
            if user == nil { await loadProfile() }
        default:
            break
        }
    }

    private func apply(_ next: SessionUser?) {
        user = next
        if let next {
            status = next.termsAccepted ? .ready : .needsTerms
        }
    }

    /// Fetches the profile + organization. Keeps the cached copy when offline.
    func loadProfile() async {
        guard let id = sessionUserId else { return }
        do {
            let rows: [ProfileRow] = try await Backend.client
                .from("profiles")
                .select("id, full_name, email, role, active, org_id, terms_accepted_at, organizations(name, retention_days)")
                .eq("id", value: id)
                .limit(1)
                .execute()
                .value
            guard let row = rows.first, row.active else {
                user = nil
                LocalStore.remove(Self.profileCacheFile)
                status = .noAccess("This account doesn't have access. Contact your organization admin.")
                return
            }
            let next = SessionUser(
                id: row.id,
                name: row.fullName,
                email: row.email,
                role: row.role == "admin" ? .admin : .officer,
                orgId: row.orgId,
                orgName: row.organizations?.name ?? "",
                retentionDays: row.organizations?.retentionDays,
                termsAccepted: row.termsAcceptedAt != nil
            )
            LocalStore.save(next, as: Self.profileCacheFile)
            apply(next)
        } catch {
            print("[Auth] profile load failed: \(error.localizedDescription)")
            if user == nil {
                status = .noAccess(
                    ErrorText.isRetryable(error)
                        ? "You're offline. Signing in on this device for the first time needs a connection."
                        : ErrorText.from(error, fallback: "Couldn't load your account.")
                )
            }
        }
    }

    func signIn(email: String, password: String) async throws {
        do {
            try await Backend.client.auth.signIn(email: email.trimmed.lowercased(), password: password)
        } catch {
            if ErrorText.isNetwork(error) {
                throw AppError("You're offline. Signing in for the first time on this device needs a connection.")
            }
            throw AppError(ErrorText.from(error))
        }
    }

    func signUp(orgName: String, fullName: String, email: String, password: String) async throws {
        try await Backend.invoke("create-organization", body: [
            "orgName": .string(orgName.trimmed),
            "fullName": .string(fullName.trimmed),
            "email": .string(email.trimmed.lowercased()),
            "password": .string(password),
            "acceptedTerms": .bool(true),
        ])
        try await signIn(email: email, password: password)
    }

    /// Emails a one-time reset code. Returns false when email delivery isn't available.
    func requestPasswordReset(email: String) async throws -> Bool {
        let res = try await Backend.invoke("password-reset", body: ["email": .string(email.trimmed.lowercased())])
        if case .bool(false)? = res["ok"] { return false }
        return true
    }

    /// Verifies the emailed code, sets the new password, and signs the officer in.
    func completePasswordReset(email: String, code: String, password: String) async throws {
        recovering = true
        defer { recovering = false }
        do {
            try await Backend.client.auth.verifyOTP(
                email: email.trimmed.lowercased(),
                token: code.replacingOccurrences(of: " ", with: ""),
                type: .recovery
            )
        } catch {
            let text = ErrorText.from(error)
            if text.range(of: "expired|invalid", options: [.regularExpression, .caseInsensitive]) != nil {
                throw AppError("That code is invalid or has expired. Request a new one.")
            }
            throw AppError(text)
        }
        do {
            try await Backend.client.auth.update(user: UserAttributes(password: password))
        } catch {
            try? await Backend.client.auth.signOut(scope: .local)
            let text = ErrorText.from(error)
            if text.range(of: "different from the old", options: .caseInsensitive) != nil {
                throw AppError("Choose a password that's different from your old one.")
            }
            throw AppError(text)
        }
        recovering = false
        let session = try? await Backend.client.auth.session
        await handle(event: .signedIn, session: session)
    }

    func signOut() async {
        try? await Backend.client.auth.signOut(scope: .local)
        clearLocalData()
        sessionUserId = nil
        user = nil
        status = .signedOut
    }

    private func clearLocalData() {
        if let id = user?.id { LocalStore.removeAll(withPrefix: "cache-\(id)") }
        LocalStore.remove(Self.profileCacheFile)
        PhotoLoader.shared.clearDisk()
    }

    func changePassword(_ password: String) async throws {
        do {
            try await Backend.client.auth.update(user: UserAttributes(password: password))
        } catch {
            throw AppError(ErrorText.from(error))
        }
    }

    func updateName(_ name: String) async throws {
        guard let user else { return }
        try await Backend.client.from("profiles").update(["full_name": AnyJSON.string(name.trimmed)]).eq("id", value: user.id).execute()
        await loadProfile()
    }

    func acceptTerms() async throws {
        guard let id = sessionUserId else { return }
        try await Backend.client
            .from("profiles")
            .update(["terms_accepted_at": AnyJSON.string(DateParser.iso(Date()))])
            .eq("id", value: id)
            .execute()
        await loadProfile()
    }

    func renameOrg(_ name: String) async throws {
        guard let user else { return }
        try await Backend.client.from("organizations").update(["name": AnyJSON.string(name.trimmed)]).eq("id", value: user.orgId).execute()
        await loadProfile()
    }

    func setRetention(_ days: Int?) async throws {
        guard let user else { return }
        let value: AnyJSON = days.map { AnyJSON.integer($0) } ?? .null
        try await Backend.client.from("organizations").update(["retention_days": value]).eq("id", value: user.orgId).execute()
        await loadProfile()
    }

    enum DeleteScope: String { case account = "self", organization }

    /// Permanently deletes the officer's account, or (admins) the whole organization.
    ///
    /// The `delete-account` edge function (backend/functions/delete-account) runs with the
    /// service role and calls `auth.admin.deleteUser` for the caller (or every member when the
    /// organization is deleted), so the Supabase Auth login itself is removed — not just app
    /// data. Organization deletion also removes all properties, patrols, notes and photos.
    func deleteAccount(scope: DeleteScope, confirmName: String = "") async throws {
        guard let user else { return }
        try await Backend.invoke("delete-account", body: [
            "scope": .string(scope.rawValue),
            "confirmName": .string(confirmName),
        ])
        LocalStore.remove("outbox-\(user.id).json")
        await signOut()
    }

    func retry() async {
        status = .loading
        guard let session = try? await Backend.client.auth.session else {
            status = .signedOut
            return
        }
        sessionUserId = session.user.id.uuidString.lowercased()
        await loadProfile()
    }
}
