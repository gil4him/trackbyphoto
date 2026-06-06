import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
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
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Don't precache user photos
        navigateFallbackDenylist: [/^\/__/]
      }
    })
  ],
  server: {
    host: true,        // expose on LAN so iPhone can connect
    port: 5173
  }
})
