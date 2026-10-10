import Foundation
import SwiftUI
import Testing
import UIKit
@testable import PhoenixFireWatch

@MainActor
struct AppearancePreferenceTests {

    @Test func defaultsToSystemWhenNothingIsSaved() {
        let defaults = UserDefaults(suiteName: "appearance-test-\(UUID().uuidString)")!
        let saved = defaults.string(forKey: AppearancePreference.storageKey)
        #expect(saved == nil)
        #expect(AppearancePreference.from(saved ?? AppearancePreference.system.rawValue) == .system)
    }

    @Test func unknownStoredValueFallsBackToSystem() {
        #expect(AppearancePreference.from("sepia") == .system)
        #expect(AppearancePreference.from("") == .system)
    }

    @Test func savedChoiceSurvivesARelaunch() {
        let suite = "appearance-test-\(UUID().uuidString)"
        let first = UserDefaults(suiteName: suite)!
        first.set(AppearancePreference.dark.rawValue, forKey: AppearancePreference.storageKey)

        // A fresh defaults instance reads what a restarted app would see.
        let relaunched = UserDefaults(suiteName: suite)!
        let raw = relaunched.string(forKey: AppearancePreference.storageKey) ?? AppearancePreference.system.rawValue
        #expect(AppearancePreference.from(raw) == .dark)

        relaunched.set(AppearancePreference.light.rawValue, forKey: AppearancePreference.storageKey)
        #expect(AppearancePreference.from(first.string(forKey: AppearancePreference.storageKey) ?? "") == .light)
        UserDefaults().removePersistentDomain(forName: suite)
    }

    @Test func systemHandsControlBackToTheDevice() {
        #expect(AppearancePreference.system.colorScheme == nil)
        #expect(AppearancePreference.system.interfaceStyle == .unspecified)
        #expect(AppearancePreference.light.colorScheme == .light)
        #expect(AppearancePreference.light.interfaceStyle == .light)
        #expect(AppearancePreference.dark.colorScheme == .dark)
        #expect(AppearancePreference.dark.interfaceStyle == .dark)
    }

    @Test func themeTokensResolveToTheSpecifiedHexPerAppearance() {
        let light = UITraitCollection(userInterfaceStyle: .light)
        let dark = UITraitCollection(userInterfaceStyle: .dark)
        func hex(_ color: Color, _ traits: UITraitCollection) -> UInt32 {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            UIColor(color).resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
            return (UInt32((r * 255).rounded()) << 16) | (UInt32((g * 255).rounded()) << 8) | UInt32((b * 255).rounded())
        }
        #expect(hex(.fwCanvas, light) == 0xF1F5F9)
        #expect(hex(.fwSurface, light) == 0xFFFFFF)
        #expect(hex(.fwLine, light) == 0xE2E8F0)
        #expect(hex(.fwInk, light) == 0x0F172A)
        #expect(hex(.fwInk2, light) == 0x475569)
        #expect(hex(.fwLink, light) == 0x1D4ED8)
        #expect(hex(.fwPrimary, light) == 0x2563EB)
        #expect(hex(.fwPrimaryPressed, light) == 0x1D4ED8)

        #expect(hex(.fwCanvas, dark) == 0x0F172A)
        #expect(hex(.fwSurface, dark) == 0x1E293B)
        #expect(hex(.fwLine, dark) == 0x334155)
        #expect(hex(.fwInk, dark) == 0xF8FAFC)
        #expect(hex(.fwLink, dark) == 0x60A5FA)
        #expect(hex(.fwPrimary, dark) == 0x2563EB)
    }
}
