import Foundation
import Network
import Observation

/// Tracks connectivity so changes can queue offline and upload on reconnect.
@Observable
final class NetworkMonitor {
    private(set) var isOnline: Bool = true
    @ObservationIgnored private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { @Sendable [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
            }
        }
        monitor.start(queue: DispatchQueue(label: "pfw.network"))
    }
}
