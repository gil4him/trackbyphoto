import { WebPlugin } from '@capacitor/core';
import type { AnalyzeOptions, AnalyzeResult, CapabilitiesResult, GenerateMemoOptions, GenerateMemoResult, OnDeviceVisionPlugin } from './definitions';
/**
 * Web fallback. Apple Vision and Foundation Models obviously aren't available
 * in a browser, so this returns empty/stub data. The app's three-tier fallback
 * (see TrackByPhoto-Plan.md) catches this case and falls back to the cloud
 * text path or a template.
 */
export declare class OnDeviceVisionWeb extends WebPlugin implements OnDeviceVisionPlugin {
    analyze(_options: AnalyzeOptions): Promise<AnalyzeResult>;
    generateMemo(_options: GenerateMemoOptions): Promise<GenerateMemoResult>;
    capabilities(): Promise<CapabilitiesResult>;
}
