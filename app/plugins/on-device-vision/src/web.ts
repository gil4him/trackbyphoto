import { WebPlugin } from '@capacitor/core'

import type {
  AnalyzeOptions,
  AnalyzeResult,
  CapabilitiesResult,
  GenerateMemoOptions,
  GenerateMemoResult,
  OnDeviceVisionPlugin,
} from './definitions'

/**
 * Web fallback. Apple Vision and Foundation Models obviously aren't available
 * in a browser, so this returns empty/stub data. The app's three-tier fallback
 * (see TrackByPhoto-Plan.md) catches this case and falls back to the cloud
 * text path or a template.
 */
export class OnDeviceVisionWeb extends WebPlugin implements OnDeviceVisionPlugin {
  async analyze(_options: AnalyzeOptions): Promise<AnalyzeResult> {
    return {
      tags: { labels: [], text: [], faceCount: 0 },
      durationMs: 0,
    }
  }

  async generateMemo(_options: GenerateMemoOptions): Promise<GenerateMemoResult> {
    return { memo: '', source: 'template' }
  }

  async capabilities(): Promise<CapabilitiesResult> {
    return { foundationModels: false, iosMajorVersion: 0, foundationModelsReason: 'web' }
  }
}
