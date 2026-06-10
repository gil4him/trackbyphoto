import Foundation
import Capacitor
import UIKit
import Vision

#if canImport(FoundationModels)
import FoundationModels
#endif

// On-device pipeline for TrackByPhoto.
//
//   analyze(path)        → Layer 1: Apple Vision (image classification, Korean
//                          OCR, face count). Runs on every iPhone (iOS 17+).
//   generateMemo(tags)   → Layer 2: Apple Foundation Models (on-device LLM)
//                          turns Vision tags into a warm Korean memo. Only
//                          available on iPhone 15 Pro+ with iOS 26+ and
//                          Apple Intelligence enabled. Falls through to an
//                          empty string + source:"template" otherwise; the JS
//                          side then uses its tier-2 template fallback.
//   capabilities()       → reports iOS version + Foundation Models availability
//                          so the JS side can pick a tier without trial calls.

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

    // MARK: - generateMemo (Layer 2 — Foundation Models)

    @objc func generateMemo(_ call: CAPPluginCall) {
        let tags = call.getObject("tags") ?? [:]
        let timeHint = call.getString("timeHint") ?? ""
        let placeHint = call.getString("placeHint") ?? ""

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                let result = await Self.runFoundationModels(
                    tags: tags,
                    timeHint: timeHint,
                    placeHint: placeHint
                )
                call.resolve(result)
            }
            return
        }
        #endif

        // No Foundation Models on this device — JS side handles the template
        // fallback. Returning empty rather than rejecting keeps the call site
        // simple (one branch, not two).
        call.resolve(["memo": "", "source": "template"])
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private static func runFoundationModels(
        tags: JSObject,
        timeHint: String,
        placeHint: String
    ) async -> [String: Any] {
        // Availability gate. The model may be installed yet unavailable
        // (Apple Intelligence off, device ineligible, model downloading) —
        // we just hand back an empty memo and let the JS template tier win.
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return ["memo": "", "source": "template"]
        }

        let prompt = buildPrompt(tags: tags, timeHint: timeHint, placeHint: placeHint)

        let instructions = """
        당신은 어르신의 하루를 가족에게 따뜻하게 전하는 보조 AI입니다.
        사진 정보를 보고, 어르신이 무엇을 하고 계신지 짧고 다정한 한 문장으로 적어주세요.

        규칙:
        1. 한 문장, 25자 이내. 무엇을 하시는지(활동)에 집중.
        2. 사물·옷·색깔·배경·개수를 나열하지 마세요.
        3. 가족이 미소 지을 만한 따뜻한 한국어 존댓말 캡션처럼.
        4. 확신이 없으면 일반적으로 사실에 가깝게. 구체적인 사실은 지어내지 마세요.
        5. 사람 이름, 사진 속 글자, 건강·약·진단명은 절대 추측하지 마세요.
        6. 활동이 불분명하면 "오늘의 한 순간을 담았어요."
        """

        do {
            let session = LanguageModelSession(instructions: instructions)
            let options = GenerationOptions(temperature: 0.6)
            let response = try await session.respond(to: prompt, options: options)
            let memo = response.content
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
            if memo.isEmpty {
                return ["memo": "", "source": "template"]
            }
            return ["memo": memo, "source": "foundation-models"]
        } catch {
            // Generation can fail for content-policy or transient reasons.
            // Surface the message in logs but don't reject — the template
            // fallback is the user-facing recovery path.
            return [
                "memo": "",
                "source": "template",
                "error": error.localizedDescription,
            ]
        }
    }
    #endif

    /// Turns the Vision tags into a compact prompt for the LLM. Kept as plain
    /// Korean text rather than JSON so the model treats it as natural input.
    private static func buildPrompt(tags: JSObject, timeHint: String, placeHint: String) -> String {
        var parts: [String] = []

        if let labels = tags["labels"] as? [[String: Any]] {
            let names = labels
                .compactMap { $0["name"] as? String }
                .prefix(5)
                .joined(separator: ", ")
            if !names.isEmpty { parts.append("이미지 분류: \(names)") }
        }
        if let text = tags["text"] as? [String], !text.isEmpty {
            let joined = text.prefix(3).joined(separator: " / ")
            parts.append("사진 속 글자: \(joined)")
        }
        if let faceCount = tags["faceCount"] as? Int, faceCount > 0 {
            parts.append("사람 \(faceCount)명")
        }
        if !placeHint.isEmpty { parts.append("장소: \(placeHint)") }
        if !timeHint.isEmpty { parts.append("시간: \(timeHint)") }

        let body = parts.isEmpty ? "특별한 단서가 없는 일상 사진" : parts.joined(separator: "\n")
        return "다음 사진 정보를 바탕으로 한 문장의 따뜻한 한국어 메모를 만들어주세요.\n\n\(body)"
    }

    // MARK: - capabilities

    @objc func capabilities(_ call: CAPPluginCall) {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        var fmAvailable = false
        var fmReason: String? = nil

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                fmAvailable = true
            case .unavailable(let reason):
                fmReason = String(describing: reason)
            }
        } else {
            fmReason = "ios<26"
        }
        #else
        fmReason = "frameworkNotLinked"
        #endif

        var result: [String: Any] = [
            "foundationModels": fmAvailable,
            "iosMajorVersion": major,
        ]
        if let r = fmReason { result["foundationModelsReason"] = r }
        call.resolve(result)
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
