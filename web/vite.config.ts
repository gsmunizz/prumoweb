/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Em desenvolvimento o Vite faz o papel do rewrite da hospedagem:
  // /api/* vai para a API Go, então app e API ficam na mesma origem.
  const apiTarget = env.PRUMO_API_URL ?? 'http://localhost:8080'

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Prumo',
          short_name: 'Prumo',
          description: 'Controle financeiro pessoal',
          lang: 'pt-BR',
          start_url: '/',
          display: 'standalone',
          background_color: '#F4F6F8',
          theme_color: '#2446D8',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: '/index.html',
          // A API nunca passa pelo cache do service worker; os dados vêm do IndexedDB.
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
      },
    },
    test: {
      environment: 'node',
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})
