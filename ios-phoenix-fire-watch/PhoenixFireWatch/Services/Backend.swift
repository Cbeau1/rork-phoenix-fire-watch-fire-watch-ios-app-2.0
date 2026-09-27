import Foundation
import Supabase

/// Shared Supabase client — the same backend and accounts as the Phoenix Fire Watch website.
nonisolated enum Backend {
    static let photoBucket = "patrol-photos"

    static let client: SupabaseClient = {
        let fallback = URL(string: "https://placeholder.supabase.co")!
        let url = URL(string: Config.EXPO_PUBLIC_SUPABASE_URL) ?? fallback
        return SupabaseClient(
            supabaseURL: url,
            supabaseKey: Config.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            options: SupabaseClientOptions(auth: .init(emitLocalSessionAsInitialSession: true))
        )
    }()

    /// Invokes an edge function and surfaces its `{ error }` message as a readable error.
    @discardableResult
    static func invoke(_ name: String, body: [String: AnyJSON]) async throws -> [String: AnyJSON] {
        let data: Data
        do {
            data = try await client.functions.invoke(name, options: FunctionInvokeOptions(body: body)) { data, _ in data }
        } catch FunctionsError.httpError(_, let payload) {
            throw AppError(serverMessage(payload) ?? "Something went wrong. Please try again.")
        }
        let object = (try? JSONDecoder().decode([String: AnyJSON].self, from: data)) ?? [:]
        if case let .string(message)? = object["error"] {
            throw AppError(message)
        }
        return object
    }

    private static func serverMessage(_ data: Data) -> String? {
        guard let object = try? JSONDecoder().decode([String: AnyJSON].self, from: data),
              case let .string(message)? = object["error"] else { return nil }
        return message
    }
}

nonisolated struct AppError: LocalizedError, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Converts backend errors into user-friendly messages.
nonisolated enum ErrorText {
    static let offlineAction = "You're offline. This action needs a connection — try again once you're back online."

    static func from(_ error: Error, fallback: String = "Something went wrong. Please try again.") -> String {
        if let app = error as? AppError { return app.message }
        if isNetwork(error) { return "Network error — check your connection." }
        let message = error.localizedDescription
        if message.range(of: "invalid login credentials", options: .caseInsensitive) != nil {
            return "Incorrect email or password."
        }
        if message.range(of: "banned", options: .caseInsensitive) != nil {
            return "This account has been deactivated. Contact your organization admin."
        }
        if message.range(of: "row-level security|permission denied", options: [.regularExpression, .caseInsensitive]) != nil {
            return "You don't have permission to do that."
        }
        return message.isEmpty ? fallback : message
    }

    static func isNetwork(_ error: Error) -> Bool {
        if error is URLError { return true }
        return (error as NSError).domain == NSURLErrorDomain
    }

    /// True for lost connectivity or an expired token — safe to retry later.
    static func isRetryable(_ error: Error) -> Bool {
        if isNetwork(error) { return true }
        let text = "\(error) \(error.localizedDescription)"
        return text.range(
            of: "JWT expired|timed out|timeout|network|offline|not connected|502|503|504",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    static func isDuplicate(_ error: Error) -> Bool {
        if let pg = error as? PostgrestError, pg.code == "23505" { return true }
        return "\(error)".range(of: "duplicate key|already exists|Duplicate", options: .regularExpression) != nil
    }
}
