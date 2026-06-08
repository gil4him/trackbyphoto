import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The deployed web URL is now a dev/preview surface (the patient-facing
      // path is the native iOS app), and the precache layer was masking each
      // deploy from us — users kept seeing stale builds until they hard-
      // reloaded. `selfDestroying: true` ships a service worker whose only
      // job is to uninstall itself + drop its caches on next visit, so
      // existing installs get cleaned up automatically.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '오늘하루 · TrackByPhoto',
        short_name: '오늘하루',
        description: '한 번의 터치로 오늘의 순간을 가족에게 전합니다.',
        lang: 'ko',
        theme_color: '#FFB84D',
        background_color: '#FFF8EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // The PNG icon set hasn't been generated yet. SVG with sizes:"any"
        // is honored by Chrome/Android and ignored by iOS Safari (which
        // falls back to the apple-touch-icon meta). Avoids the manifest
        // 404 noise we were getting from the missing icon-*.png files.
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ],
  server: {
    host: true,        // expose on LAN so iPhone can connect
    port: 5173
  }
})
