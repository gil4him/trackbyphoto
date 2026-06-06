// Public TypeScript surface for the OnDeviceVision plugin.
//
// Layer 1 (analyze): Apple Vision pipeline — image classification, Korean OCR,
// face count. Cheap, deterministic, runs on every iPhone.
// Layer 2 (generateMemo): Apple Foundation Models on-device LLM that turns the
// Layer 1 tags into a one-line Korean memo. Only available on iPhone 15 Pro+
// with iOS 26+ / Apple Intelligence enabled.
export {};
