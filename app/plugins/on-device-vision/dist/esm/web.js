import { WebPlugin } from '@capacitor/core';
/**
 * Web fallback. Apple Vision and Foundation Models obviously aren't available
 * in a browser, so this returns empty/stub data. The app's three-tier fallback
 * (see TrackByPhoto-Plan.md) catches this case and falls back to the cloud
 * text path or a template.
 */
export class OnDeviceVisionWeb extends WebPlugin {
    async analyze(_options) {
        return {
            tags: { labels: [], text: [], faceCount: 0 },
            durationMs: 0,
        };
    }
    async generateMemo(_options) {
        return { memo: '', source: 'template' };
    }
    async capabilities() {
        return { foundationModels: false, iosMajorVersion: 0 };
    }
}
