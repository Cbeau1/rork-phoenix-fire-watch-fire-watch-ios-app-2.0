import Foundation

/// Small JSON file cache in Application Support (device copy used to work offline).
nonisolated enum LocalStore {
    static var baseURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = root.appendingPathComponent("PhoenixFireWatch", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func save<T: Encodable>(_ value: T, as name: String) {
        do {
            let data = try JSONEncoder().encode(value)
            try data.write(to: baseURL.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            print("[LocalStore] save failed for \(name): \(error.localizedDescription)")
        }
    }

    static func load<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        guard let data = try? Data(contentsOf: baseURL.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func remove(_ name: String) {
        try? FileManager.default.removeItem(at: baseURL.appendingPathComponent(name))
    }

    static func removeAll(withPrefix prefix: String) {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: baseURL.path)) ?? []
        for file in files where file.hasPrefix(prefix) { remove(file) }
    }
}

/// Patrol photos captured on this device and waiting to upload.
nonisolated enum PhotoStore {
    static var directory: URL {
        let dir = LocalStore.baseURL.appendingPathComponent("pending-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func save(_ data: Data) throws -> String {
        let name = "\(IDs.make()).jpg"
        try data.write(to: directory.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return name
    }

    static func data(for name: String) -> Data? {
        try? Data(contentsOf: directory.appendingPathComponent(name))
    }

    static func delete(_ names: [String]) {
        for name in names { try? FileManager.default.removeItem(at: directory.appendingPathComponent(name)) }
    }
}
