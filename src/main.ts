// Polyfill crypto.randomUUID for non-secure contexts (HTTP)
{
  const c = globalThis.crypto
  if (c && !c.randomUUID) {
    c.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
      const bytes = new Uint8Array(16)
      c.getRandomValues(bytes)
      bytes[6] = (bytes[6]! & 0x0f) | 0x40
      bytes[8] = (bytes[8]! & 0x3f) | 0x80
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  }
}

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/chart.css'
import {
  flushAnalyticsRequestMetrics,
  setAnalyticsRequestMetricSink,
} from './lib/analyticsRequestCache'
import { flushPollingMetrics, setPollingMetricSink } from './composables/usePollingTask'

const app = createApp(App)
app.use(router)
app.mount('#app')

// Self-ingest RUM when VITE_RUM_ENABLED is set
if (import.meta.env.VITE_RUM_ENABLED === 'true') {
  // @ts-ignore
  import('@rushobservability/rum-sdk').then(({ RushRUM }) => {
    RushRUM.init({
      endpoint: import.meta.env.VITE_RUM_ENDPOINT || '/api/v1/rum/ingest',
      app: {
        name: import.meta.env.VITE_RUM_APP_NAME || 'rush-ui',
        version: import.meta.env.VITE_RUM_APP_VERSION || '0.1.0',
      },
      environment: import.meta.env.VITE_RUM_ENVIRONMENT || 'development',
      sampleRate: 1.0,
      trackWebVitals: true,
      trackErrors: true,
      trackInteractions: true,
      trackResources: false,
      trackPageViews: true,
    })
    // Aggregate request-cache outcomes into one low-volume RUM event. Semantic
    // request keys and query text never enter telemetry attributes.
    setAnalyticsRequestMetricSink(counts => {
      RushRUM.trackEvent('query_request_cache', {
        cache_hits: counts.hit,
        in_flight_deduplications: counts.dedup,
        superseded_or_aborted: counts.cancel,
        cache_misses: counts.miss,
        cache_evictions: counts.eviction,
      })
    })
    setPollingMetricSink(summaries => {
      for (const summary of summaries) {
        RushRUM.trackEvent('polling_refresh', {
          category: summary.category,
          refreshes: summary.refreshes,
          failures: summary.failures,
          skipped_overlaps: summary.skippedOverlaps,
          backoffs: summary.backoffs,
          average_duration_ms: summary.refreshes > 0
            ? Math.round(summary.durationMsTotal / summary.refreshes)
            : 0,
          maximum_duration_ms: Math.round(summary.durationMsMax),
          maximum_backoff_ms: Math.round(summary.backoffMsMax),
        })
      }
    })
    window.addEventListener('pagehide', () => {
      flushAnalyticsRequestMetrics()
      flushPollingMetrics()
      RushRUM.flush()
    }, { once: true })
    console.log('[Rush RUM] SDK initialized')
  }).catch((err) => {
    console.warn('[Rush RUM] Failed to load SDK:', err)
  })
}
