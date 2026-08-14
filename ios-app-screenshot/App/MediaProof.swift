import AVFoundation
import CoreMedia
import UIKit

enum MediaProofMode: String {
    case camera
    case microphone
}

struct MediaProofRequest {
    private static let modeKey = "run-cloud-media-proof-mode"
    private static let attemptKey = "run-cloud-media-proof-attempt"

    let mode: MediaProofMode
    let attempt: String

    init?(url: URL) {
        guard url.scheme?.lowercased() == "runcloudproof" else { return nil }
        let component: String
        if url.host?.lowercased() == "media" {
            component = url.pathComponents.dropFirst().first?.lowercased() ?? ""
        } else {
            component = url.host?.lowercased() ?? ""
        }
        guard let mode = MediaProofMode(rawValue: component) else { return nil }
        let suppliedAttempt = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "attempt" })?
            .value ?? "unspecified"
        self.mode = mode
        self.attempt = MediaProofRequest.safeAttempt(suppliedAttempt)
    }

    private init(mode: MediaProofMode, attempt: String) {
        self.mode = mode
        self.attempt = attempt
    }

    func persist() {
        UserDefaults.standard.set(mode.rawValue, forKey: Self.modeKey)
        UserDefaults.standard.set(attempt, forKey: Self.attemptKey)
    }

    static func restore() -> MediaProofRequest? {
        guard
            let rawMode = UserDefaults.standard.string(forKey: modeKey),
            let mode = MediaProofMode(rawValue: rawMode)
        else { return nil }
        return MediaProofRequest(
            mode: mode,
            attempt: safeAttempt(UserDefaults.standard.string(forKey: attemptKey) ?? "restored")
        )
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: modeKey)
        UserDefaults.standard.removeObject(forKey: attemptKey)
    }

    private static func safeAttempt(_ value: String) -> String {
        let allowed = value.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0)
        }
        let result = String(String.UnicodeScalarView(allowed)).prefix(48)
        return result.isEmpty ? "unspecified" : String(result)
    }
}

