import Foundation
import Observation

enum AppTab: Hashable {
    case dashboard, properties, schedule, notes, account
}

enum Route: Hashable {
    case property(String)
    case allPatrols
    case myHours
}

struct Toast: Identifiable, Equatable {
    enum Style { case success, error, info }
    let id = UUID()
    let message: String
    let detail: String?
    let style: Style
}

struct PropertyRef: Identifiable, Hashable {
    let id: String
}

/// App-wide navigation requests (e.g. tapping a patrol-timer notification) and toasts.
@Observable
final class AppRouter {
    static let shared = AppRouter()

    var selectedTab: AppTab = .dashboard
    /// When set, the Log Patrol screen opens for this property.
    var logPatrolPropertyId: String?
    var toast: Toast?

    func openLogPatrol(propertyId: String?) {
        guard let propertyId else { return }
        logPatrolPropertyId = propertyId
    }

    func show(_ message: String, detail: String? = nil, style: Toast.Style = .success) {
        toast = Toast(message: message, detail: detail, style: style)
    }
}
