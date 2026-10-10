import PDFKit
import SwiftUI

/// In-app PDF viewer for a shift report with share / email actions.
struct ReportPreviewView: View {
    let request: ReportRequest

    @Environment(\.dismiss) private var dismiss
    @State private var fileURL: URL?
    @State private var pageCount: Int = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color.fwCanvasDeep.ignoresSafeArea()
                if let fileURL {
                    PDFKitView(url: fileURL)
                        .ignoresSafeArea(edges: .bottom)
                        .transition(.opacity)
                } else {
                    VStack(spacing: 14) {
                        ProgressView().tint(Color.fwLink).controlSize(.large)
                        Text("Preparing report with photos…").font(.subheadline).foregroundStyle(Color.fwInk2)
                    }
                }
            }
            .navigationTitle(request.session.title)
            .navigationBarTitleDisplayMode(.inline)
            .fwNavigationChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    if let fileURL {
                        ShareLink(item: fileURL, subject: Text("Fire Watch Report — \(request.property.name)"), message: Text("Fire watch shift report for \(request.property.name), \(request.session.range).")) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
            .task { await build() }
        }
    }

    private func build() async {
        let data = await ReportBuilder.build(request)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(request.fileName)
        do {
            try data.write(to: url, options: .atomic)
            withAnimation { fileURL = url }
        } catch {
            print("[Report] write failed: \(error.localizedDescription)")
        }
    }
}

struct PDFKitView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = UIColor(Color.fwCanvasDeep)
        view.pageShadowsEnabled = true
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        if uiView.document?.documentURL != url { uiView.document = PDFDocument(url: url) }
    }
}
