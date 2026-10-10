import PDFKit
import SwiftUI
import UIKit

/// The bundled New Employee Field Guide PDF.
enum FieldGuide {
    static let title = "New Employee Field Guide"
    static var url: URL? { Bundle.main.url(forResource: "FieldGuide", withExtension: "pdf") }

    /// First-page thumbnail rendered from the PDF.
    static func thumbnail(width: CGFloat) -> UIImage? {
        guard let url, let page = PDFDocument(url: url)?.page(at: 0) else { return nil }
        let bounds = page.bounds(for: .mediaBox)
        let scale = UIScreen.main.scale
        let size = CGSize(width: width * scale, height: width * scale * bounds.height / max(bounds.width, 1))
        return page.thumbnail(of: size, for: .mediaBox)
    }
}

/// Paper-on-dark PDF reader for the guide.
private struct FieldGuidePDFView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = UIColor(red: 0x23 / 255, green: 0x27 / 255, blue: 0x2D / 255, alpha: 1)
        view.pageShadowsEnabled = true
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ uiView: PDFView, context: Context) {}
}

private struct FieldGuideReader: View {
    var body: some View {
        if let url = FieldGuide.url {
            FieldGuidePDFView(url: url)
        } else {
            EmptyStateView(symbol: "doc.questionmark", title: "Guide unavailable", message: "The field guide couldn't be opened. Please update the app.")
        }
    }
}

/// Required once for officers: read the guide and acknowledge it before entering the app.
struct FieldGuideGateView: View {
    @Environment(AuthStore.self) private var auth
    @State private var agreed: Bool = false
    @State private var isBusy: Bool = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            FieldGuideReader()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            footer
        }
        .background(Color.fwCanvas.ignoresSafeArea())
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                CrestView(size: 34, glow: false)
                Spacer()
                Button("Sign Out") { Task { await auth.signOut() } }
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk3)
                    .frame(minHeight: 44)
            }
            Text("REQUIRED BEFORE YOUR FIRST SHIFT")
                .font(.system(size: 11, weight: .semibold))
                .kerning(1.6)
                .foregroundStyle(Color.fwEmber)
            Text(auth.user.map { "\($0.name.split(separator: " ").first.map(String.init) ?? $0.name), read your field guide" } ?? "Read your field guide")
                .font(FWFont.display(.title2))
                .foregroundStyle(Color.fwInk)
            Text("Read it all the way through, then acknowledge it to continue.")
                .font(.subheadline)
                .foregroundStyle(Color.fwInk2)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 14)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error { ErrorBanner(message: error) }
            Toggle(isOn: $agreed) {
                Text("I have read and understand the \(FieldGuide.title) and will follow it on every shift.")
                    .font(.footnote)
                    .foregroundStyle(Color.fwInk)
            }
            .toggleStyle(CheckboxToggleStyle())
            Button {
                Task { await acknowledge() }
            } label: {
                if isBusy {
                    ProgressView().tint(.white)
                } else {
                    Label("Acknowledge & Continue", systemImage: "checkmark.seal.fill")
                }
            }
            .buttonStyle(EmberButtonStyle())
            .disabled(!agreed || isBusy)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
        .background(Color.fwCanvas)
        .overlay(alignment: .top) { Rectangle().fill(Color.fwLine).frame(height: 1) }
    }

    private func acknowledge() async {
        isBusy = true
        error = nil
        do {
            try await auth.acknowledgeFieldGuide()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

/// Dashboard card so officers can re-read the guide any time.
struct FieldGuideCardView: View {
    let acknowledgedAt: String?

    @State private var isReading: Bool = false
    @State private var thumbnail: UIImage?

    var body: some View {
        Button {
            isReading = true
        } label: {
            HStack(spacing: 16) {
                Group {
                    if let thumbnail {
                        Image(uiImage: thumbnail).resizable().aspectRatio(contentMode: .fit)
                    } else {
                        Color.white
                    }
                }
                .frame(width: 66, height: 85)
                .clipShape(.rect(cornerRadius: 4))
                .shadow(color: .black.opacity(0.35), radius: 8, y: 4)
                .rotationEffect(.degrees(-2))

                VStack(alignment: .leading, spacing: 4) {
                    Text("TRAINING")
                        .font(.system(size: 11, weight: .semibold))
                        .kerning(1.6)
                        .foregroundStyle(Color.fwEmber)
                    Text(FieldGuide.title)
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.fwInk)
                    Text("How to perform a fire watch and what to do if you find fire or smoke.")
                        .font(.footnote)
                        .foregroundStyle(Color.fwInk2)
                        .multilineTextAlignment(.leading)
                    if let date = acknowledgedAt.flatMap(DateParser.parse) {
                        Label("Acknowledged \(date.formatted(date: .abbreviated, time: .omitted))", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk3)
                            .labelStyle(TintedIconLabelStyle(tint: .fwClear))
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.fwInk3)
            }
            .fwCard(padding: 16)
        }
        .buttonStyle(PressableStyle())
        .accessibilityHint("Opens the field guide")
        .task { if thumbnail == nil { thumbnail = FieldGuide.thumbnail(width: 66) } }
        .fullScreenCover(isPresented: $isReading) {
            FieldGuideSheet()
        }
    }
}

private struct TintedIconLabelStyle: LabelStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.foregroundStyle(tint)
            configuration.title
        }
    }
}

private struct FieldGuideSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            FieldGuideReader()
                .ignoresSafeArea(edges: .bottom)
                .background(Color.fwCanvas)
                .navigationTitle("Field Guide")
                .navigationBarTitleDisplayMode(.inline)
                .fwNavigationChrome()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    if let url = FieldGuide.url {
                        ToolbarItem(placement: .primaryAction) {
                            ShareLink(item: url, subject: Text("Phoenix Fire Watch — \(FieldGuide.title)")) {
                                Label("Share", systemImage: "square.and.arrow.up")
                            }
                        }
                    }
                }
        }
    }
}
