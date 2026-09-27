import AVFoundation
import SwiftUI

/// Full-screen live viewfinder. Photos are time-stamped and can't come from the library.
struct CameraCaptureView: View {
    let remaining: Int
    let stampLines: [String]
    let onCapture: (Data) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var camera = CameraSession()
    @State private var state: CameraState = .starting
    @State private var position: AVCaptureDevice.Position = .back
    @State private var flash: Bool = false
    @State private var lastShot: UIImage?
    @State private var capturing: Bool = false
    @State private var shots: Int = 0

    enum CameraState { case starting, live, denied, unavailable }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if state == .live {
                CameraPreview(session: camera.session)
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
            Color.white.opacity(flash ? 0.8 : 0).ignoresSafeArea().allowsHitTesting(false)

            if state != .live {
                placeholder
            }

            VStack {
                HStack {
                    HStack(spacing: 7) {
                        Circle().fill(state == .live ? Color.fwIncident : Color.fwInk3).frame(width: 8, height: 8)
                        Text(state == .live ? "LIVE · photos are time-stamped" : "Camera")
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.black.opacity(0.5), in: Capsule())
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.black.opacity(0.5), in: Circle())
                    }
                    .accessibilityLabel("Close camera")
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                Spacer()
                controls
            }
        }
        .statusBarHidden()
        .task { await start() }
        .onDisappear { camera.stop() }
        .sensoryFeedback(.impact(weight: .heavy), trigger: shots)
    }

    private var controls: some View {
        HStack {
            Group {
                if let lastShot {
                    Image(uiImage: lastShot)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: 10))
                        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.3), lineWidth: 1) }
                        .transition(.scale.combined(with: .opacity))
                } else {
                    RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.2), lineWidth: 1).frame(width: 56, height: 56)
                }
            }
            .frame(width: 70)
            Spacer()
            Button {
                Task { await shoot() }
            } label: {
                ZStack {
                    Circle().strokeBorder(.white.opacity(0.9), lineWidth: 4).frame(width: 78, height: 78)
                    Circle().fill(Color.fwEmber).frame(width: 60, height: 60)
                    Image(systemName: "camera.aperture").font(.system(size: 24, weight: .semibold)).foregroundStyle(.white)
                }
            }
            .buttonStyle(PressableStyle())
            .disabled(state != .live || remaining - shots <= 0 || capturing)
            .opacity(state == .live && remaining - shots > 0 ? 1 : 0.4)
            .accessibilityLabel("Take photo")
            Spacer()
            VStack(spacing: 6) {
                if CameraSession.canSwitch {
                    Button {
                        position = position == .back ? .front : .back
                        Task { _ = await camera.start(position: position) }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath.camera")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .background(.white.opacity(0.12), in: Circle())
                    }
                    .accessibilityLabel("Switch camera")
                }
                Text("\(max(0, remaining - shots)) left")
                    .font(FWFont.mono(.caption2))
                    .foregroundStyle(Color.fwInk2)
            }
            .frame(width: 70)
        }
        .padding(.horizontal, 24)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .background(.black.opacity(0.55))
    }

    @ViewBuilder
    private var placeholder: some View {
        if state == .starting {
            ProgressView().tint(Color.fwEmber).controlSize(.large)
        } else {
            VStack(spacing: 14) {
                Image(systemName: "video.slash.fill").font(.system(size: 40)).foregroundStyle(Color.fwInk2)
                Text(state == .denied ? "Camera access is off" : "No camera found")
                    .font(.system(.title3, weight: .bold))
                    .foregroundStyle(.white)
                Text(state == .denied
                     ? "Allow camera access in Settings to attach live patrol photos."
                     : "Patrol photos must be taken live with a camera on this device.")
                    .font(.subheadline)
                    .foregroundStyle(Color.fwInk2)
                    .multilineTextAlignment(.center)
                if state == .denied {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .buttonStyle(EmberButtonStyle(fullWidth: false))
                    .padding(.top, 6)
                }
            }
            .padding(32)
        }
    }

    private func start() async {
        var status = CameraSession.authorization
        if status == .notDetermined {
            status = await CameraSession.requestAccess() ? .authorized : .denied
        }
        guard status == .authorized else {
            state = .denied
            return
        }
        let ok = await camera.start(position: position)
        withAnimation(.easeOut(duration: 0.25)) { state = ok ? .live : .unavailable }
    }

    private func shoot() async {
        guard !capturing else { return }
        capturing = true
        withAnimation(.easeOut(duration: 0.08)) { flash = true }
        let raw = await camera.capture()
        withAnimation(.easeIn(duration: 0.25)) { flash = false }
        if let raw, let stamped = PhotoStamper.stamp(raw, lines: stampLines) {
            shots += 1
            onCapture(stamped)
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) { lastShot = UIImage(data: stamped) }
        }
        capturing = false
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer? { layer as? AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.backgroundColor = .black
        view.previewLayer?.session = session
        view.previewLayer?.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}
