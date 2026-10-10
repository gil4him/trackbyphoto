import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Universal/App Links files (well-known/README.md). Only the simple site may
// claim /pair for the shared app id, so the full build never ships them.
function wellKnown(mode: string): Plugin {
  return {
    name: 'daylie-well-known',
    apply: 'build',
    generateBundle() {
      if (mode !== 'simple') return
      for (const name of ['apple-app-site-association', 'assetlinks.json']) {
        this.emitFile({
          type: 'asset',
          fileName: `.well-known/${name}`,
          source: readFileSync(new URL(`./well-known/${name}`, import.meta.url)),
        })
      }
    },
  }
}

// 개인정보처리방침 and 이용약관 (legal/README.md). Plain static HTML, no JS,
// served at /privacy and /terms by the rewrites in firebase.json. They
// describe the simple edition only, so the full build never ships them.
const LEGAL_PAGES = ['privacy', 'terms'] as const

function legalPages(mode: string): Plugin {
  return {
    name: 'daylie-legal',
    apply: 'build',
    generateBundle() {
      if (mode !== 'simple') return
      for (const name of LEGAL_PAGES) {
        this.emitFile({
          type: 'asset',
          fileName: `${name}.html`,
          source: readFileSync(new URL(`./legal/${name}.html`, import.meta.url)),
        })
      }
    },
  }
}

// Each edition's own name in the tab title and the web-app manifest
// (src/lib/edition.ts appTitle at runtime).
const titleFor = (mode: string) => (mode === 'simple' ? '오늘하루' : '오늘하루 · TrackByPhoto')

function editionTitle(mode: string): Plugin {
  return {
    name: 'daylie-title',
    transformIndexHtml: (html) => html.replace(/<title>.*<\/title>/, `<title>${titleFor(mode)}</title>`),
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    wellKnown(mode),
    legalPages(mode),
    editionTitle(mode),
    VitePWA({
      // Parents use the website from a home-screen icon, so the app's own
      // files are kept on the phone: it opens at once, on a weak connection
      // or none. A new deploy is picked up in the background; the page moves
      // to it through the app's own update check (hooks/useAppUpdate.ts),
      // which asks the server directly and never this cache. That check is
      // what was missing when an earlier precache kept phones on stale builds.
      registerType: 'autoUpdate',
      // Registered by src/lib/sw.ts: on the website only, and without the
      // plugin's reload-the-page-whenever-a-new-version-lands behaviour.
      injectRegister: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The push worker is its own registration (scope /push/).
        globIgnores: ['push-sw.js'],
        navigateFallback: '/index.html',
        // Firebase's sign-in helper pages live under /__/ and must come from
        // the server. /privacy and /terms are their own static pages — the app
        // shell must not answer for them (legalPages above).
        navigateFallbackDenylist: [/^\/__\//, /^\/(privacy|terms)\/?$/],
        cleanupOutdatedCaches: true,
        // A new version takes over as soon as it has arrived instead of
        // waiting for every tab to close; reloadToLatest (src/lib/sw.ts)
        // relies on this. Taking over never reloads a page by itself.
        skipWaiting: true,
        clientsClaim: true,
      },
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: titleFor(mode),
        short_name: '오늘하루',
        description: '한 번의 터치로 오늘의 순간을 가족에게 전합니다.',
        lang: 'ko',
        theme_color: '#FFB84D',
        background_color: '#FFF8EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // Home-screen icons (Android/Chrome install, desktop install). iPhone
        // takes the apple-touch-icon from index.html instead.
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      }
    })
  ],
  server: {
    host: true,        // expose on LAN so iPhone can connect
    port: 5173
  }
}))
