import Foundation
import UserNotifications

/// Shows patrol-timer alerts while the app is open and routes taps to Log Patrol.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()
    static let categoryId = "PFW_PATROL_TIMER"
    static let logActionId = "PFW_LOG_PATROL"

    func register() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let log = UNNotificationAction(identifier: Self.logActionId, title: "Log Patrol", options: [.foreground])
        let category = UNNotificationCategory(identifier: Self.categoryId, actions: [log], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let propertyId = response.notification.request.content.userInfo["propertyId"] as? String
        await MainActor.run {
            AppRouter.shared.openLogPatrol(propertyId: propertyId)
        }
    }
}
