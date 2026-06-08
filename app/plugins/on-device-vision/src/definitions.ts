// Public TypeScript surface for the OnDeviceVision plugin.
//
// Layer 1 (analyze): Apple Vision pipeline — image classification, Korean OCR,
// face count. Cheap, deterministic, runs on every iPhone.
// Layer 2 (generateMemo): Apple Foundation Models on-device LLM that turns the
// Layer 1 tags into a one-line Korean memo. Only available on iPhone 15 Pro+
// with iOS 26+ / Apple Intelligence enabled.

export interface VisionTags {
  /** Top image classification labels with confidence (0–1). */
  labels: { name: string; confidence: number }[]
  /** Korean (or other recognized) text strings found in the photo. */
  text: string[]
  /** Number of human faces detected. */
  faceCount: number
}

export interface AnalyzeOptions {
  /** Local file URL (file://...) or webPath returned by Capacitor Camera. */
  path: string
}

export interface AnalyzeResult {
  tags: VisionTags
  /** Milliseconds spent in the Vision pipeline. */
  durationMs: number
}

export interface GenerateMemoOptions {
  tags: VisionTags
  /** Optional: HH:mm string to hint time-of-day phrasing. */
  timeHint?: string
  /** Optional: reverse-geocoded place to thread into the memo. */
  placeHint?: string
}

export interface GenerateMemoResult {
  /** One-line Korean memo (e.g., "공원에서 산책 중"). */
  memo: string
  /** Which path produced this memo. */
  source: 'foundation-models' | 'template'
}

export interface CapabilitiesResult {
  /** True when Apple Foundation Models is available on this device. */
  foundationModels: boolean
  /** iOS major version (e.g., 17, 18, 26). */
  iosMajorVersion: number
  /**
   * When `foundationModels` is false, a short tag for *why* — e.g.
   * "ios<26", "deviceNotEligible", "appleIntelligenceNotEnabled",
   * "modelNotReady", "frameworkNotLinked". Useful for surfacing in
   * Settings/debug; not shown to the patient.
   */
  foundationModelsReason?: string
}

export interface OnDeviceVisionPlugin {
  analyze(options: AnalyzeOptions): Promise<AnalyzeResult>
  generateMemo(options: GenerateMemoOptions): Promise<GenerateMemoResult>
  capabilities(): Promise<CapabilitiesResult>
}
