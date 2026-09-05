<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { straightLinePath, straightAreaPath, type Pt } from '../lib/chart'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import { useAuth } from '../composables/useAuth'
import type { Slo, SloEvent, NotificationChannel, TimeseriesBucket } from '../types'
import SloForm from '../components/SloForm.vue'
import { PanelCard, StatPanel, TimeSeriesPanel } from '../components/panels'
import type { PanelTone, TimeSeriesPanelSeries } from '../components/panels'
import { usePollingTask } from '../composables/usePollingTask'
import { buildAvailabilityChartPoints, intervalSeconds } from '../lib/sloCharts'

const props = defineProps<{ sloId: string }>()
const router = useRouter()
const api = useApi()
const { features } = useFeatures()
const { canWrite } = useAuth()

const slo = ref<Slo | null>(null)
const events = ref<SloEvent[]>([])
const channels = ref<NotificationChannel[]>([])
const loading = ref(true)
const showEdit = ref(false)
const showDeleteConfirm = ref(false)
const formError = ref<string | null>(null)

// ── Chart data ──
const chartBuckets = ref<TimeseriesBucket[]>([])
const errorChartBuckets = ref<TimeseriesBucket[]>([])
const chartBucketSeconds = ref(60)
const chartLoading = ref(false)
const chartError = ref<string | null>(null)

// Live refresh: the SLO engine re-evaluates on its interval, so poll for updated
// error/total counts and budget instead of leaving the page frozen at load time.
const refreshLoop = usePollingTask({
  category: 'slo_detail',
  intervalMs: 20_000,
  run: async ({ signal }) => {
    if (showEdit.value) return
    await Promise.all([pollSlo(true, signal), loadChartData(true, signal)])
  },
})

onMounted(async () => {
  await Promise.all([loadSlo(), loadChannels()])
  loading.value = false
  if (slo.value) loadChartData()
  refreshLoop.start()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  refreshLoop.stop()
  window.removeEventListener('keydown', onKeydown)
})

// Silent background refresh of the SLO numbers — unlike loadSlo() it does NOT
// redirect away on a transient fetch error during polling.
async function pollSlo(rethrow = false, signal?: AbortSignal) {
  try {
    const res = await api.getSlo(props.sloId, signal)
    slo.value = res.slo
    events.value = res.events || []
  } catch (error) {
    if (signal?.aborted) return
    if (rethrow) throw error
  }
}

async function loadSlo() {
  try {
    const res = await api.getSlo(props.sloId)
    slo.value = res.slo
    events.value = res.events || []
  } catch {
    router.replace('/slos')
  }
}

async function loadChannels() {
  try {
    const res = await api.listChannels()
    channels.value = res.channels
  } catch { /* noop */ }
}

async function loadChartData(rethrow = false, signal?: AbortSignal) {
  if (!slo.value) return
  if (!rethrow) {
    chartLoading.value = true
    chartError.value = null
  }
  try {
    const windowMins = windowMinutes(slo.value.window_type)
    const now = new Date()
    const from = new Date(now.getTime() - windowMins * 60 * 1000).toISOString()
    const to = now.toISOString()
    // Pick interval based on window size
    const interval = windowMins <= 60 ? '1m' : windowMins <= 1440 ? '5m' : windowMins <= 10080 ? '30m' : '1h'
    chartBucketSeconds.value = intervalSeconds(interval)
    const totalRequest = api.queryTimeseries({
      time_range: { from, to },
      filters: slo.value.total_filters.length ? slo.value.total_filters : [],
      interval,
    }, 'dashboard', signal)
    const errorRequest = slo.value.indicator_type === 'availability' && slo.value.error_filters.length > 0
      ? api.queryTimeseries({
          time_range: { from, to },
          filters: slo.value.error_filters,
          interval,
        }, 'dashboard', signal)
      : Promise.resolve(null)
    const [totalResponse, errorResponse] = await Promise.all([totalRequest, errorRequest])
    chartBuckets.value = (totalResponse.buckets || []) as TimeseriesBucket[]
    errorChartBuckets.value = (errorResponse?.buckets || []) as TimeseriesBucket[]
  } catch (error) {
    if (signal?.aborted) return
    if (!rethrow) {
      chartBuckets.value = []
      errorChartBuckets.value = []
      chartError.value = error instanceof Error ? error.message : 'SLO chart data is unavailable.'
    }
    if (rethrow) throw error
  } finally {
    if (!rethrow) chartLoading.value = false
  }
}

async function updateSlo(data: Record<string, unknown>) {
  formError.value = null
  try {
    await api.updateSlo(props.sloId, data)
    showEdit.value = false
    await loadSlo()
    loadChartData()
  } catch (e: any) {
    formError.value = e.message || 'Failed to update SLO'
  }
}

async function deleteSlo() {
  try {
    await api.deleteSlo(props.sloId)
    router.replace('/slos')
  } catch { /* noop */ }
}

// ── Computed ──

const successRate = computed(() => {
  if (!slo.value || slo.value.error_count === null || slo.value.total_count === null || slo.value.total_count === 0) return null
  return ((slo.value.total_count - slo.value.error_count) / slo.value.total_count) * 100
})

