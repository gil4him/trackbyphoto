import Foundation
import Capacitor
import UIKit
import Vision

// Layer 1 of the on-device pipeline: Apple Vision.
//
//   analyze(path)        → image classification + Korean OCR + face count
//   generateMemo(tags)   → stub (Layer 2, Foundation Models, lands next)
//   capabilities()       → reports iOS version + (later) Foundation Models
//
// All three Vision requests are issued against a single VNImageRequestHandler
// so the image is decoded once.

@objc(OnDeviceVisionPlugin)
public class OnDeviceVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OnDeviceVisionPlugin"
    public let jsName = "OnDeviceVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateMemo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - analyze

    @objc func analyze(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        guard let image = loadImage(path: path), let cgImage = image.cgImage else {
            call.reject("could not load image at \(path)")
            return
        }

        // Hop off the main thread — Vision requests block and we don't want
        // the JS bridge thread sitting around.
        DispatchQueue.global(qos: .userInitiated).async {
            let started = Date()

            let classify = VNClassifyImageRequest()

            let ocr = VNRecognizeTextRequest()
            ocr.recognitionLanguages = ["ko-KR", "en-US"]
            ocr.recognitionLevel = .accurate
            ocr.usesLanguageCorrection = true

            let faces = VNDetectFaceRectanglesRequest()

            let handler = VNImageRequestHandler(
                cgImage: cgImage,
                orientation: Self.cgOrientation(from: image.imageOrientation),
                options: [:]
            )

            do {
                try handler.perform([classify, ocr, faces])
            } catch {
                call.reject("Vision request failed: \(error.localizedDescription)")
                return
            }

            // Keep only confident, non-trivial classification labels. The
            // VNClassifyImageRequest returns ~1300 taxonomy hits; we want the
            // top handful.
            let labels: [[String: Any]] = (classify.results ?? [])
                .filter { $0.confidence >= 0.25 }
                .prefix(8)
                .map { ["name": $0.identifier, "confidence": Double($0.confidence)] }

            let text: [String] = (ocr.results ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }

            let faceCount = (faces.results ?? []).count

            let durationMs = Int(Date().timeIntervalSince(started) * 1000)

            call.resolve([
                "tags": [
                    "labels": labels,
                    "text": text,
                    "faceCount": faceCount,
                ],
                "durationMs": durationMs,
            ])
        }
    }

    // MARK: - generateMemo (stub — Layer 2 lands next)

    @objc func generateMemo(_ call: CAPPluginCall) {
        // Foundation Models wiring comes in the next commit. For now return
        // empty so the JS side falls through to the template / cloud fallback.
        call.resolve([
            "memo": "",
            "source": "template",
        ])
    }

    // MARK: - capabilities

    @objc func capabilities(_ call: CAPPluginCall) {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        // Conservative: report Foundation Models unavailable until the next
        // commit wires up SystemLanguageModel.default.availability.
        call.resolve([
            "foundationModels": false,
            "iosMajorVersion": major,
        ])
    }

    // MARK: - helpers

    /// Accepts either a `file://` URL, a Capacitor webPath, or a bare
    /// absolute path. Returns nil if the bytes can't be loaded.
    private func loadImage(path: String) -> UIImage? {
        if let url = URL(string: path), url.isFileURL {
            return UIImage(contentsOfFile: url.path)
        }
        if path.hasPrefix("/") {
            return UIImage(contentsOfFile: path)
        }
        // Capacitor's webPath looks like capacitor://localhost/_capacitor_file_/...
        // Strip the capacitor scheme prefix and try again.
        if let range = path.range(of: "_capacitor_file_") {
            let filePath = String(path[range.upperBound...])
            return UIImage(contentsOfFile: filePath)
        }
        return nil
    }

    private static func cgOrientation(from uiOrientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch uiOrientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
