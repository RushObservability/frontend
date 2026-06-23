<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { straightLinePath, straightAreaPath, type Pt } from '../lib/chart'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import { useAuth } from '../composables/useAuth'
import type { Slo, SloEvent, NotificationChannel, TimeseriesBucket } from '../types'
import SloForm from '../components/SloForm.vue'

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
const chartLoading = ref(false)

// Live refresh: the SLO engine re-evaluates on its interval, so poll for updated
// error/total counts and budget instead of leaving the page frozen at load time.
let refreshTimer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  await Promise.all([loadSlo(), loadChannels()])
  loading.value = false
  if (slo.value) loadChartData()
  refreshTimer = setInterval(() => {
    if (showEdit.value) return // don't clobber the edit form mid-edit
    pollSlo()
    loadChartData()
  }, 20000)
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('keydown', onKeydown)
})

// Silent background refresh of the SLO numbers — unlike loadSlo() it does NOT
// redirect away on a transient fetch error during polling.
async function pollSlo() {
  try {
    const res = await api.getSlo(props.sloId)
    slo.value = res.slo
    events.value = res.events || []
  } catch { /* ignore transient errors during polling */ }
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

async function loadChartData() {
  if (!slo.value) return
  chartLoading.value = true
  try {
    const windowMins = windowMinutes(slo.value.window_type)
    const now = new Date()
    const from = new Date(now.getTime() - windowMins * 60 * 1000).toISOString()
    const to = now.toISOString()
    // Pick interval based on window size
    const interval = windowMins <= 60 ? '1m' : windowMins <= 1440 ? '5m' : windowMins <= 10080 ? '30m' : '1h'
    const res = await api.queryTimeseries({
      time_range: { from, to },
      filters: slo.value.total_filters.length ? slo.value.total_filters : [],
      interval,
    })
    chartBuckets.value = (res.buckets || []) as TimeseriesBucket[]
  } catch {
    chartBuckets.value = []
  } finally {
    chartLoading.value = false
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
const CH = 120
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
type ChartKey = 'rate' | 'error' | 'sli'
const expanded = ref<ChartKey | null>(null)

interface ChartDef {
  key: ChartKey
  title: string
  values: number[]
  color: string
  lineClass: string
  maxVal?: number
  tickFixed?: number
  tickSuffix: string
  showTarget: boolean
  fmtVal: (v: number) => string
}

const chartDefs = computed<Record<ChartKey, ChartDef>>(() => ({
  rate: {
    key: 'rate', title: 'Request Rate', values: rateValues.value,
    color: 'var(--amber)', lineClass: 'sd-c-rate', tickSuffix: '', showTarget: false,
    fmtVal: (v) => `${v.toLocaleString()} req`,
  },
  error: {
    key: 'error', title: 'Error Rate', values: errorValues.value,
    color: 'var(--error)', lineClass: 'sd-c-error', tickSuffix: '', showTarget: false,
    fmtVal: (v) => `${v.toLocaleString()} errors`,
  },
  sli: {
    key: 'sli', title: 'SLO', values: sliValues.value,
    color: 'var(--ok)', lineClass: 'sd-c-sli', maxVal: 100, tickFixed: 1, tickSuffix: '%', showTarget: true,
    fmtVal: (v) => `${v.toFixed(2)}%`,
  },
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

const rateValues = computed(() => chartBuckets.value.map(b => b.count))
const errorValues = computed(() => chartBuckets.value.map(b => b.error_count))
const sliValues = computed(() => chartBuckets.value.map(b => {
  if (b.count === 0) return 100
  return ((b.count - b.error_count) / b.count) * 100
}))

function parseBucketUtc(bucket: string): number {
  const iso = bucket.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z'
  return new Date(iso).getTime()
}

function valuesToPoints(values: number[], maxVal?: number, geo: Geo = geoSmall): Pt[] {
  const mx = maxVal ?? Math.max(...values, 1)
  const stepX = geo.innerW / Math.max(values.length - 1, 1)
  return values.map((v, i) => [
    geo.pad.left + i * stepX,
    geo.pad.top + geo.innerH - ((v ?? 0) / mx) * geo.innerH,
  ] as Pt)
}

function areaPath(values: number[], maxVal?: number, geo: Geo = geoSmall): string {
  if (!values.length) return ''
  return straightAreaPath(valuesToPoints(values, maxVal, geo), geo.pad.top + geo.innerH)
}

function linePath(values: number[], maxVal?: number, geo: Geo = geoSmall): string {
  if (!values.length) return ''
  return straightLinePath(valuesToPoints(values, maxVal, geo))
}

function yTicks(values: number[], fixed?: number, geo: Geo = geoSmall): Array<{ label: string; y: number }> {
  const mx = Math.max(...values, 1)
  return [0, 0.5, 1].map(s => ({
    label: fixed !== undefined ? (mx * s).toFixed(fixed) : fmtCompact(mx * s),
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

function dotY(idx: number, values: number[], maxVal?: number, geo: Geo = geoSmall): number {
  const mx = maxVal ?? Math.max(...values, 1)
  return geo.pad.top + geo.innerH - ((values[idx] ?? 0) / mx) * geo.innerH
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

// Target line for SLI chart
function targetLineY(geo: Geo = geoSmall): number {
  if (!slo.value) return geo.pad.top
  const target = slo.value.target_percentage
  return geo.pad.top + geo.innerH - (target / 100) * geo.innerH
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
      <button v-if="features.sre_agent" class="btn-investigate" @click="investigateSlo">Investigate</button>
      <div class="sd-actions" v-if="canWrite">
        <button class="sd-action-btn" @click="showEdit = !showEdit">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9.5 1.5l2 2L4 11H2V9L9.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ showEdit ? 'Cancel' : 'Edit' }}
        </button>
        <button class="sd-action-btn sd-action-danger" @click="showDeleteConfirm = true">
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
      <div class="sd-hero-card card">
        <div class="sd-hero-label">Status</div>
        <div class="sd-state-row">
          <div class="sd-state-dot" :class="'sd-dot-' + slo.state"></div>
          <span class="sd-state-text" :class="'sd-text-' + slo.state">{{ stateLabel(slo.state) }}</span>
        </div>
        <div class="sd-hero-sub mono">{{ slo.enabled ? 'Enabled' : 'Disabled' }}</div>
      </div>

      <div class="sd-hero-card sd-hero-sli card">
        <div class="sd-hero-label">Current SLO</div>
        <div class="sd-sli-big mono" :class="'sd-text-' + slo.state">
          {{ successRateStr }}<span class="sd-sli-unit" v-if="successRate !== null">%</span>
        </div>
        <div class="sd-hero-sub mono">target {{ slo.target_percentage }}%</div>
      </div>

      <div class="sd-hero-card card">
        <div class="sd-hero-label">Error Budget Remaining</div>
        <div class="sd-budget-big mono" :class="'sd-budget-' + budgetSeverity">
          {{ slo.error_budget_remaining !== null ? budgetPct.toFixed(1) + '%' : '-' }}
        </div>
        <div class="sd-budget-bar-wrap">
          <div class="sd-budget-track">
            <div class="sd-budget-fill" :class="'sd-budgetbar-' + budgetSeverity" :style="{ width: budgetPct + '%' }"></div>
          </div>
          <div class="sd-budget-pct mono">{{ slo.error_budget_remaining !== null ? (slo.error_budget_remaining * 100).toFixed(3) + '% raw budget' : '' }}</div>
        </div>
        <router-link v-if="budgetBurning" :to="sloAnalyzeUrl" class="btn-bubbleup" style="margin-top:8px">
          ⬡ Analyze with BubbleUp
        </router-link>
      </div>

      <div class="sd-hero-card card">
        <div class="sd-hero-label">Request Counts</div>
        <div class="sd-counts-grid">
          <div class="sd-count-item">
            <div class="sd-count-val mono sd-count-err">{{ slo.error_count !== null ? slo.error_count.toLocaleString() : '-' }}</div>
            <div class="sd-count-label">Errors</div>
          </div>
          <div class="sd-count-item">
            <div class="sd-count-val mono">{{ slo.total_count !== null ? slo.total_count.toLocaleString() : '-' }}</div>
            <div class="sd-count-label">Total</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Charts ═══ -->
    <div class="sd-charts card" v-if="!showEdit && chartBuckets.length > 0">
      <div class="sd-charts-row">
        <!-- Request Rate -->
        <div class="sd-chart-panel sd-chart-clickable" @click="openChart('rate')" title="Click to expand">
          <div class="sd-chart-title">
            Request Rate
            <svg class="sd-expand-ico" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 1H1v4M8 12h4V8M1 12l4.5-4.5M12 1L7.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <svg :viewBox="`0 0 ${CW} ${CH}`" class="ch-svg sd-chart-svg" @mousemove="chartMouseMove" @mouseleave="chartMouseLeave">
            <template v-for="tick in yTicks(rateValues)" :key="'ry'+tick.label">
              <line :x1="pad.left" :y1="tick.y" :x2="CW - pad.right" :y2="tick.y" class="sd-grid-line ch-grid" />
              <text :x="pad.left - 4" :y="tick.y + 3" class="sd-axis-label ch-axis" text-anchor="end">{{ tick.label }}</text>
            </template>
            <template v-for="lbl in xLabels()" :key="'rx'+lbl.label">
              <line :x1="lbl.x" :y1="pad.top" :x2="lbl.x" :y2="CH - pad.bottom" class="ch-grid" />
              <text :x="lbl.x" :y="CH - 2" class="sd-axis-label ch-axis" text-anchor="middle">{{ lbl.label }}</text>
            </template>
            <path :d="areaPath(rateValues)" class="ch-area" style="color: var(--amber)" />
            <path :d="linePath(rateValues)" class="sd-line sd-c-rate ch-line" />
            <template v-if="chartHover">
              <line :x1="hoverX(chartHover.idx, rateValues.length)" :y1="pad.top" :x2="hoverX(chartHover.idx, rateValues.length)" :y2="CH - pad.bottom" class="sd-hover-line" />
              <circle :cx="hoverX(chartHover.idx, rateValues.length)" :cy="dotY(chartHover.idx, rateValues)" r="3" class="sd-hover-dot sd-c-rate" />
            </template>
            <rect :x="pad.left" :y="pad.top" :width="innerW" :height="innerH" fill="transparent" style="cursor: crosshair" />
          </svg>
          <div v-if="chartHover" class="sd-tooltip" :style="{ left: (hoverX(chartHover.idx, rateValues.length) / CW * 100) + '%' }">
            <div class="sd-tooltip-time">{{ hoverTime() }}</div>
            <div class="sd-tooltip-val">{{ rateValues[chartHover.idx]?.toLocaleString() }} req</div>
          </div>
        </div>

        <!-- Error Rate -->
        <div class="sd-chart-panel sd-chart-clickable" @click="openChart('error')" title="Click to expand">
          <div class="sd-chart-title">
            Error Rate
            <svg class="sd-expand-ico" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 1H1v4M8 12h4V8M1 12l4.5-4.5M12 1L7.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <svg :viewBox="`0 0 ${CW} ${CH}`" class="ch-svg sd-chart-svg" @mousemove="chartMouseMove" @mouseleave="chartMouseLeave">
            <template v-for="tick in yTicks(errorValues)" :key="'ey'+tick.label">
              <line :x1="pad.left" :y1="tick.y" :x2="CW - pad.right" :y2="tick.y" class="sd-grid-line ch-grid" />
              <text :x="pad.left - 4" :y="tick.y + 3" class="sd-axis-label ch-axis" text-anchor="end">{{ tick.label }}</text>
            </template>
            <template v-for="lbl in xLabels()" :key="'ex'+lbl.label">
              <line :x1="lbl.x" :y1="pad.top" :x2="lbl.x" :y2="CH - pad.bottom" class="ch-grid" />
              <text :x="lbl.x" :y="CH - 2" class="sd-axis-label ch-axis" text-anchor="middle">{{ lbl.label }}</text>
            </template>
            <path :d="areaPath(errorValues)" class="ch-area" style="color: var(--error)" />
            <path :d="linePath(errorValues)" class="sd-line sd-c-error ch-line" />
            <template v-if="chartHover">
              <line :x1="hoverX(chartHover.idx, errorValues.length)" :y1="pad.top" :x2="hoverX(chartHover.idx, errorValues.length)" :y2="CH - pad.bottom" class="sd-hover-line" />
              <circle :cx="hoverX(chartHover.idx, errorValues.length)" :cy="dotY(chartHover.idx, errorValues)" r="3" class="sd-hover-dot sd-c-error" />
            </template>
            <rect :x="pad.left" :y="pad.top" :width="innerW" :height="innerH" fill="transparent" style="cursor: crosshair" />
          </svg>
          <div v-if="chartHover" class="sd-tooltip" :style="{ left: (hoverX(chartHover.idx, errorValues.length) / CW * 100) + '%' }">
            <div class="sd-tooltip-time">{{ hoverTime() }}</div>
            <div class="sd-tooltip-val">{{ errorValues[chartHover.idx]?.toLocaleString() }} errors</div>
          </div>
        </div>

        <!-- SLO % -->
        <div class="sd-chart-panel sd-chart-clickable" @click="openChart('sli')" title="Click to expand">
          <div class="sd-chart-title">
            SLO
            <span class="sd-chart-legend">
              <span class="sd-legend-dot" style="background: var(--ok)"></span> SLO
              <span class="sd-legend-dot" style="background: var(--amber); opacity: 0.5"></span> target
            </span>
            <svg class="sd-expand-ico" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 1H1v4M8 12h4V8M1 12l4.5-4.5M12 1L7.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <svg :viewBox="`0 0 ${CW} ${CH}`" class="ch-svg sd-chart-svg" @mousemove="chartMouseMove" @mouseleave="chartMouseLeave">
            <template v-for="tick in yTicks(sliValues, 1)" :key="'sy'+tick.label">
              <line :x1="pad.left" :y1="tick.y" :x2="CW - pad.right" :y2="tick.y" class="sd-grid-line ch-grid" />
              <text :x="pad.left - 4" :y="tick.y + 3" class="sd-axis-label ch-axis" text-anchor="end">{{ tick.label }}%</text>
            </template>
            <template v-for="lbl in xLabels()" :key="'sx'+lbl.label">
              <line :x1="lbl.x" :y1="pad.top" :x2="lbl.x" :y2="CH - pad.bottom" class="ch-grid" />
              <text :x="lbl.x" :y="CH - 2" class="sd-axis-label ch-axis" text-anchor="middle">{{ lbl.label }}</text>
            </template>
            <!-- Target line -->
            <line :x1="pad.left" :y1="targetLineY()" :x2="CW - pad.right" :y2="targetLineY()" class="sd-target-line ch-threshold" />
            <text :x="CW - pad.right + 2" :y="targetLineY() + 3" class="sd-target-label">{{ slo.target_percentage }}%</text>
            <path :d="areaPath(sliValues, 100)" class="ch-area" style="color: var(--ok)" />
            <path :d="linePath(sliValues, 100)" class="sd-line sd-c-sli ch-line" />
            <template v-if="chartHover">
              <line :x1="hoverX(chartHover.idx, sliValues.length)" :y1="pad.top" :x2="hoverX(chartHover.idx, sliValues.length)" :y2="CH - pad.bottom" class="sd-hover-line" />
              <circle :cx="hoverX(chartHover.idx, sliValues.length)" :cy="dotY(chartHover.idx, sliValues, 100)" r="3" class="sd-hover-dot sd-c-sli" />
            </template>
            <rect :x="pad.left" :y="pad.top" :width="innerW" :height="innerH" fill="transparent" style="cursor: crosshair" />
          </svg>
          <div v-if="chartHover" class="sd-tooltip" :style="{ left: (hoverX(chartHover.idx, sliValues.length) / CW * 100) + '%' }">
            <div class="sd-tooltip-time">{{ hoverTime() }}</div>
            <div class="sd-tooltip-val">{{ sliValues[chartHover.idx]?.toFixed(2) }}%</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="!showEdit && chartLoading" class="sd-charts-loading card">
      <div class="sd-loading-bar"></div>
    </div>

    <!-- Configuration -->
    <div class="sd-config card" v-if="!showEdit">
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

    <!-- Events Timeline -->
    <div class="sd-section card" v-if="!showEdit">
      <div class="sd-section-title">
        Event History
        <span class="sd-event-count mono" v-if="events.length">{{ events.length }}</span>
      </div>
      <div v-if="events.length === 0" class="sd-events-empty">
        No state change events recorded yet
      </div>
      <div v-else class="sd-timeline">
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
              {{ ev.error_count.toLocaleString() }} errors / {{ ev.total_count.toLocaleString() }} total
              &middot; budget {{ (ev.error_budget_remaining * 100).toFixed(3) }}%
            </div>
          </div>
        </div>
      </div>
    </div>

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
                <template v-for="tick in yTicks(expandedDef.values, expandedDef.tickFixed, geoLarge)" :key="'my'+tick.label">
                  <line :x1="LPAD.left" :y1="tick.y" :x2="LW - LPAD.right" :y2="tick.y" class="ch-grid" />
                  <text :x="LPAD.left - 8" :y="tick.y + 4" class="ch-axis" text-anchor="end">{{ tick.label }}{{ expandedDef.tickSuffix }}</text>
                </template>
                <!-- X grid + labels -->
                <template v-for="lbl in xLabels(geoLarge)" :key="'mx'+lbl.label">
                  <line :x1="lbl.x" :y1="LPAD.top" :x2="lbl.x" :y2="LH - LPAD.bottom" class="ch-grid" />
                  <text :x="lbl.x" :y="LH - 10" class="ch-axis" text-anchor="middle">{{ lbl.label }}</text>
                </template>
                <!-- Target line (SLI only) -->
                <template v-if="expandedDef.showTarget">
                  <line :x1="LPAD.left" :y1="targetLineY(geoLarge)" :x2="LW - LPAD.right" :y2="targetLineY(geoLarge)" class="sd-target-line ch-threshold" />
                  <text :x="LW - LPAD.right + 4" :y="targetLineY(geoLarge) + 4" class="sd-target-label">{{ slo.target_percentage }}%</text>
                </template>
                <!-- Series -->
                <path :d="areaPath(expandedDef.values, expandedDef.maxVal, geoLarge)" class="ch-area" :style="{ color: expandedDef.color }" />
                <path :d="linePath(expandedDef.values, expandedDef.maxVal, geoLarge)" class="sd-line ch-line" :class="expandedDef.lineClass" />
                <!-- Hover -->
                <template v-if="chartHover">
                  <line :x1="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :y1="LPAD.top" :x2="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :y2="LH - LPAD.bottom" class="sd-hover-line" />
                  <circle :cx="hoverX(chartHover.idx, expandedDef.values.length, geoLarge)" :cy="dotY(chartHover.idx, expandedDef.values, expandedDef.maxVal, geoLarge)" r="4" class="sd-hover-dot" :class="expandedDef.lineClass" />
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
  <div v-else-if="loading" class="sd-loading">
    <div class="sd-loading-spinner"></div>
  </div>
</template>

<style scoped src="../styles/views/SloDetailView.css"></style>