const successRateStr = computed(() => {
  if (successRate.value === null) return '-'
  return successRate.value.toFixed(3)
})

const budgetPct = computed(() => {
  if (!slo.value || slo.value.error_budget_remaining === null) return 0
  const errorBudget = 1 - slo.value.target_percentage / 100
  if (errorBudget <= 0) return 0
  return Math.max(0, Math.min(100, (slo.value.error_budget_remaining / errorBudget) * 100))
})

const budgetSeverity = computed(() => {
  if (!slo.value || slo.value.error_budget_remaining === null) return 'none'
  if (budgetPct.value > 50) return 'healthy'
  if (budgetPct.value > 10) return 'warning'
  return 'critical'
})

const sloSourceLabel = computed(() => slo.value?.slo_type === 'metric' ? 'Metrics' : 'Spans')
const sloRangeLabel = computed(() => slo.value ? windowLabel(slo.value.window_type) : '')
const isTraceLatencySlo = computed(() => slo.value?.slo_type === 'trace' && slo.value.indicator_type === 'latency')
const isAvailabilitySlo = computed(() => slo.value?.indicator_type === 'availability')
const latencyThresholdMs = computed(() => isTraceLatencySlo.value ? slo.value?.threshold_ms ?? null : null)
const sloSuccessDescription = computed(() => {
  if (isTraceLatencySlo.value && latencyThresholdMs.value !== null) {
    return `Requests completed at or below the ${latencyThresholdMs.value} ms latency limit.`
  }
  return 'Successful requests as a percentage of evaluated requests.'
})
const requestCountDescription = computed(() => {
  if (isTraceLatencySlo.value && latencyThresholdMs.value !== null) {
    return `Slow and total requests evaluated against the ${latencyThresholdMs.value} ms latency limit.`
  }
  return 'Error and total requests evaluated for the current SLO window.'
})
const badRequestLabel = computed(() => isTraceLatencySlo.value ? 'Over limit' : 'Errors')
const sloPanelTone = computed<PanelTone>(() => slo.value?.state === 'breaching' ? 'danger' : slo.value?.state === 'compliant' ? 'positive' : 'default')
const budgetPanelTone = computed<PanelTone>(() => budgetSeverity.value === 'critical' ? 'danger' : budgetSeverity.value === 'warning' ? 'warning' : budgetSeverity.value === 'healthy' ? 'positive' : 'default')

function windowMinutes(wt: string): number {
  switch (wt) {
    case 'rolling_1h': return 60
    case 'rolling_24h': return 1440
    case 'rolling_7d': return 10080
    case 'rolling_30d': return 43200
    default: return 1440
  }
}

function windowLabel(wt: string): string {
  switch (wt) {
    case 'rolling_1h': return '1h'
    case 'rolling_24h': return '24h'
    case 'rolling_7d': return '7d'
    case 'rolling_30d': return '30d'
    default: return wt
  }
}

function formatDate(ts: string | null): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function stateLabel(s: string): string {
  if (s === 'breaching') return 'Breaching'
  if (s === 'compliant') return 'Compliant'
  return 'No Data'
}

function evalIntervalLabel(secs: number): string {
  if (secs < 60) return `${secs}s`
  return `${secs / 60}m`
}

function thresholdOpLabel(op: string | null): string {
  switch (op) {
    case 'lt': return '<'
    case 'lte': return '≤'
    case 'gt': return '>'
    case 'gte': return '≥'
    default: return '<'
  }
}

// ── Chart helpers ──

const CW = 600
const CH = 180
const pad = { top: 8, right: 8, bottom: 20, left: 44 }
const innerW = CW - pad.left - pad.right
const innerH = CH - pad.top - pad.bottom

// Chart geometry — the inline panels use `geoSmall`; the expand-modal renders
// the same series with `geoLarge` (taller aspect + more breathing room).
interface Geo { W: number; H: number; pad: { top: number; right: number; bottom: number; left: number }; innerW: number; innerH: number }
const geoSmall: Geo = { W: CW, H: CH, pad, innerW, innerH }
const LPAD = { top: 18, right: 64, bottom: 34, left: 60 }
const LW = 960
const LH = 420
const geoLarge: Geo = { W: LW, H: LH, pad: LPAD, innerW: LW - LPAD.left - LPAD.right, innerH: LH - LPAD.top - LPAD.bottom }

const chartHover = ref<{ idx: number } | null>(null)

// ── Expand-to-modal ──
type ChartKey = 'rate' | 'error' | 'sli' | 'avg' | 'p50' | 'p95' | 'p99'
const expanded = ref<ChartKey | null>(null)
const chartKeys = computed<ChartKey[]>(() => (
  isTraceLatencySlo.value ? ['avg', 'p50', 'p95', 'p99'] : ['rate', 'error', 'sli']
))

interface ChartDef {
  key: ChartKey
  title: string
  values: number[]
  color: string
  lineClass: string
  maxVal?: number
  tickFixed?: number
  tickSuffix: string
  minVal?: number
  referenceValue?: number
  referenceLabel?: string
  referenceClass?: string
  fmtVal: (v: number) => string
}

