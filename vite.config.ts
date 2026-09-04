import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'path'

const nginxSecurityHeaders = readFileSync(
  new URL('./nginx/nginx-security-headers.conf', import.meta.url),
  'utf8',
)

function nginxHeader(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = nginxSecurityHeaders.match(new RegExp(`add_header\\s+${escapedName}\\s+"([^"]+)"\\s+always;`))?.[1]
  if (!value) throw new Error(`Missing ${name} in nginx/nginx-security-headers.conf`)
  return value
}

const previewSecurityHeaders = Object.fromEntries([
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Strict-Transport-Security',
  'Content-Security-Policy',
  'Content-Security-Policy-Report-Only',
].map(name => [name, nginxHeader(name)]))

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
  test: {
    // The Remotion demo is a separate npm project nested under web-ui. Exclude
    // all dependency trees so Vitest never discovers their bundled test files.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
  optimizeDeps: {
    include: ['@rushobservability/rum-sdk'],
  },
  preview: {
    // Exercise the production policy during the normal Playwright run. The
    // values come from nginx's shared include so the two environments cannot drift.
    headers: previewSecurityHeaders,
  },
  server: {
    port: 5173,
    // Allow tunneling through ngrok (and similar) for HTTPS-only IdP testing.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
    fs: {
      allow: [
        // Allow serving files from the SDK directory
        path.resolve(import.meta.dirname, '..'),
        // A composed edition may reuse this checkout's dependencies from a
        // sibling working directory during local development.
        ...(process.env.VITE_ADDITIONAL_FS_ROOT
          ? [path.resolve(process.env.VITE_ADDITIONAL_FS_ROOT)]
          : []),
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
      '/metrics': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
