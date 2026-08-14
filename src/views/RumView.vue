<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { RumAppEntry, RumVitalsSummary, Filter } from '../types'

const router = useRouter()
const api = useApi()

const apps = ref<RumAppEntry[]>([])
const appVitals = ref<Record<string, RumVitalsSummary[]>>({})
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await api.rumApps()
    apps.value = res.apps

    // Fetch vitals for each app in parallel (1h window)
    const now = new Date()
    const from = new Date(now.getTime() - 60 * 60 * 1000)
    const timeRange = { from: from.toISOString(), to: now.toISOString() }

    await Promise.all(apps.value.map(async (app) => {
      try {
        const filters: Filter[] = [{ field: 'AppName', op: '=', value: app.AppName }]
        const vRes = await api.rumVitals({ time_range: timeRange, filters })
        appVitals.value[app.AppName] = vRes.vitals
      } catch { /* skip */ }
    }))
  } catch { /* empty state */ }
  loading.value = false
})

function openApp(app: RumAppEntry) {
  router.push(`/rum/${encodeURIComponent(app.AppName)}`)
}

function getVital(appName: string, vitalName: string): RumVitalsSummary | undefined {
  return appVitals.value[appName]?.find(v => v.VitalName === vitalName)
}

function formatVitalValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3)
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  return `${value.toFixed(0)}ms`
}

function vitalRating(name: string, value: number): string {
  const thresholds: Record<string, { good: number; poor: number }> = {
    LCP: { good: 2500, poor: 4000 },
    CLS: { good: 0.1, poor: 0.25 },
    INP: { good: 200, poor: 500 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
  }
  const t = thresholds[name] || { good: 100, poor: 300 }
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs-improvement'
  return 'poor'
}

function humanize(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return n.toString()
}

const totalEvents = computed(() => apps.value.reduce((s, a) => s + a.cnt, 0))
</script>

<template>
  <div class="sv-page">
    <!-- Header -->
    <div class="sv-header">
      <div class="sv-header-left">
        <h2 class="sv-title">Real User Monitoring</h2>
        <div class="sv-summary" v-if="apps.length > 0">
          <span class="sv-pill sv-pill-ok">{{ apps.length }} {{ apps.length === 1 ? 'app' : 'apps' }}</span>
          <span class="sv-pill sv-pill-muted">{{ humanize(totalEvents) }} events</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="sv-loading">
      <div class="sv-loading-bar"></div>
    </div>

    <!-- Empty State -->
    <div v-else-if="apps.length === 0" class="sv-empty card">
      <div class="sv-empty-diamond">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M14 2L26 14L14 26L2 14Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M14 8L20 14L14 20L8 14Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.4"/>
        </svg>
      </div>
      <div class="sv-empty-title">No RUM data yet</div>
      <div class="sv-empty-sub">Install the @rushobservability/rum-sdk SDK in your app to start collecting browser telemetry</div>
    </div>

    <!-- App Table -->
    <div class="sv-table card" v-else>
      <!-- Column headers -->
      <div class="sv-thead">
        <div class="sv-th sv-col-name">Application</div>
        <div class="sv-th sv-col-events">Events</div>
        <div class="sv-th sv-col-vital">LCP</div>
        <div class="sv-th sv-col-vital">CLS</div>
        <div class="sv-th sv-col-vital">INP</div>
        <div class="sv-th sv-col-vital">FCP</div>
        <div class="sv-th sv-col-vital">TTFB</div>
        <div class="sv-th sv-col-arrow"></div>
      </div>

      <!-- Rows -->
      <div
        v-for="(app, idx) in apps"
        :key="app.AppName"
        class="sv-row"
        :style="{ animationDelay: idx * 30 + 'ms' }"
        @click="openApp(app)"
      >
        <!-- State rail -->
        <div class="sv-row-rail sv-rail-app"></div>

        <!-- App name -->
        <div class="sv-cell sv-col-name">
          <div class="sv-name-primary">{{ app.AppName }}</div>
        </div>

        <!-- Events -->
        <div class="sv-cell sv-col-events">
          <span class="sv-events-value mono">{{ humanize(app.cnt) }}</span>
        </div>

        <!-- LCP -->
        <div class="sv-cell sv-col-vital">
          <template v-if="getVital(app.AppName, 'LCP')">
            <span class="sv-vital-value mono" :class="'sv-vital-' + vitalRating('LCP', getVital(app.AppName, 'LCP')!.p75)">
              {{ formatVitalValue('LCP', getVital(app.AppName, 'LCP')!.p75) }}
            </span>
          </template>
          <span v-else class="sv-vital-empty">&mdash;</span>
        </div>

        <!-- CLS -->
        <div class="sv-cell sv-col-vital">
          <template v-if="getVital(app.AppName, 'CLS')">
            <span class="sv-vital-value mono" :class="'sv-vital-' + vitalRating('CLS', getVital(app.AppName, 'CLS')!.p75)">
              {{ formatVitalValue('CLS', getVital(app.AppName, 'CLS')!.p75) }}
            </span>
          </template>
          <span v-else class="sv-vital-empty">&mdash;</span>
        </div>

        <!-- INP -->
        <div class="sv-cell sv-col-vital">
          <template v-if="getVital(app.AppName, 'INP')">
            <span class="sv-vital-value mono" :class="'sv-vital-' + vitalRating('INP', getVital(app.AppName, 'INP')!.p75)">
              {{ formatVitalValue('INP', getVital(app.AppName, 'INP')!.p75) }}
            </span>
          </template>
          <span v-else class="sv-vital-empty">&mdash;</span>
        </div>

        <!-- FCP -->
        <div class="sv-cell sv-col-vital">
          <template v-if="getVital(app.AppName, 'FCP')">
            <span class="sv-vital-value mono" :class="'sv-vital-' + vitalRating('FCP', getVital(app.AppName, 'FCP')!.p75)">
              {{ formatVitalValue('FCP', getVital(app.AppName, 'FCP')!.p75) }}
            </span>
          </template>
          <span v-else class="sv-vital-empty">&mdash;</span>
        </div>

        <!-- TTFB -->
        <div class="sv-cell sv-col-vital">
          <template v-if="getVital(app.AppName, 'TTFB')">
            <span class="sv-vital-value mono" :class="'sv-vital-' + vitalRating('TTFB', getVital(app.AppName, 'TTFB')!.p75)">
              {{ formatVitalValue('TTFB', getVital(app.AppName, 'TTFB')!.p75) }}
            </span>
          </template>
          <span v-else class="sv-vital-empty">&mdash;</span>
        </div>

        <!-- Row arrow -->
        <div class="sv-cell sv-col-arrow">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="sv-arrow-icon"><path d="M3.5 2l4 3-4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/RumView.css"></style>