const chartDefs = computed<Record<ChartKey, ChartDef>>(() => ({
  rate: {
    key: 'rate', title: 'Request Rate', values: rateValues.value,
    color: 'var(--amber)', lineClass: 'sd-c-rate', tickFixed: 1, tickSuffix: ' req/s',
    fmtVal: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} req/s`,
  },
  error: {
    key: 'error', title: 'Error Rate', values: errorValues.value,
    color: 'var(--error)', lineClass: 'sd-c-error', tickFixed: 2, tickSuffix: '%',
    maxVal: Math.max(...errorValues.value, 0.01) * 1.08,
    fmtVal: (v) => `${v.toFixed(3)}%`,
  },
  sli: {
    key: 'sli', title: 'SLO', values: sliValues.value,
    color: 'var(--ok)', lineClass: 'sd-c-sli', maxVal: 100, tickFixed: 1, tickSuffix: '%',
    minVal: sliChartMin.value,
    referenceValue: slo.value?.target_percentage,
    referenceLabel: `${slo.value?.target_percentage ?? 0}% target`,
    fmtVal: (v) => `${v.toFixed(2)}%`,
  },
  avg: latencyChartDef('avg', 'Average Latency', averageLatencyValues.value),
  p50: latencyChartDef('p50', 'P50 Latency', p50Values.value),
  p95: latencyChartDef('p95', 'P95 Latency', p95Values.value),
  p99: latencyChartDef('p99', 'P99 Latency', p99Values.value),
}))

const expandedDef = computed<ChartDef | null>(() => (expanded.value ? chartDefs.value[expanded.value] : null))

function openChart(key: ChartKey) {
  chartHover.value = null
  expanded.value = key
}
function closeChart() {
  expanded.value = null
  chartHover.value = null
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && expanded.value) closeChart()
}

const availabilityChartPoints = computed(() => buildAvailabilityChartPoints(
  chartBuckets.value,
  errorChartBuckets.value,
  chartBucketSeconds.value,
))
const rateValues = computed(() => isAvailabilitySlo.value
  ? availabilityChartPoints.value.map(point => point.requestsPerSecond)
  : chartBuckets.value.map(bucket => bucket.count / chartBucketSeconds.value))
const errorValues = computed(() => isAvailabilitySlo.value
  ? availabilityChartPoints.value.map(point => point.errorRate)
  : chartBuckets.value.map(bucket => bucket.count > 0 ? (bucket.error_count / bucket.count) * 100 : 0))
const averageLatencyValues = computed(() => chartBuckets.value.map(b => b.avg_duration_ms))
const p50Values = computed(() => chartBuckets.value.map(b => b.p50_ms))
const p95Values = computed(() => chartBuckets.value.map(b => b.p95_ms))
const p99Values = computed(() => chartBuckets.value.map(b => b.p99_ms))
const sliValues = computed(() => isAvailabilitySlo.value
  ? availabilityChartPoints.value.map(point => point.successRate)
  : chartBuckets.value.map((bucket) => {
      if (bucket.count === 0) return 100
      return ((bucket.count - bucket.error_count) / bucket.count) * 100
    }))
const sliChartMin = computed(() => {
  const values = sliValues.value
  const floor = Math.min(...values, slo.value?.target_percentage ?? 100)
  return Math.max(0, Math.floor((floor - 0.1) * 10) / 10)
})

function latencyChartDef(key: 'avg' | 'p50' | 'p95' | 'p99', title: string, values: number[]): ChartDef {
  const threshold = latencyThresholdMs.value ?? 0
  return {
    key,
    title,
    values,
    color: key === 'avg' ? '#3b82f6' : key === 'p50' ? 'var(--ok)' : key === 'p95' ? 'var(--amber)' : 'var(--error)',
    lineClass: `sd-c-${key}`,
    maxVal: Math.max(...values, threshold, 1) * 1.08,
    tickFixed: 0,
    tickSuffix: 'ms',
    referenceValue: threshold || undefined,
    referenceLabel: threshold ? `${threshold} ms limit` : undefined,
    referenceClass: 'sd-latency-limit',
    fmtVal: (v) => `${v.toFixed(v < 10 ? 1 : 0)} ms`,
  }
}

function parseBucketUtc(bucket: string): number {
  const iso = bucket.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z'
  return new Date(iso).getTime()
}

function chartPanelSeries(def: ChartDef): TimeSeriesPanelSeries[] {
  const points = chartBuckets.value
    .map((bucket, index) => [parseBucketUtc(bucket.bucket) / 1000, def.values[index] ?? 0] as [number, number])
    .filter(([timestamp, value]) => Number.isFinite(timestamp) && Number.isFinite(value))
  return [{
    name: def.title,
    points,
    color: def.color,
    legendValue: points.length ? points[points.length - 1]![1] : undefined,
  }]
}

function chartCaption(key: ChartKey): string {
  if (key === 'avg') return latencyCaption('Mean latency across every matching request')
  if (key === 'p50') return latencyCaption('Median response latency')
  if (key === 'p95') return latencyCaption('95% of requests completed at or below this latency')
  if (key === 'p99') return latencyCaption('99% of requests completed at or below this latency')
  if (key === 'rate') return 'Average requests per second in each chart bucket.'
  if (key === 'error') return 'Share of requests matching this SLO\'s error filters.'
  return 'Success percentage compared with the configured SLO target.'
}

function latencyCaption(prefix: string): string {
  const threshold = latencyThresholdMs.value
  return threshold === null
    ? `${prefix}.`
    : `${prefix}. The dashed line marks the ${threshold} ms SLO limit.`
}

function valuesToPoints(values: number[], maxVal?: number, geo: Geo = geoSmall, minVal = 0): Pt[] {
  const mx = maxVal ?? Math.max(...values, 1)
  const range = Math.max(mx - minVal, Number.EPSILON)
  const stepX = geo.innerW / Math.max(values.length - 1, 1)
  return values.map((v, i) => [
    geo.pad.left + i * stepX,
    geo.pad.top + geo.innerH - (((v ?? minVal) - minVal) / range) * geo.innerH,
  ] as Pt)
}

function areaPath(values: number[], maxVal?: number, geo: Geo = geoSmall, minVal = 0): string {
  if (!values.length) return ''
  return straightAreaPath(valuesToPoints(values, maxVal, geo, minVal), geo.pad.top + geo.innerH)
}

function linePath(values: number[], maxVal?: number, geo: Geo = geoSmall, minVal = 0): string {
  if (!values.length) return ''
  return straightLinePath(valuesToPoints(values, maxVal, geo, minVal))
}

function yTicks(values: number[], fixed?: number, geo: Geo = geoSmall, maxVal?: number, minVal = 0): Array<{ label: string; y: number }> {
  const mx = maxVal ?? Math.max(...values, 1)
  return [0, 0.5, 1].map(s => ({
    label: fixed !== undefined ? (minVal + (mx - minVal) * s).toFixed(fixed) : fmtCompact(minVal + (mx - minVal) * s),
    y: geo.pad.top + geo.innerH - s * geo.innerH,
  }))
}

function xLabels(geo: Geo = geoSmall): Array<{ label: string; x: number }> {
  const b = chartBuckets.value
  if (b.length < 2) return []
  const stepX = geo.innerW / Math.max(b.length - 1, 1)
  const skip = Math.max(1, Math.floor(b.length / 6))
  const labels: Array<{ label: string; x: number }> = []
  for (let i = 0; i < b.length; i += skip) {
    const d = new Date(parseBucketUtc(b[i]!.bucket))
    labels.push({
      label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      x: geo.pad.left + i * stepX,
    })
  }
  return labels
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(0)
  if (n > 0) return n.toFixed(2)
  return '0'
}

function hoverX(idx: number, total: number, geo: Geo = geoSmall): number {
  const stepX = geo.innerW / Math.max(total - 1, 1)
  return geo.pad.left + idx * stepX
}

function dotY(idx: number, values: number[], maxVal?: number, geo: Geo = geoSmall, minVal = 0): number {
  const mx = maxVal ?? Math.max(...values, 1)
  const range = Math.max(mx - minVal, Number.EPSILON)
  return geo.pad.top + geo.innerH - (((values[idx] ?? minVal) - minVal) / range) * geo.innerH
}

function chartMouseMove(e: MouseEvent, geo: Geo = geoSmall) {
  const svg = (e.currentTarget as SVGSVGElement)
  const rect = svg.getBoundingClientRect()
  const b = chartBuckets.value
  if (!b.length) return
  const mouseX = ((e.clientX - rect.left) / rect.width) * geo.W
  const stepX = geo.innerW / Math.max(b.length - 1, 1)
  const relX = mouseX - geo.pad.left
  const idx = Math.round(relX / stepX)
  if (idx >= 0 && idx < b.length) {
    chartHover.value = { idx }
  }
}

function chartMouseLeave() {
  chartHover.value = null
}

function hoverTime(): string {
  const b = chartBuckets.value
  const idx = chartHover.value?.idx
  if (idx === undefined || !b[idx]) return ''
  const d = new Date(parseBucketUtc(b[idx].bucket))
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const budgetBurning = computed(() => {
  if (!slo.value || slo.value.error_budget_remaining === null) return false
  return budgetPct.value < 20
})

const sloAnalyzeUrl = computed(() => {
  const to = new Date().toISOString()
  const from = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const params = new URLSearchParams({ bubbleup: '1', bu_from: from, bu_to: to })
  if (slo.value?.service_name) params.set('service', slo.value.service_name)
  return `/?${params.toString()}`
})

function investigateSlo() {
  const s = slo.value
  if (!s) return
  const ctx = [
    `SLO "${s.name}" is at ${successRateStr.value}% success rate`,
    `Target: ${s.target_percentage}%`,
    `Error budget remaining: ${budgetPct.value.toFixed(1)}%`,
    `Window: ${s.window_type}`,
    `Service: ${s.service_name || 'all'}`,
  ].join('\n')
  router.push({
    path: '/investigate',
    query: { q: `Investigate SLO degradation: ${s.name}`, ctx },
  })
}

function referenceLineY(def: ChartDef, geo: Geo = geoSmall): number {
  const scaleMax = def.maxVal ?? Math.max(...def.values, def.referenceValue ?? 0, 1)
  const scaleMin = def.minVal ?? 0
  const range = Math.max(scaleMax - scaleMin, Number.EPSILON)
  return geo.pad.top + geo.innerH - (((def.referenceValue ?? scaleMin) - scaleMin) / range) * geo.innerH
}
</script>

<template>
  <div class="sd-page" v-if="!loading && slo">
    <!-- Breadcrumb + actions -->
    <div class="sd-top">
      <div class="sd-breadcrumb">
        <router-link to="/slos" class="sd-back">SLOs</router-link>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="sd-crumb-name">{{ slo.name }}</span>
      </div>
      <div class="sd-actions" v-if="features.sre_agent || canWrite">
        <button v-if="features.sre_agent" class="btn-investigate" @click="investigateSlo">Investigate</button>
        <button v-if="canWrite" class="sd-action-btn" @click="showEdit = !showEdit">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9.5 1.5l2 2L4 11H2V9L9.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ showEdit ? 'Cancel' : 'Edit' }}
        </button>
        <button v-if="canWrite" class="sd-action-btn sd-action-danger" @click="showDeleteConfirm = true">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M4 4v7h5V4M5 2h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Delete
        </button>
      </div>
    </div>

    <!-- Edit form -->
    <div v-if="showEdit" class="sd-edit-wrap fade-in">
      <div v-if="formError" class="sd-form-error">{{ formError }}</div>
      <SloForm
        :slo="slo"
        :channels="channels"
        @save="updateSlo"
        @cancel="showEdit = false"
      />
    </div>

    <!-- Hero: State + SLI + Budget -->
    <div class="sd-hero" v-if="!showEdit">
      <PanelCard
        class="sd-hero-card"
        title="Status"
        description="Current compliance state reported by the SLO evaluator."
        :caption="slo.enabled ? 'Evaluation enabled.' : 'Evaluation disabled.'"
        source-label="SLO engine"
        variant="stat"
        :tone="sloPanelTone"
      >
        <div class="sd-state-row">
          <div class="sd-state-dot" :class="'sd-dot-' + slo.state"></div>
          <span class="sd-state-text" :class="'sd-text-' + slo.state">{{ stateLabel(slo.state) }}</span>
        </div>
      </PanelCard>

      <StatPanel
        v-if="successRate !== null"
        class="sd-hero-card sd-hero-sli"
        title="Current SLO"
        :description="sloSuccessDescription"
        :value="successRate"
        :precision="3"
        unit="%"
        :label="`Target ${slo.target_percentage}%`"
        :range-label="sloRangeLabel"
        :source-label="sloSourceLabel"
        :tone="sloPanelTone"
      />
      <PanelCard
        v-else
        class="sd-hero-card"
        title="Current SLO"
        :description="sloSuccessDescription"
        :empty="true"
        empty-title="No SLI data"
        empty-message="This SLO has not evaluated enough requests yet."
        variant="stat"
      />

      <StatPanel
        v-if="slo.error_budget_remaining !== null"
        class="sd-hero-card"
        title="Error Budget"
        description="Share of the configured error budget still available."
        :value="budgetPct"
        :precision="1"
        unit="%"
        :label="`${(slo.error_budget_remaining * 100).toFixed(3)}% raw budget`"
        :range-label="sloRangeLabel"
        :source-label="sloSourceLabel"
        :tone="budgetPanelTone"
      >
        <template #details>
          <div class="sd-budget-details">
            <div class="sd-budget-track" aria-hidden="true">
              <div class="sd-budget-fill" :class="'sd-budgetbar-' + budgetSeverity" :style="{ width: budgetPct + '%' }"></div>
            </div>
            <router-link v-if="budgetBurning" :to="sloAnalyzeUrl" class="btn-bubbleup">
              ⬡ Analyze with BubbleUp
            </router-link>
          </div>
        </template>
      </StatPanel>
      <PanelCard
        v-else
        class="sd-hero-card"
        title="Error Budget"
        description="Share of the configured error budget still available."
        :empty="true"
        empty-title="No budget data"
        empty-message="Budget will appear after the first successful evaluation."
        variant="stat"
      />

      <PanelCard
        class="sd-hero-card"
        title="Request Counts"
        :description="requestCountDescription"
        :range-label="sloRangeLabel"
        :source-label="sloSourceLabel"
        variant="stat"
      >
        <div class="sd-counts-grid">
          <div class="sd-count-item">
            <div class="sd-count-val mono sd-count-err">{{ slo.error_count !== null ? slo.error_count.toLocaleString() : '-' }}</div>
            <div class="sd-count-label">{{ badRequestLabel }}</div>
          </div>
          <div class="sd-count-item">
            <div class="sd-count-val mono">{{ slo.total_count !== null ? slo.total_count.toLocaleString() : '-' }}</div>
            <div class="sd-count-label">Total</div>
          </div>
        </div>
      </PanelCard>
    </div>

    <!-- ═══ Charts ═══ -->
    <div
      v-if="!showEdit && isTraceLatencySlo && latencyThresholdMs !== null"
      class="sd-latency-objective"
      role="note"
      :aria-label="`${slo.target_percentage}% of requests must complete at or below ${latencyThresholdMs} milliseconds`"
    >
      <span class="sd-latency-objective-label">Latency objective</span>
      <strong>{{ slo.target_percentage }}% of requests ≤ {{ latencyThresholdMs }} ms</strong>
      <span class="sd-latency-objective-key"><i aria-hidden="true"></i>Dashed line marks the slow-request limit</span>
    </div>
    <div
      class="sd-charts-row"
      :class="{
        'sd-charts-row--latency': isTraceLatencySlo,
        'sd-charts-row--availability': isAvailabilitySlo,
      }"
      v-if="!showEdit"
    >
      <TimeSeriesPanel
        v-for="key in chartKeys"
        :key="key"
        class="sd-chart-panel"
        :title="chartDefs[key].title"
        description="SLO evaluation trend for the current rolling window."
        :caption="chartCaption(key)"
        :source-label="sloSourceLabel"
        :range-label="sloRangeLabel"
        :series="chartPanelSeries(chartDefs[key])"
        :loading="chartLoading"
        :error="chartError"
        empty-title="No chart data"
        empty-message="This SLO has not produced time-series buckets for its current window."
      >
        <template #actions>
          <button
            type="button"
            class="sd-expand-btn"
            :aria-label="`Expand ${chartDefs[key].title} chart`"
            @click.stop="openChart(key)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M5 1H1v4M8 12h4V8M1 12l4.5-4.5M12 1L7.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </template>
        <div
          class="sd-chart-canvas"
          @click="openChart(key)"
        >
          <svg :viewBox="`0 0 ${CW} ${CH}`" class="ch-svg sd-chart-svg" @mousemove="chartMouseMove" @mouseleave="chartMouseLeave">
            <template v-for="tick in yTicks(chartDefs[key].values, chartDefs[key].tickFixed, geoSmall, chartDefs[key].maxVal, chartDefs[key].minVal)" :key="key + '-y-' + tick.label">
              <line :x1="pad.left" :y1="tick.y" :x2="CW - pad.right" :y2="tick.y" class="sd-grid-line ch-grid" />
              <text :x="pad.left - 4" :y="tick.y + 3" class="sd-axis-label ch-axis" text-anchor="end">{{ tick.label }}{{ chartDefs[key].tickSuffix }}</text>
            </template>
            <template v-for="lbl in xLabels()" :key="key + '-x-' + lbl.label">
              <line :x1="lbl.x" :y1="pad.top" :x2="lbl.x" :y2="CH - pad.bottom" class="ch-grid" />
              <text :x="lbl.x" :y="CH - 2" class="sd-axis-label ch-axis" text-anchor="middle">{{ lbl.label }}</text>
            </template>
            <template v-if="chartDefs[key].referenceValue !== undefined">
              <line :x1="pad.left" :y1="referenceLineY(chartDefs[key])" :x2="CW - pad.right" :y2="referenceLineY(chartDefs[key])" class="sd-target-line ch-threshold" :class="chartDefs[key].referenceClass" />
              <text :x="CW - pad.right - 3" :y="referenceLineY(chartDefs[key]) - 4" class="sd-target-label" :class="chartDefs[key].referenceClass" text-anchor="end">{{ chartDefs[key].referenceLabel }}</text>
            </template>
            <path :d="areaPath(chartDefs[key].values, chartDefs[key].maxVal, geoSmall, chartDefs[key].minVal)" class="ch-area" :style="{ color: chartDefs[key].color }" />
            <path :d="linePath(chartDefs[key].values, chartDefs[key].maxVal, geoSmall, chartDefs[key].minVal)" class="sd-line ch-line" :class="chartDefs[key].lineClass" />
            <template v-if="chartHover">
              <line :x1="hoverX(chartHover.idx, chartDefs[key].values.length)" :y1="pad.top" :x2="hoverX(chartHover.idx, chartDefs[key].values.length)" :y2="CH - pad.bottom" class="sd-hover-line" />
              <circle :cx="hoverX(chartHover.idx, chartDefs[key].values.length)" :cy="dotY(chartHover.idx, chartDefs[key].values, chartDefs[key].maxVal, geoSmall, chartDefs[key].minVal)" r="3" class="sd-hover-dot" :class="chartDefs[key].lineClass" />
            </template>
            <rect :x="pad.left" :y="pad.top" :width="innerW" :height="innerH" fill="transparent" style="cursor: crosshair" />
          </svg>
          <div v-if="chartHover" class="sd-tooltip" :style="{ left: (hoverX(chartHover.idx, chartDefs[key].values.length) / CW * 100) + '%' }">
            <div class="sd-tooltip-time">{{ hoverTime() }}</div>
            <div class="sd-tooltip-val">{{ chartDefs[key].fmtVal(chartDefs[key].values[chartHover.idx] ?? 0) }}</div>
          </div>
        </div>
      </TimeSeriesPanel>
    </div>

    <!-- Configuration -->
    <PanelCard
      v-if="!showEdit"
      class="sd-config-panel"
      title="SLO Configuration"
      description="Indicator, rolling window, evaluation cadence, and matching filters."
      :range-label="sloRangeLabel"
      :source-label="sloSourceLabel"
      caption="Configuration currently used by the SLO evaluator."
    >
      <div class="sd-config">
        <div class="sd-config-strip">
        <div class="sd-config-kv">
          <span class="sd-kv-k">Type</span>
          <span class="sv-type-badge" :class="slo.slo_type === 'metric' ? 'sv-type-metric' : 'sv-type-trace'">{{ slo.slo_type || 'trace' }}</span>
        </div>
        <span class="sd-config-sep"></span>
        <div class="sd-config-kv">
          <span class="sd-kv-k">Indicator</span>
          <span class="sv-type-badge sv-type-indicator">{{ slo.indicator_type || 'availability' }}</span>
        </div>
        <span class="sd-config-sep"></span>
        <div class="sd-config-kv" v-if="slo.slo_type === 'metric' && slo.metric_name">
          <span class="sd-kv-k">Metric</span>
          <span class="sd-kv-v mono">{{ slo.metric_name }}</span>
        </div>
        <span class="sd-config-sep" v-if="slo.slo_type === 'metric' && slo.metric_name"></span>
        <div class="sd-config-kv" v-if="slo.indicator_type === 'latency' && slo.threshold_ms">
          <span class="sd-kv-k">Threshold</span>
          <span class="sd-kv-v mono">{{ slo.threshold_ms }}ms</span>
        </div>
        <span class="sd-config-sep" v-if="slo.indicator_type === 'latency' && slo.threshold_ms"></span>
        <div class="sd-config-kv" v-if="slo.indicator_type === 'threshold' && slo.threshold_value !== null">
          <span class="sd-kv-k">Gauge</span>
          <span class="sd-kv-v mono">{{ thresholdOpLabel(slo.threshold_op) }} {{ slo.threshold_value }}</span>
        </div>
        <span class="sd-config-sep" v-if="slo.indicator_type === 'threshold' && slo.threshold_value !== null"></span>
        <div class="sd-config-kv">
          <span class="sd-kv-k">Window</span>
          <span class="sd-kv-v mono">{{ windowLabel(slo.window_type) }}</span>
        </div>
        <span class="sd-config-sep"></span>
        <div class="sd-config-kv">
          <span class="sd-kv-k">Eval</span>
          <span class="sd-kv-v mono">{{ evalIntervalLabel(slo.eval_interval_secs) }}</span>
        </div>
        <span class="sd-config-sep"></span>
        <div class="sd-config-kv">
          <span class="sd-kv-k">Last eval</span>
          <span class="sd-kv-v mono">{{ formatDate(slo.last_eval_at) }}</span>
        </div>
        <template v-if="slo.last_breached_at">
          <span class="sd-config-sep"></span>
          <div class="sd-config-kv">
            <span class="sd-kv-k">Last breach</span>
            <span class="sd-kv-v mono sd-text-breaching">{{ formatDate(slo.last_breached_at) }}</span>
          </div>
        </template>
        </div>

        <!-- Filters -->
        <div class="sd-filters-row" v-if="slo.error_filters.length > 0 || slo.total_filters.length > 0">
          <div class="sd-filter-group" v-if="slo.error_filters.length > 0">
            <span class="sd-filter-badge sd-badge-error">error</span>
            <span v-for="(f, i) in slo.error_filters" :key="'e'+i" class="sd-filter-chip mono">
              {{ f.field }} {{ f.op }} {{ f.value }}
            </span>
          </div>
          <div class="sd-filter-group" v-if="slo.total_filters.length > 0">
            <span class="sd-filter-badge sd-badge-total">total</span>
            <span v-for="(f, i) in slo.total_filters" :key="'t'+i" class="sd-filter-chip mono">
              {{ f.field }} {{ f.op }} {{ f.value }}
            </span>
          </div>
        </div>
      </div>
    </PanelCard>

    <!-- Events Timeline -->
    <PanelCard
      v-if="!showEdit"
      class="sd-section-panel"
      title="Event History"
      description="Compliance state transitions recorded by the SLO evaluator."
      caption="Newest state transitions for this SLO."
      source-label="SLO events"
      :empty="events.length === 0"
      empty-title="No state changes yet"
      empty-message="Transitions will appear after this SLO first changes compliance state."
    >
      <template #actions>
        <span class="sd-event-count mono">{{ events.length }}</span>
      </template>
      <div class="sd-timeline">
        <div
          v-for="ev in events"
          :key="ev.id"
          class="sd-timeline-item"
        >
          <div class="sd-timeline-rail">
            <div class="sd-timeline-dot" :class="'sd-dot-' + ev.state"></div>
            <div class="sd-timeline-line"></div>
          </div>
          <div class="sd-timeline-content">
            <div class="sd-timeline-header">
              <span class="sd-timeline-state" :class="'sd-text-' + ev.state">{{ stateLabel(ev.state) }}</span>
              <span class="sd-timeline-time mono">{{ formatDate(ev.created_at) }}</span>
            </div>
            <div class="sd-timeline-msg mono">{{ ev.message }}</div>
            <div class="sd-timeline-meta mono">
              {{ ev.error_count.toLocaleString() }} {{ isTraceLatencySlo ? 'over limit' : 'errors' }} / {{ ev.total_count.toLocaleString() }} total
              &middot; budget {{ (ev.error_budget_remaining * 100).toFixed(3) }}%
            </div>
          </div>
        </div>
      </div>
    </PanelCard>

    <!-- Expanded chart modal -->
    <Teleport to="body">
      <Transition name="sd-modal">
        <div v-if="expandedDef" class="sd-chart-modal-backdrop" @click.self="closeChart">
          <div class="sd-chart-modal">
            <div class="sd-chart-modal-head">
              <div class="sd-chart-modal-title">
                {{ expandedDef.title }}
                <span class="sd-chart-modal-sub mono">{{ slo.name }} &middot; {{ windowLabel(slo.window_type) }}</span>
              </div>
              <button class="sd-chart-modal-close" @click="closeChart" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div class="sd-chart-modal-body">
              <svg :viewBox="`0 0 ${LW} ${LH}`" class="ch-svg sd-chart-modal-svg" @mousemove="(e) => chartMouseMove(e, geoLarge)" @mouseleave="chartMouseLeave">
                <!-- Y grid + labels -->
                <template v-for="tick in yTicks(expandedDef.values, expandedDef.tickFixed, geoLarge, expandedDef.maxVal, expandedDef.minVal)" :key="'my'+tick.label">
                  <line :x1="LPAD.left" :y1="tick.y" :x2="LW - LPAD.right" :y2="tick.y" class="ch-grid" />
                  <text :x="LPAD.left - 8" :y="tick.y + 4" class="ch-axis" text-anchor="end">{{ tick.label }}{{ expandedDef.tickSuffix }}</text>
                </template>
                <!-- X grid + labels -->
                <template v-for="lbl in xLabels(geoLarge)" :key="'mx'+lbl.label">
                  <line :x1="lbl.x" :y1="LPAD.top" :x2="lbl.x" :y2="LH - LPAD.bottom" class="ch-grid" />
                  <text :x="lbl.x" :y="LH - 10" class="ch-axis" text-anchor="middle">{{ lbl.label }}</text>
                </template>
                <!-- SLO target or latency limit -->
                <template v-if="expandedDef.referenceValue !== undefined">
                  <line :x1="LPAD.left" :y1="referenceLineY(expandedDef, geoLarge)" :x2="LW - LPAD.right" :y2="referenceLineY(expandedDef, geoLarge)" class="sd-target-line ch-threshold" :class="expandedDef.referenceClass" />
                  <text :x="LW - LPAD.right - 5" :y="referenceLineY(expandedDef, geoLarge) - 6" class="sd-target-label" :class="expandedDef.referenceClass" text-anchor="end">{{ expandedDef.referenceLabel }}</text>
                </template>
                <!-- Series -->
                <path :d="areaPath(expandedDef.values, expandedDef.maxVal, geoLarge, expandedDef.minVal)" class="ch-area" :style="{ color: expandedDef.color }" />
                <path :d="linePath(expandedDef.values, expandedDef.maxVal, geoLarge, expandedDef.minVal)" class="sd-line ch-line" :class="expandedDef.lineClass" />
                <!-- Hover -->
                <template v-if="chartHover">
                  <line :x1="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :y1="LPAD.top" :x2="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :y2="LH - LPAD.bottom" class="sd-hover-line" />
                  <circle :cx="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :cy="dotY(chartHover.idx, expandedDef.values, expandedDef.maxVal, geoLarge, expandedDef.minVal)" r="4" class="sd-hover-dot" :class="expandedDef.lineClass" />
                </template>
                <rect :x="LPAD.left" :y="LPAD.top" :width="geoLarge.innerW" :height="geoLarge.innerH" fill="transparent" style="cursor: crosshair" />
              </svg>
              <div v-if="chartHover" class="sd-chart-modal-tip" :style="{ left: (hoverX(chartHover.idx, expandedDef.values.length, geoLarge) / LW * 100) + '%' }">
                <div class="sd-tooltip-time">{{ hoverTime() }}</div>
                <div class="sd-tooltip-val">{{ expandedDef.fmtVal(expandedDef.values[chartHover.idx] ?? 0) }}</div>
              </div>
            </div>
            <div class="sd-chart-modal-hint mono">Esc or click outside to close</div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirm modal -->
    <Teleport to="body">
      <Transition name="sd-modal">
        <div v-if="showDeleteConfirm" class="sd-modal-backdrop" @click.self="showDeleteConfirm = false">
          <div class="sd-modal">
            <div class="sd-modal-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="sd-modal-title">Delete SLO</div>
            <div class="sd-modal-body">
              Are you sure you want to delete <strong>{{ slo.name }}</strong>? This will remove all associated events and cannot be undone.
            </div>
            <div class="sd-modal-actions">
              <button class="sd-modal-btn sd-modal-cancel" @click="showDeleteConfirm = false">Cancel</button>
              <button class="sd-modal-btn sd-modal-delete" @click="deleteSlo">Delete SLO</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>

  <!-- Loading -->
  <PanelCard
    v-else-if="loading"
    class="sd-loading-panel"
    title="SLO details"
    description="Loading SLO status, budget, charts, and history."
    :loading="true"
  />
</template>

<style scoped src="../styles/views/SloDetailView.css"></style>
