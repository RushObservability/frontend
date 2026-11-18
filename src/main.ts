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
import { installApplicationHealth } from './lib/applicationHealth'
import App from './App.vue'
import router from './router'
import '@fontsource/figtree/latin-300.css'
import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-500.css'
import '@fontsource/figtree/latin-600.css'
import '@fontsource/figtree/latin-700.css'
import '@fontsource/jetbrains-mono/latin-300.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-400-italic.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import './styles/chart.css'
import {
  flushAnalyticsRequestMetrics,
  setAnalyticsRequestMetricSink,
} from './lib/analyticsRequestCache'
import { flushPollingMetrics, setPollingMetricSink } from './composables/usePollingTask'
import { flushOperationalMetrics, setOperationalMetricSink } from './lib/operationalTelemetry'
import { sanitizeRumEvent } from './lib/rumPrivacy'
import { readRumConfiguration } from './lib/rumConfig'

const app = createApp(App)
const applicationHealth = installApplicationHealth(app, router)

// Explicit runtime opt-in also works with the standard prebuilt image.
const rum = readRumConfiguration()
if (rum.enabled) {
  // @ts-ignore
  import('@rushobservability/rum-sdk').then(({ RushRUM }) => {
    RushRUM.init({
      endpoint: rum.endpoint,
      app: {
        name: rum.appName,
        version: rum.appVersion,
      },
      environment: rum.environment,
      sampleRate: 1.0,
      trackWebVitals: true,
      trackErrors: true,
      trackInteractions: true,
      trackResources: false,
      trackPageViews: true,
      captureQueryParams: false,
      maskInteractionText: true,
      trackSessionReplay: false,
      beforeSend: sanitizeRumEvent,
    })
    RushRUM.trackEvent('frontend_started', {
      startup_duration_ms: Math.round(performance.now()),
    })
    // Aggregate request-cache outcomes into one low-volume RUM event. Semantic
    // request keys and query text never enter telemetry attributes.
    setOperationalMetricSink((name, attributes) => RushRUM.trackEvent(name, attributes))
    setAnalyticsRequestMetricSink(counts => {
      RushRUM.trackEvent('query_request_cache', {
        cache_hits: counts.hit,
        fresh_hits: counts.fresh_hit,
        stale_hits: counts.stale_hit,
        revalidation_failures: counts.revalidation_failure,
        oversized_bypasses: counts.oversized_bypass,
        cache_entries: counts.entries,
        cache_bytes: counts.bytes,
        in_flight: counts.inFlight,
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
      flushOperationalMetrics()
      RushRUM.flush()
    }, { once: true })
    applicationHealth.rumReady()
    console.log('[Rush RUM] SDK initialized')
  }).catch((err) => {
    console.warn('[Rush RUM] Failed to load SDK:', err)
  })
}

// The SDK chunk shares Vite helpers with this module. Let module evaluation finish
// before booting: an uncaught mount error must not invalidate that dependency.
queueMicrotask(() => {
  try {
    app.use(router)
    app.mount('#app')
  } catch (error) {
    applicationHealth.bootstrapFailed(error)
    throw error
  }
})
