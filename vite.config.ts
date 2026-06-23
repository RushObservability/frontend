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
  return {
    name: 'rush-runtime-config-dev',
    configureServer(server) {
      server.middlewares.use('/runtime-config.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript')
        res.end(`window.__RUSH_CONFIG__=${JSON.stringify({ apiBaseUrl })};`)
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
    fs: {
      allow: [
        // Allow serving files from the SDK directory
        path.resolve(__dirname, '..'),
      ],
    },
    proxy: {
      // SRE agent service (more specific routes must come before /api)
      '/api/v1/investigate': { target: 'http://localhost:8081', changeOrigin: true },
      '/api/v1/sessions': { target: 'http://localhost:8081', changeOrigin: true },
      '/api/v1/investigation-templates': { target: 'http://localhost:8081', changeOrigin: true },
      '/api': {
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
