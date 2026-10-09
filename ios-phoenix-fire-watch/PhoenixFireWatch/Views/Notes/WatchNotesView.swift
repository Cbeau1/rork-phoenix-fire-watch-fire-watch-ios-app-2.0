import SwiftUI

struct WatchNotesView: View {
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var draft: String = ""
    @State private var posting: Bool = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    composer
                    HStack {
                        Text("Active Notes").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                        Text("\(store.notes.count)")
                            .font(FWFont.mono(.caption, weight: .bold))
                            .foregroundStyle(Color.fwEmber)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.fwEmber.opacity(0.12), in: Capsule())
                        Spacer()
                    }
                    if store.notes.isEmpty {
                        EmptyStateView(symbol: "note.text", title: "All caught up", message: "Notes you and your team post show up here until they're resolved.")
                            .fwCard()
                    }
                    ForEach(store.notes) { note in
                        noteCard(note)
                            .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .scale(scale: 0.9).combined(with: .opacity)))
                    }
                }
                .padding(16)
                .fwReadable()
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: store.notes.map(\.id))
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await store.refresh() }
            .background(CanvasBackground())
            .navigationTitle("Watch Notes")
            .fwNavigationChrome()
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "New shift note", color: .fwEmber)
            TextField("", text: $draft, prompt: Text("Share an update with your team…").foregroundStyle(Color.fwInk3), axis: .vertical)
                .focused($focused)
                .lineLimit(2...6)
                .foregroundStyle(Color.fwInk)
                .padding(14)
                .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(focused ? Color.fwEmber.opacity(0.6) : Color.fwLineStrong, lineWidth: 1) }
            Button {
                Task { await post() }
            } label: {
                if posting { ProgressView().tint(.white) } else { Label("Post Note", systemImage: "paperplane.fill") }
            }
            .buttonStyle(EmberButtonStyle())
            .disabled(draft.trimmed.isEmpty || posting)
        }
        .fwCard()
    }

    private func noteCard(_ note: WatchNote) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(note.content)
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                    .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLine, lineWidth: 1) }
                HStack(spacing: 6) {
                    Text(note.authorName).font(.system(.caption, weight: .semibold)).foregroundStyle(Color.fwInk2)
                    Text("· \(Fmt.relative(note.createdAt))").font(.caption).foregroundStyle(Color.fwInk3)
                }
                if store.isPending(noteId: note.id) { SyncBadge(state: .pending) }
            }
            Spacer(minLength: 0)
            Button {
                Task { await resolve(note) }
            } label: {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.fwClear)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Resolve note")
        }
        .fwCard(padding: 14)
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14).fill(Color.fwEmber).frame(width: 3)
        }
    }

    private func post() async {
        guard !draft.trimmed.isEmpty else { return }
        posting = true
        do {
            let result = try await store.addNote(draft)
            draft = ""
            focused = false
            router.show(result == .queued ? "Note saved on this device" : "Note posted", style: result == .queued ? .info : .success)
        } catch {
            router.show(ErrorText.from(error), style: .error)
        }
        posting = false
    }

    private func resolve(_ note: WatchNote) async {
        do {
            try await store.resolveNote(note.id)
            router.show("Note resolved")
        } catch {
            router.show(ErrorText.from(error), style: .error)
        }
    }
}

struct QuickNoteSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var draft: String = ""
    @State private var posting: Bool = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField("", text: $draft, prompt: Text("Share an update with your team…").foregroundStyle(Color.fwInk3), axis: .vertical)
                    .focused($focused)
                    .lineLimit(4...8)
                    .foregroundStyle(Color.fwInk)
                    .padding(14)
                    .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                Button {
                    Task {
                        posting = true
                        do {
                            let result = try await store.addNote(draft)
                            router.show(result == .queued ? "Note saved on this device" : "Note posted", style: result == .queued ? .info : .success)
                            dismiss()
                        } catch {
                            router.show(ErrorText.from(error), style: .error)
                        }
                        posting = false
                    }
                } label: {
                    if posting { ProgressView().tint(.white) } else { Text("Post Note") }
                }
                .buttonStyle(EmberButtonStyle())
                .disabled(draft.trimmed.isEmpty || posting)
                Spacer()
            }
            .padding(16)
            .background(Color.fwCanvas)
            .navigationTitle("Watch Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { focused = true }
        }
    }
}
