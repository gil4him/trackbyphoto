import Foundation
import Capacitor

// Skeleton implementation. Returns stub data so the JS side has something to
// drive the UI against. Real Vision + Foundation Models wiring lands in the
// next commits (see TrackByPhoto-Plan.md, Phase 2).

@objc(OnDeviceVisionPlugin)
public class OnDeviceVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OnDeviceVisionPlugin"
    public let jsName = "OnDeviceVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateMemo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
    ]

    @objc func analyze(_ call: CAPPluginCall) {
        guard let _ = call.getString("path") else {
            call.reject("path is required")
            return
        }
        // TODO: load UIImage from path, run VNCoreMLRequest (classification),
        // VNRecognizeTextRequest (Korean OCR), VNDetectFaceRectanglesRequest.
        call.resolve([
            "tags": [
                "labels": [] as [Any],
                "text": [] as [String],
                "faceCount": 0,
            ],
            "durationMs": 0,
        ])
    }

    @objc func generateMemo(_ call: CAPPluginCall) {
        // TODO: when foundationModels available, prompt the on-device LLM with
        // the Korean system prompt from TrackByPhoto-Plan.md §6.
        // For now: return empty so the JS side falls back to template/cloud.
        call.resolve([
            "memo": "",
            "source": "template",
        ])
    }

    @objc func capabilities(_ call: CAPPluginCall) {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        // Foundation Models requires iOS 26+ and Apple Intelligence-eligible
        // hardware. Real check uses `SystemLanguageModel.default.availability`
        // once we add the framework import; stub conservatively as false.
        call.resolve([
            "foundationModels": false,
            "iosMajorVersion": major,
        ])
    }
}
