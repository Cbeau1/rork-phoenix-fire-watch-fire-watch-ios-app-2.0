import UIKit
import XCTest

/// Launches the app under each appearance and checks the rendered canvas color by sampling
/// the screenshot (bottom-left corner, away from content and the glow).
final class AppearanceUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.appearance = .light
    }

    @MainActor
    func testSavedLightOverridesDarkDevice() throws {
        XCUIDevice.shared.appearance = .dark
        let app = launch(preference: "light")
        let luminance = canvasLuminance(app, name: "light-on-dark-device")
        XCTAssertGreaterThan(luminance, 0.85, "Light preference should render the #F1F5F9 canvas")
    }

    @MainActor
    func testSavedDarkOverridesLightDevice() throws {
        XCUIDevice.shared.appearance = .light
        let app = launch(preference: "dark")
        let luminance = canvasLuminance(app, name: "dark-on-light-device")
        XCTAssertLessThan(luminance, 0.15, "Dark preference should render the #0F172A canvas")
    }

    @MainActor
    func testSystemMatchesDarkDeviceAtLaunch() throws {
        try setDeviceAppearance(.dark)
        let app = launch(preference: "system")
        let luminance = canvasLuminance(app, name: "system-dark-at-launch")
        XCTAssertLessThan(luminance, 0.15, "System on a dark device should render the #0F172A canvas")
    }

    @MainActor
    func testSystemFollowsDeviceAfterReturningToApp() throws {
        XCUIDevice.shared.appearance = .light
        let app = launch(preference: "system")
        XCTAssertGreaterThan(canvasLuminance(app, name: "system-light-before-switch"), 0.85)

        XCUIDevice.shared.press(.home)
        try setDeviceAppearance(.dark)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        var after = canvasLuminance(app, name: nil)
        let deadline = Date().addingTimeInterval(5)
        while after >= 0.15, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
            after = canvasLuminance(app, name: nil)
        }
        _ = canvasLuminance(app, name: "system-dark-after-switch")
        XCTAssertLessThan(after, 0.15, "System should pick up the device's new appearance without a relaunch")
    }

    @MainActor
    func testSystemFollowsDeviceAppearanceLive() throws {
        XCUIDevice.shared.appearance = .light
        let app = launch(preference: "system")
        let before = canvasLuminance(app, name: "system-light")
        XCTAssertGreaterThan(before, 0.85)

        try setDeviceAppearance(.dark)
        var after = canvasLuminance(app, name: nil)
        let deadline = Date().addingTimeInterval(5)
        while after >= 0.15, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
            after = canvasLuminance(app, name: nil)
            print("[AppearanceUITests] live luminance \(after)")
        }
        _ = canvasLuminance(app, name: "system-dark")
        XCTAssertLessThan(after, 0.15, "System should follow the device to the #0F172A canvas without a relaunch")
    }

    // MARK: - Helpers

    /// Flips the simulator's appearance; skips when the simulator ignores the request, since the
    /// System assertions would then measure the runner rather than the app.
    @MainActor
    private func setDeviceAppearance(_ appearance: XCUIDevice.Appearance) throws {
        XCUIDevice.shared.appearance = appearance
        Thread.sleep(forTimeInterval: 1)
        let expected: UIUserInterfaceStyle = appearance == .dark ? .dark : .light
        let runnerStyle = UIScreen.main.traitCollection.userInterfaceStyle
        try XCTSkipUnless(
            XCUIDevice.shared.appearance == appearance && runnerStyle == expected,
            "Simulator didn't apply the device appearance change (reported \(XCUIDevice.shared.appearance.rawValue), trait \(runnerStyle.rawValue))"
        )
    }

    @MainActor
    private func launch(preference: String) -> XCUIApplication {
        let app = XCUIApplication()
        // Argument-domain value is what @AppStorage("pfw-appearance") reads at launch.
        app.launchArguments += ["-pfw-appearance", preference]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        // Splash → sign-in (or the main app if a session exists); give the first screen time to settle.
        _ = app.staticTexts["Welcome back"].waitForExistence(timeout: 12)
        return app
    }

    @MainActor
    private func canvasLuminance(_ app: XCUIApplication, name: String?) -> Double {
        let shot = app.screenshot()
        if let name {
            let attachment = XCTAttachment(screenshot: shot)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        guard let cg = shot.image.cgImage else { return -1 }
        let x = 6
        let y = Int(Double(cg.height) * 0.97)
        var pixel: [UInt8] = [0, 0, 0, 0]
        guard let ctx = CGContext(
            data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return -1 }
        ctx.draw(cg, in: CGRect(x: -x, y: -(cg.height - 1 - y), width: cg.width, height: cg.height))
        return (0.2126 * Double(pixel[0]) + 0.7152 * Double(pixel[1]) + 0.0722 * Double(pixel[2])) / 255
    }
}
