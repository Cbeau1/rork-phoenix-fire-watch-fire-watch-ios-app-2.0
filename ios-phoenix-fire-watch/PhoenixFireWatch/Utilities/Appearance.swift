import SwiftUI
import UIKit

/// Settings → Appearance choice. Stored in UserDefaults (`@AppStorage(AppearancePreference.storageKey)`);
/// defaults to System so the app follows the device until the user picks Light or Dark.
nonisolated enum AppearancePreference: String, CaseIterable, Identifiable, Sendable {
    case light
    case dark
    case system

    static let storageKey: String = "pfw-appearance"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .light: "Light"
        case .dark: "Dark"
        case .system: "System"
        }
    }

    var hint: String {
        switch self {
        case .light: "Bright, for daylight"
        case .dark: "Navy, for night shifts"
        case .system: "Match this device"
        }
    }

    var symbol: String {
        switch self {
        case .light: "sun.max.fill"
        case .dark: "moon.fill"
        case .system: "iphone"
        }
    }

    /// For `.preferredColorScheme` — `nil` means follow the device.
    var colorScheme: ColorScheme? {
        switch self {
        case .light: .light
        case .dark: .dark
        case .system: nil
        }
    }

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .light: .light
        case .dark: .dark
        case .system: .unspecified
        }
    }

    static func from(_ raw: String) -> AppearancePreference {
        AppearancePreference(rawValue: raw) ?? .system
    }
}

enum AppearanceController {
    /// Applies the style to every window (sheets, alerts and the status bar inherit it). Setting
    /// `.unspecified` hands control back to the device so System reacts to appearance changes live.
    static func apply(_ preference: AppearancePreference) {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = preference.interfaceStyle
            }
        }
    }
}
