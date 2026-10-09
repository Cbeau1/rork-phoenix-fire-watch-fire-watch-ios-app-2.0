import SwiftUI

/// Expandable patrol row: status, time, officer, areas, notes and photo thumbnails.
struct PatrolRow: View {
    let patrol: Patrol
    var propertyName: String?
    var canDelete: Bool = false
    var onDelete: ((Patrol) -> Void)?

    @State private var expanded: Bool = false
    @State private var viewer: PhotoViewerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { expanded.toggle() }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(patrol.status.color.opacity(0.14)).frame(width: 36, height: 36)
                        Image(systemName: patrol.status.symbol)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(patrol.status.color)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(Fmt.time(patrol.dateTime))
                                .font(FWFont.mono(.subheadline, weight: .semibold))
                                .foregroundStyle(Color.fwInk)
                            Text("·").foregroundStyle(Color.fwInk3)
                            Text(patrol.status.label)
                                .font(.system(.subheadline, weight: .semibold))
                                .foregroundStyle(patrol.status.color)
                        }
                        if let propertyName {
                            Text(propertyName)
                                .font(.system(.subheadline, weight: .medium))
                                .foregroundStyle(Color.fwInk)
                                .lineLimit(1)
                        }
                        Text(patrol.areas.joined(separator: ", "))
                            .font(.footnote)
                            .foregroundStyle(Color.fwInk2)
                            .lineLimit(expanded ? nil : 1)
                        HStack(spacing: 10) {
                            Label(patrol.officerName, systemImage: "person.fill")
                            if patrol.photoCount > 0 {
                                Label("\(patrol.photoCount)", systemImage: "camera.fill")
                            }
                            if patrol.geofenceDistanceM != nil || patrol.location != nil {
                                Label("On site", systemImage: "checkmark.seal.fill")
                                    .foregroundStyle(Color.fwClear)
                            }
                            if !propertyNameIsShown {
                                Text(Fmt.day(patrol.dateTime))
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(Color.fwInk3)
                        .labelStyle(CompactLabelStyle())
                        if let state = patrol.syncState {
                            SyncBadge(state: state).padding(.top, 2)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.fwInk3)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .padding(.top, 10)
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                details.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .fullScreenCover(item: $viewer) { item in
            PhotoViewer(refs: patrol.photoRefs, start: item.index, title: "\(Fmt.dateTime(patrol.dateTime)) · \(patrol.status.label)")
        }
    }

    private var propertyNameIsShown: Bool { propertyName == nil }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !patrol.notes.isEmpty {
                Text(patrol.notes)
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.fwRaised, in: .rect(cornerRadius: 10))
            }
            if !patrol.photoRefs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(patrol.photoRefs.enumerated()), id: \.element) { index, ref in
                            Button {
                                viewer = PhotoViewerItem(index: index)
                            } label: {
                                PatrolPhotoView(ref: ref)
                                    .frame(width: 112, height: 112)
                                    .clipShape(.rect(cornerRadius: 10))
                                    .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Color.fwLine, lineWidth: 1) }
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("Photo \(index + 1)")
                        }
                    }
                }
            }
            if canDelete, let onDelete {
                Button(role: .destructive) {
                    onDelete(patrol)
                } label: {
                    Label("Delete patrol", systemImage: "trash")
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(Color.fwIncident)
                        .frame(minHeight: 36)
                }
            }
        }
        .padding(.leading, 48)
        .padding(.bottom, 12)
    }
}

struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 10))
            configuration.title
        }
    }
}

struct PhotoViewerItem: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Full-screen swipeable photo viewer.
struct PhotoViewer: View {
    let refs: [String]
    let start: Int
    let title: String

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int = 0

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(refs.enumerated()), id: \.element) { i, ref in
                    ZoomablePhoto(ref: ref).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: refs.count > 1 ? .always : .never))
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(.subheadline, weight: .semibold)).foregroundStyle(.white)
                    Text("Photo \(index + 1) of \(refs.count)").font(.caption).foregroundStyle(Color.fwInk2)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(.white.opacity(0.12), in: Circle())
                }
                .accessibilityLabel("Close photo")
            }
            .padding(16)
        }
        .onAppear { index = start }
    }
}

private struct ZoomablePhoto: View {
    let ref: String
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .gesture(
                        MagnifyGesture()
                            .onChanged { scale = max(1, min(4, $0.magnification)) }
                            .onEnded { _ in withAnimation(.spring) { scale = 1 } }
                    )
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: ref) { image = await PhotoLoader.shared.image(for: ref) }
    }
}
