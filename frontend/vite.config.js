import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Book Scanner Reader',
        short_name: 'BookReader',
        description: 'Photograph physical book pages, build an EPUB, and have it read aloud.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + JS/CSS are cached for offline install/launch.
        // Scanning itself still requires connectivity (backend OCR call).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // The OpenCV.js chunk (~15MB) is lazy-loaded only when the user
        // scans a page; it's too large for the install-time precache, so
        // it's cached on first use instead via the runtime rule below.
        globIgnores: ['**/opencv-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/opencv-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv-runtime-cache',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/ocr': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/books': 'http://localhost:3000',
    },
  },
})
