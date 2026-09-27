import Supabase
import UIKit

/// Loads patrol photos from the private bucket (or this device for unsynced patrols),
/// with memory + disk caching. Local refs are prefixed with `local:`.
final class PhotoLoader {
    static let shared = PhotoLoader()

    private let memory = NSCache<NSString, UIImage>()
    private var inflight: [String: Task<Data?, Never>] = [:]

    private var diskDirectory: URL {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = root.appendingPathComponent("patrol-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func diskURL(for ref: String) -> URL {
        diskDirectory.appendingPathComponent(ref.replacingOccurrences(of: "/", with: "_"))
    }

    func data(for ref: String) async -> Data? {
        if ref.hasPrefix("local:") {
            return PhotoStore.data(for: String(ref.dropFirst(6)))
        }
        let disk = diskURL(for: ref)
        if let cached = try? Data(contentsOf: disk) { return cached }
        if let running = inflight[ref] { return await running.value }
        let task = Task<Data?, Never> {
            do {
                return try await Backend.client.storage.from(Backend.photoBucket).download(path: ref)
            } catch {
                print("[Photos] download failed: \(error.localizedDescription)")
                return nil
            }
        }
        inflight[ref] = task
        let result = await task.value
        inflight[ref] = nil
        if let result { try? result.write(to: disk, options: .atomic) }
        return result
    }

    func image(for ref: String) async -> UIImage? {
        if let hit = memory.object(forKey: ref as NSString) { return hit }
        guard let data = await data(for: ref), let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: ref as NSString)
        return image
    }

    func clearDisk() {
        try? FileManager.default.removeItem(at: diskDirectory)
        memory.removeAllObjects()
    }
}
