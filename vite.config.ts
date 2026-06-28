import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// In production nginx serves /runtime-config.js with env-substituted values.
// In local dev there's no nginx, so this middleware stands in. It points apiBaseUrl
// at the local query-api (where ingest endpoints like /cloudwatch actually live, and
// which the proxy below also targets) so the UI shows the real API host instead of
// the dev server's :5173 origin. Override with API_PUBLIC_URL when running the dev
// server against a different API.
function runtimeConfigDev(): Plugin {
  const apiBaseUrl = process.env.API_PUBLIC_URL || 'http://localhost:8080'
  const defaultTheme = process.env.DEFAULT_THEME || 'light'
  return {
    name: 'rush-runtime-config-dev',
    configureServer(server) {
      server.middlewares.use('/runtime-config.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript')
        res.end(`window.__RUSH_CONFIG__=${JSON.stringify({ apiBaseUrl, defaultTheme })};`)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), runtimeConfigDev()],
  optimizeDeps: {
    include: ['@rushobservability/rum-sdk'],
  },
  server: {
    port: 5173,
    // Allow tunneling through ngrok (and similar) for HTTPS-only IdP testing.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
    fs: {
      allow: [
        // Allow serving files from the SDK directory
        path.resolve(__dirname, '..'),
      ],
    },
    proxy: {
      // SRE-agent routes (/investigate, /sessions, /investigation-templates) are
      // no longer split out here — query-api fronts the agent and forwards them,
      // so they flow through the general /api proxy below.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // SSO endpoints (login initiation, ACS callback, logout) live on the backend.
      // Without this, /auth/sso/login hits the SPA fallback and the auth guard
      // bounces it back to /login?redirect=/auth/sso/login (a self-redirect loop).
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/prom': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
