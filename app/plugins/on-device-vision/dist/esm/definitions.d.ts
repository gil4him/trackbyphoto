export interface VisionTags {
    /** Top image classification labels with confidence (0–1). */
    labels: {
        name: string;
        confidence: number;
    }[];
    /** Korean (or other recognized) text strings found in the photo. */
    text: string[];
    /** Number of human faces detected. */
    faceCount: number;
}
export interface AnalyzeOptions {
    /** Local file URL (file://...) or webPath returned by Capacitor Camera. */
    path: string;
}
export interface AnalyzeResult {
    tags: VisionTags;
    /** Milliseconds spent in the Vision pipeline. */
    durationMs: number;
}
export interface GenerateMemoOptions {
    tags: VisionTags;
    /** Optional: HH:mm string to hint time-of-day phrasing. */
    timeHint?: string;
    /** Optional: reverse-geocoded place to thread into the memo. */
    placeHint?: string;
}
export interface GenerateMemoResult {
    /** One-line Korean memo (e.g., "공원에서 산책 중"). */
    memo: string;
    /** Which path produced this memo. */
    source: 'foundation-models' | 'template';
}
export interface CapabilitiesResult {
    /** True when Apple Foundation Models is available on this device. */
    foundationModels: boolean;
    /** iOS major version (e.g., 17, 18, 26). */
    iosMajorVersion: number;
}
export interface OnDeviceVisionPlugin {
    analyze(options: AnalyzeOptions): Promise<AnalyzeResult>;
    generateMemo(options: GenerateMemoOptions): Promise<GenerateMemoResult>;
    capabilities(): Promise<CapabilitiesResult>;
}
