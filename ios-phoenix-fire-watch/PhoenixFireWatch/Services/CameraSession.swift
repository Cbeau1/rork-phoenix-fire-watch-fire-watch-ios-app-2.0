import AVFoundation
import UIKit

/// Live camera for patrol photos (AVCapturePhotoOutput). All session work runs on a private queue.
nonisolated final class CameraSession: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "pfw.camera")
    private var input: AVCaptureDeviceInput?
    private var continuation: CheckedContinuation<Data?, Never>?
    private(set) var isExternal: Bool = false

    static var authorization: AVAuthorizationStatus { AVCaptureDevice.authorizationStatus(for: .video) }

    static func requestAccess() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .video)
    }

    private static func devices() -> [AVCaptureDevice] {
        let types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .builtInDualCamera, .builtInTripleCamera, .external]
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }

    static var canSwitch: Bool {
        let positions = Set(devices().map(\.position.rawValue))
        return positions.count > 1
    }

    /// Starts the session with the requested camera. Returns false when no camera is available.
    func start(position: AVCaptureDevice.Position) async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            queue.async {
                cont.resume(returning: self.configure(position: position))
            }
        }
    }

    private func configure(position: AVCaptureDevice.Position) -> Bool {
        let all = Self.devices()
        guard let device = all.first(where: { $0.position == position }) ?? all.first,
              let newInput = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        if session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }
        if let input { session.removeInput(input) }
        guard session.canAddInput(newInput) else {
            session.commitConfiguration()
            return false
        }
        session.addInput(newInput)
        input = newInput
        isExternal = device.deviceType == .external
        if !session.outputs.contains(output), session.canAddOutput(output) {
            session.addOutput(output)
        }
        session.commitConfiguration()
        if !session.isRunning { session.startRunning() }
        return true
    }

    func capture() async -> Data? {
        await withCheckedContinuation { (cont: CheckedContinuation<Data?, Never>) in
            queue.async {
                guard self.session.isRunning, self.continuation == nil else {
                    cont.resume(returning: nil)
                    return
                }
                self.continuation = cont
                if !self.isExternal, let connection = self.output.connection(with: .video),
                   connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
                self.output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
            }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error { print("[Camera] capture failed: \(error.localizedDescription)") }
        let data = photo.fileDataRepresentation()
        queue.async {
            self.continuation?.resume(returning: data)
            self.continuation = nil
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }
}

/// Burns a time / property / officer stamp into a photo and compresses it.
enum PhotoStamper {
    static func stamp(_ data: Data, lines: [String], date: Date = Date()) -> Data? {
        guard let source = UIImage(data: data) else { return nil }
        let maxSide: CGFloat = 1600
        let scale = min(1, maxSide / max(source.size.width, source.size.height))
        let size = CGSize(width: floor(source.size.width * scale), height: floor(source.size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            source.draw(in: CGRect(origin: .zero, size: size))
            let all = [date.formatted(date: .abbreviated, time: .standard)] + lines.filter { !$0.isEmpty }
            let fontSize = max(16, size.width * 0.028)
            let lineHeight = fontSize * 1.3
            let pad = fontSize * 0.7
            let barHeight = CGFloat(all.count) * lineHeight + pad * 2
            let bar = CGRect(x: 0, y: size.height - barHeight, width: size.width, height: barHeight)
            UIColor.black.withAlphaComponent(0.6).setFill()
            ctx.fill(bar)
            UIColor(red: 0x25 / 255, green: 0x63 / 255, blue: 0xEB / 255, alpha: 1).setFill() // fwPrimary
            ctx.fill(CGRect(x: 0, y: bar.minY, width: fontSize * 0.35, height: barHeight))
            for (i, line) in all.enumerated() {
                let font = i == 0
                    ? UIFont.monospacedSystemFont(ofSize: fontSize, weight: .bold)
                    : UIFont.systemFont(ofSize: fontSize * 0.9, weight: .semibold)
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
                (line as NSString).draw(
                    at: CGPoint(x: pad + fontSize * 0.4, y: bar.minY + pad + CGFloat(i) * lineHeight),
                    withAttributes: attrs
                )
            }
        }
        return image.jpegData(compressionQuality: 0.72)
    }
}
