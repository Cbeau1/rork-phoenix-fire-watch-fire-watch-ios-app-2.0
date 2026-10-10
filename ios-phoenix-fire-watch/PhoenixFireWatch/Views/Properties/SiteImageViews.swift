import PhotosUI
import SwiftUI
import UIKit

/// Square site thumbnail for lists; shows the building glyph until (or unless) a site photo loads.
struct SiteThumbView: View {
    let imagePath: String?
    var size: CGFloat = 48
    var tint: Color = .fwEmber

    @State private var image: UIImage?

    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(tint.opacity(0.12))
            .frame(width: size, height: size)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .allowsHitTesting(false)
                        .transition(.opacity)
                } else {
                    Image(systemName: "building.2.fill")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(tint)
                }
            }
            .clipShape(.rect(cornerRadius: 12))
            .task(id: imagePath) {
                guard let imagePath else {
                    image = nil
                    return
                }
                let loaded = await PhotoLoader.shared.image(for: imagePath)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            }
    }
}

/// Site photo banner on Property Detail with add / change / remove.
struct SiteImageSection: View {
    let property: Property

    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var pickerItem: PhotosPickerItem?
    @State private var isPicking: Bool = false
    @State private var isBusy: Bool = false
    @State private var confirmRemove: Bool = false
    @State private var image: UIImage?

    private var isPending: Bool { store.isPending(propertyId: property.id) }

    var body: some View {
        Group {
            if property.imagePath == nil {
                emptyCard
            } else {
                banner
            }
        }
        .photosPicker(isPresented: $isPicking, selection: $pickerItem, matching: .images, preferredItemEncoding: .compatible)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            pickerItem = nil
            Task { await upload(item) }
        }
        .confirmationDialog("Remove the site photo?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Photo", role: .destructive) { Task { await remove() } }
        } message: {
            Text("It will be removed for your whole team.")
        }
        .task(id: property.imagePath) {
            guard let path = property.imagePath else {
                image = nil
                return
            }
            let loaded = await PhotoLoader.shared.image(for: path)
            withAnimation(.easeOut(duration: 0.3)) { image = loaded }
        }
    }

    private var emptyCard: some View {
        Button(action: pick) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Color.fwRaised).frame(width: 52, height: 52)
                    if isBusy {
                        ProgressView().tint(Color.fwEmber)
                    } else {
                        Image(systemName: "photo.badge.plus").font(.system(size: 22, weight: .semibold)).foregroundStyle(Color.fwEmber)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(isBusy ? "Uploading photo…" : "Add a site photo")
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.fwInk)
                    Text("Helps officers recognize the building at a glance.")
                        .font(.footnote)
                        .foregroundStyle(Color.fwInk2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.fwInk3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.fwSurface.opacity(0.6), in: .rect(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).strokeBorder(Color.fwLine, style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
            }
        }
        .buttonStyle(PressableStyle())
        .disabled(isBusy)
    }

    private var banner: some View {
        Color.fwRaised
            .frame(height: 210)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .allowsHitTesting(false)
                        .transition(.opacity)
                } else {
                    Image(systemName: "building.2.fill").font(.system(size: 40)).foregroundStyle(Color.fwLine)
                }
            }
            .overlay {
                LinearGradient(colors: [.clear, Color.fwCanvas.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                    .allowsHitTesting(false)
            }
            .clipShape(.rect(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(Color.fwLine, lineWidth: 1) }
            .overlay {
                if isBusy {
                    ZStack {
                        Color.fwCanvas.opacity(0.55)
                        ProgressView().tint(Color.fwInk)
                    }
                    .clipShape(.rect(cornerRadius: 16))
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Menu {
                    Button(action: pick) { Label("Change Photo", systemImage: "photo.on.rectangle") }
                    Button(role: .destructive) { confirmRemove = true } label: { Label("Remove Photo", systemImage: "trash") }
                } label: {
                    Label("Photo", systemImage: "camera.fill")
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.fwInk)
                        .padding(.horizontal, 14)
                        .frame(height: 44)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay { Capsule().strokeBorder(Color.fwLine.opacity(0.7), lineWidth: 1) }
                }
                .disabled(isBusy)
                .padding(12)
                .accessibilityLabel("Site photo options")
            }
    }

    private func pick() {
        guard !isPending else {
            router.show("This property hasn't uploaded yet", detail: "Add a photo once it has synced.", style: .error)
            return
        }
        isPicking = true
    }

    private func upload(_ item: PhotosPickerItem) async {
        isBusy = true
        defer { isBusy = false }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self),
                  let jpeg = SiteImageProcessing.jpeg(from: raw) else {
                router.show("Couldn't read that photo", detail: "Try a different image.", style: .error)
                return
            }
            let hadImage = property.imagePath != nil
            try await store.setPropertyImage(propertyId: property.id, jpeg: jpeg)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            router.show(hadImage ? "Site photo updated" : "Site photo added")
        } catch {
            router.show("Couldn't save the site photo", detail: error.localizedDescription, style: .error)
        }
    }

    private func remove() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await store.setPropertyImage(propertyId: property.id, jpeg: nil)
            router.show("Site photo removed")
        } catch {
            router.show("Couldn't remove the site photo", detail: error.localizedDescription, style: .error)
        }
    }
}

/// Downscales picked photos so site images upload quickly.
enum SiteImageProcessing {
    static func jpeg(from data: Data, maxSide: CGFloat = 1600, quality: CGFloat = 0.82) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = min(1, maxSide / max(longest, 1))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}
