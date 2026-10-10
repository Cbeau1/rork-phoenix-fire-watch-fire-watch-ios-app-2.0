import CoreLocation
import Observation

/// Live "when in use" device location for geofence checks and the geofence editor.
@Observable
final class LocationService: NSObject, CLLocationManagerDelegate {
    enum Status: Equatable {
        case idle
        case locating
        case ready
        case denied
        case unavailable(String)
    }

    private(set) var status: Status = .idle
    private(set) var fix: PatrolLocation?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var wantsUpdates: Bool = false
    @ObservationIgnored private var oneShot: [CheckedContinuation<PatrolLocation, Error>] = []
    @ObservationIgnored private var timeoutTask: Task<Void, Never>?

    /// How long to wait for a first fix before telling the user we can't find them.
    private let fixTimeout: Duration = .seconds(15)

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
    }

    /// Starts continuous updates, asking for permission the first time.
    func start() {
        wantsUpdates = true
        switch manager.authorizationStatus {
        case .notDetermined:
            status = .locating
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            status = .denied
        default:
            if fix == nil { status = .locating }
            manager.startUpdatingLocation()
            armTimeout()
        }
    }

    func stop() {
        wantsUpdates = false
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingLocation()
    }

    /// Fails the "checking" state if no fix arrives in time; updates keep running so a late fix still lands.
    private func armTimeout() {
        timeoutTask?.cancel()
        guard fix == nil else { return }
        timeoutTask = Task { [weak self, fixTimeout] in
            try? await Task.sleep(for: fixTimeout)
            guard !Task.isCancelled, let self, self.fix == nil, self.status == .locating else { return }
            self.status = .unavailable("We couldn't find your location. Check that Location Services is on, move near a window or outside, then tap Retry.")
            self.finishOneShot(.failure(AppError("Couldn't get your location. Try again in a moment.")))
        }
    }

    func restart() {
        stop()
        fix = nil
        start()
    }

    /// One position fix (used by "Use my location").
    func currentLocation() async throws -> PatrolLocation {
        if let fix, status == .ready { return fix }
        return try await withCheckedThrowingContinuation { cont in
            oneShot.append(cont)
            start()
            if status == .denied { finishOneShot(.failure(AppError("Location access is off. Turn it on in Settings."))) }
        }
    }

    private func finishOneShot(_ result: Result<PatrolLocation, Error>) {
        let waiting = oneShot
        oneShot = []
        waiting.forEach { $0.resume(with: result) }
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let auth = manager.authorizationStatus
        Task { @MainActor in self.handleAuthorization(auth) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0 else { return }
        let next = PatrolLocation(lat: last.coordinate.latitude, lng: last.coordinate.longitude, accuracyM: last.horizontalAccuracy)
        Task { @MainActor in self.handleFix(next) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        Task { @MainActor in self.handleFailure(code) }
    }

    private func handleAuthorization(_ auth: CLAuthorizationStatus) {
        switch auth {
        case .denied, .restricted:
            status = .denied
            finishOneShot(.failure(AppError("Location access is off. Turn it on in Settings.")))
        case .authorizedWhenInUse, .authorizedAlways:
            if wantsUpdates {
                if fix == nil { status = .locating }
                manager.startUpdatingLocation()
                armTimeout()
            }
        default:
            break
        }
    }

    private func handleFix(_ next: PatrolLocation) {
        timeoutTask?.cancel()
        timeoutTask = nil
        fix = next
        status = .ready
        finishOneShot(.success(next))
    }

    private func handleFailure(_ code: CLError.Code?) {
        if code == .denied {
            status = .denied
            finishOneShot(.failure(AppError("Location access is off. Turn it on in Settings.")))
            return
        }
        if code == .locationUnknown { return }
        if fix == nil {
            status = .unavailable("Your location isn't available right now. Move near a window or outside and retry.")
            finishOneShot(.failure(AppError("Couldn't get your location.")))
        }
    }
}