final class MediaProofViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    private static let cameraFingerprint = "RCAM-v1:RGBY"
    private static let audioFingerprint = "RAUD-v1:1000Hz"

    private let request: MediaProofRequest
    private let statusLabel = UILabel()
    private let detailsLabel = UILabel()
    private let captureQueue = DispatchQueue(label: "cloud.run.examples.media-camera")
    private var captureSession: AVCaptureSession?
    private var audioEngine: AVAudioEngine?
    private var toneAnalyzer: ToneFingerprintAnalyzer?
    private var matchingCameraFrames = 0
    private var observedCameraFrames = 0
    private var started = false

    init(request: MediaProofRequest) {
        self.request = request
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.02, green: 0.07, blue: 0.10, alpha: 1)

        let title = UILabel()
        title.text = request.mode == .camera
            ? "run.cloud camera injection proof"
            : "run.cloud microphone injection proof"
        title.font = .monospacedSystemFont(ofSize: 21, weight: .bold)
        title.textColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 1)
        title.numberOfLines = 0
        title.accessibilityIdentifier = "media-proof-title"

        statusLabel.font = .monospacedSystemFont(ofSize: 16, weight: .bold)
        statusLabel.textColor = .white
        statusLabel.numberOfLines = 0
        statusLabel.backgroundColor = UIColor(red: 0.08, green: 0.22, blue: 0.27, alpha: 1)
        statusLabel.layer.cornerRadius = 12
        statusLabel.layer.masksToBounds = true
        statusLabel.accessibilityIdentifier = "media-proof-status"
        statusLabel.isAccessibilityElement = true

        detailsLabel.text = request.mode == .camera
            ? "Expected four solid quadrants: red, green, blue, and yellow."
            : "Expected mono PCM tone centered at 1000 Hz."
        detailsLabel.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        detailsLabel.textColor = UIColor(red: 0.78, green: 0.86, blue: 0.90, alpha: 1)
        detailsLabel.numberOfLines = 0
        detailsLabel.accessibilityIdentifier = "media-proof-expectation"

        let stack = UIStackView(arrangedSubviews: [title, statusLabel, detailsLabel])
        stack.axis = .vertical
        stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            statusLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 132),
        ])
        showStatus("\(request.mode.rawValue.uppercased()) ARMED attempt=\(request.attempt)")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        switch request.mode {
        case .camera: authorizeCamera()
        case .microphone: authorizeMicrophone()
        }
    }

    private func authorizeCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureCamera()
        case .notDetermined:
            showStatus("CAMERA PERMISSION attempt=\(request.attempt)")
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted { self?.configureCamera() }
                else { self?.fail("CAMERA", code: "permission-denied") }
            }
        default:
            fail("CAMERA", code: "permission-denied")
        }
    }

    private func configureCamera() {
        captureQueue.async { [weak self] in
            guard let self else { return }
            do {
                guard let device = AVCaptureDevice.default(for: .video) else {
                    throw MediaProofError("camera-unavailable")
                }
                let session = AVCaptureSession()
                session.beginConfiguration()
                session.sessionPreset = .medium
                let input = try AVCaptureDeviceInput(device: device)
                guard session.canAddInput(input) else { throw MediaProofError("camera-input") }
                session.addInput(input)
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String:
                        kCVPixelFormatType_32BGRA,
                ]
                output.setSampleBufferDelegate(self, queue: self.captureQueue)
                guard session.canAddOutput(output) else { throw MediaProofError("camera-output") }
                session.addOutput(output)
                session.commitConfiguration()
                self.captureSession = session
                session.startRunning()
                guard session.isRunning else { throw MediaProofError("camera-not-running") }
                self.showStatus("CAMERA READY \(Self.cameraFingerprint) attempt=\(self.request.attempt)")
            } catch {
                self.fail("CAMERA", code: (error as? MediaProofError)?.code ?? "setup")
            }
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard request.mode == .camera, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        observedCameraFrames += 1
        let colors = CameraPatternFingerprint.colors(in: pixelBuffer)
        if colors == Set(["R", "G", "B", "Y"]) {
            matchingCameraFrames += 1
        } else {
            matchingCameraFrames = 0
        }
        if matchingCameraFrames >= 3 {
            showStatus(
                "CAMERA PASS \(Self.cameraFingerprint) attempt=\(request.attempt) "
                    + "frames=\(observedCameraFrames) matches=\(matchingCameraFrames)"
            )
        } else if observedCameraFrames % 10 == 0 {
            showStatus(
                "CAMERA WAIT \(Self.cameraFingerprint) attempt=\(request.attempt) "
                    + "frames=\(observedCameraFrames) colors=\(colors.sorted().joined())"
            )
        }
    }

    private func authorizeMicrophone() {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            configureMicrophone()
        case .undetermined:
            showStatus("MICROPHONE PERMISSION attempt=\(request.attempt)")
            session.requestRecordPermission { [weak self] granted in
                if granted { self?.configureMicrophone() }
                else { self?.fail("MICROPHONE", code: "permission-denied") }
            }
        default:
            fail("MICROPHONE", code: "permission-denied")
        }
    }

    private func configureMicrophone() {
        captureQueue.async { [weak self] in
            guard let self else { return }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .measurement)
                try session.setActive(true)
                let engine = AVAudioEngine()
                let input = engine.inputNode
                let format = input.inputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else {
                    throw MediaProofError("microphone-format")
                }
                let analyzer = ToneFingerprintAnalyzer(sampleRate: format.sampleRate)
                self.toneAnalyzer = analyzer
                input.installTap(onBus: 0, bufferSize: 4096, format: nil) { [weak self] buffer, _ in
                    guard let self, let observation = analyzer.observe(buffer) else { return }
                    if observation.matchedWindows >= 3 {
                        self.showStatus(
                            "MICROPHONE PASS \(Self.audioFingerprint) attempt=\(self.request.attempt) "
                                + "samples=\(observation.samples) rate=\(Int(observation.sampleRate.rounded())) "
                                + "measured=\(Int(observation.measuredHz.rounded()))Hz"
                        )
                    } else if observation.windows % 4 == 0 {
                        self.showStatus(
                            "MICROPHONE WAIT \(Self.audioFingerprint) attempt=\(self.request.attempt) "
                                + "samples=\(observation.samples) rms=\(String(format: "%.3f", observation.rms))"
                        )
                    }
                }
                self.audioEngine = engine
                engine.prepare()
                try? engine.start()
                self.showStatus(
                    "MICROPHONE READY \(Self.audioFingerprint) attempt=\(self.request.attempt) "
                        + "rate=\(Int(format.sampleRate.rounded()))"
                )
            } catch {
                self.fail("MICROPHONE", code: (error as? MediaProofError)?.code ?? "setup")
            }
        }
    }

    private func showStatus(_ value: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusLabel.text = "  \(value)  "
            self?.statusLabel.accessibilityLabel = value
            self?.statusLabel.accessibilityValue = value
        }
    }

    private func fail(_ input: String, code: String) {
        showStatus("\(input) FAIL code=\(code) attempt=\(request.attempt)")
    }
}

