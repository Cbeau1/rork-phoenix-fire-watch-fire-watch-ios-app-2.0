import Foundation

/// Shift note shared across the organization. Mirrors `watch_notes`.
nonisolated struct WatchNote: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let content: String
    let authorName: String
    let authorId: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, content
        case authorName = "author_name"
        case authorId = "author_id"
        case createdAt = "created_at"
    }

    init(id: String, content: String, authorName: String, authorId: String?, createdAt: Date) {
        self.id = id
        self.content = content
        self.authorName = authorName
        self.authorId = authorId
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        authorName = (try? c.decode(String.self, forKey: .authorName)) ?? "Officer"
        authorId = try? c.decodeIfPresent(String.self, forKey: .authorId)
        createdAt = (try? c.decodeDate(forKey: .createdAt)) ?? Date()
    }
}

nonisolated struct WatchNoteInsert: Encodable, Sendable {
    let id: String
    let content: String
    let authorName: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, content
        case authorName = "author_name"
        case createdAt = "created_at"
    }
}