private struct MediaProofError: Error {
    let code: String
    init(_ code: String) { self.code = code }
}

private enum CameraPatternFingerprint {
    static func colors(in pixelBuffer: CVPixelBuffer) -> Set<String> {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard
            CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
            let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer)
        else { return [] }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
        let points = [
            (width / 4, height / 4),
            (3 * width / 4, height / 4),
            (width / 4, 3 * height / 4),
            (3 * width / 4, 3 * height / 4),
        ]
        return Set(points.compactMap { point in
            classify(
                averageNear: point.0,
                y: point.1,
                bytes: bytes,
                rowBytes: rowBytes,
                width: width,
                height: height
            )
        })
    }

    private static func averageNear(
        _ x: Int,
        y: Int,
        bytes: UnsafePointer<UInt8>,
        rowBytes: Int,
        width: Int,
        height: Int
    ) -> (Double, Double, Double) {
        let radius = max(2, min(width, height) / 48)
        var red = 0.0
        var green = 0.0
        var blue = 0.0
        var samples = 0.0
        for sampleY in stride(from: max(0, y - radius), through: min(height - 1, y + radius), by: 2) {
            for sampleX in stride(from: max(0, x - radius), through: min(width - 1, x + radius), by: 2) {
                let offset = sampleY * rowBytes + sampleX * 4
                blue += Double(bytes[offset])
                green += Double(bytes[offset + 1])
                red += Double(bytes[offset + 2])
                samples += 1
            }
        }
        return (red / samples, green / samples, blue / samples)
    }

    private static func classify(_ color: (Double, Double, Double)) -> String? {
        let (red, green, blue) = color
        if red > 110, green > 105, blue < min(red, green) * 0.65 { return "Y" }
        if red > 100, red > green * 1.45, red > blue * 1.45 { return "R" }
        if green > 85, green > red * 1.35, green > blue * 1.35 { return "G" }
        if blue > 100, blue > red * 1.45, blue > green * 1.45 { return "B" }
        return nil
    }
}

private struct ToneObservation {
    let samples: Int
    let windows: Int
    let matchedWindows: Int
    let sampleRate: Double
    let measuredHz: Double
    let rms: Double
}

private final class ToneFingerprintAnalyzer {
    private let sampleRate: Double
    private var totalSamples = 0
    private var windows = 0
    private var matchedWindows = 0

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
    }

    func observe(_ buffer: AVAudioPCMBuffer) -> ToneObservation? {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength >= 512 else { return nil }
        let count = Int(buffer.frameLength)
        totalSamples += count
        windows += 1
        var energy = 0.0
        var targetReal = 0.0
        var targetImaginary = 0.0
        var referenceReal = 0.0
        var referenceImaginary = 0.0
        var crossings = 0
        var previous = Double(samples[0])
        for index in 0..<count {
            let value = Double(samples[index])
            energy += value * value
            let targetPhase = 2 * Double.pi * 1_000 * Double(index) / sampleRate
            targetReal += value * cos(targetPhase)
            targetImaginary -= value * sin(targetPhase)
            let referencePhase = 2 * Double.pi * 713 * Double(index) / sampleRate
            referenceReal += value * cos(referencePhase)
            referenceImaginary -= value * sin(referencePhase)
            if index > 0, (previous < 0 && value >= 0) || (previous >= 0 && value < 0) {
                crossings += 1
            }
            previous = value
        }
        let rms = sqrt(energy / Double(count))
        let target = 2 * hypot(targetReal, targetImaginary) / Double(count)
        let reference = 2 * hypot(referenceReal, referenceImaginary) / Double(count)
        let measured = Double(crossings) * sampleRate / (2 * Double(count))
        if rms > 0.08, target > 0.15, target > reference * 4, (920...1_080).contains(measured) {
            matchedWindows += 1
        } else {
            matchedWindows = 0
        }
        return ToneObservation(
            samples: totalSamples,
            windows: windows,
            matchedWindows: matchedWindows,
            sampleRate: sampleRate,
            measuredHz: measured,
            rms: rms
        )
    }
}
