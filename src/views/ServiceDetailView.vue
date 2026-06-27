<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import SpanLogTable from '../components/SpanLogTable.vue'
import TimePicker from '../components/TimePicker.vue'
import PanelCard from '../components/PanelCard.vue'
import type { GraphNode, GraphEdge, TimeseriesBucket, RushEvent, Filter, Funnel, FunnelResult, FunnelStep, DeployMarker, Monitor, Slo, AnomalyRule, LatencyHistogram, EndpointRow, ErrorGroup } from '../types'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { features, loadFeatures } = useFeatures()

const serviceName = computed(() => route.params.serviceName as string)

// State
const graphNodes = ref<GraphNode[]>([])
const graphEdges = ref<GraphEdge[]>([])
const timeseries = ref<TimeseriesBucket[]>([])
// Previous-period series: the same-duration window immediately preceding the
// current one (shifted back by `minutes`). Overlaid faintly on the charts when
// the "vs previous" comparison is enabled, so spikes/regressions read against a
// baseline instead of in isolation.
const timeseriesPrev = ref<TimeseriesBucket[]>([])
const compareEnabled = ref(true)
// Full latency distribution (log2-ms buckets) for this service — the shape the
// percentile timeseries can't show. Fetched per window alongside the charts.
const latencyHist = ref<LatencyHistogram | null>(null)

// Per-endpoint RED breakdown. `mode` toggles between the service's HTTP entry
// points (server) and its downstream operations (db/cache/etc.). Lazy-loaded.
const endpoints = ref<EndpointRow[]>([])
const endpointsMode = ref<'server' | 'operation'>('server')
const endpointsLoading = ref(false)
const endpointsSeen = ref(false)
type EpSortKey = 'endpoint' | 'req' | 'errRate' | 'p50_ms' | 'p95_ms' | 'p99_ms'
const epSortKey = ref<EpSortKey>('req')
const epSortDir = ref<'asc' | 'desc'>('desc')

// Top Errors: grouped failures, by errored endpoint (status×method×path) or by
// normalized log-message template. Lazy-loaded like the other heavy sections.
const errorGroups = ref<ErrorGroup[]>([])
const errorsMode = ref<'endpoint' | 'message'>('endpoint')
const errorsLoading = ref(false)
const errorsSeen = ref(false)
const traces = ref<RushEvent[]>([])
const loading = ref(true)
const initMinutes = Number(route.query.t)
const minutes = ref(initMinutes > 0 ? initMinutes : 60)

// Deploy markers (overlaid on charts). The exact query window is captured per
// load so marker x-positions align with the chart's time axis.
const deploys = ref<DeployMarker[]>([])
const loadedFrom = ref(0)
const loadedTo = ref(0)

// "Attached to this service": monitors, SLOs, and anomaly rules scoped to this
// service. Monitors are Rush's current alerting primitive (the /alerts nav opens
// MonitorsView) — NOT the legacy alert_rules API. These lists are small and
// window-independent, so they're fetched once and filtered client-side.
const monitors = ref<Monitor[]>([])
const slos = ref<Slo[]>([])
const anomalyRules = ref<AnomalyRule[]>([])

async function loadAttachments() {
  const [m, s, an] = await Promise.allSettled([
    api.listMonitors(),
    api.listSlos(),
    api.listAnomalyRules(),
  ])
  if (m.status === 'fulfilled') monitors.value = m.value.monitors ?? []
  if (s.status === 'fulfilled') slos.value = s.value.slos ?? []
  if (an.status === 'fulfilled') anomalyRules.value = an.value.rules ?? []
}

// A monitor is tied to a service in one of two ways depending on its type:
// apm monitors carry the service directly (query_config.service); log/metric
// monitors via a filters array pinning service_name.
function monitorMatchesService(m: Monitor): boolean {
  const qc = (m.query_config as any) || {}
  if (typeof qc.service === 'string' && qc.service === serviceName.value) return true
  const filters = qc.filters || []
  return Array.isArray(filters) && filters.some((f: any) => {
    const field = String(f?.field ?? '').toLowerCase()
    return (field === 'service_name' || field === 'servicename') && String(f?.value) === serviceName.value
  })
}

const serviceMonitors = computed(() => monitors.value.filter((m) => m.enabled && monitorMatchesService(m)))
// Monitor states: 'alert' = critical/firing, 'warn' = warning.
const monitorsAlerting = computed(() => serviceMonitors.value.filter((m) => m.state === 'alert').length)
const monitorsWarning = computed(() => serviceMonitors.value.filter((m) => m.state === 'warn').length)

const serviceSlos = computed(() => slos.value.filter((s) => s.enabled && s.service_name === serviceName.value))
const slosBreaching = computed(() => serviceSlos.value.filter((s) => s.state === 'breaching').length)

const serviceAnomalies = computed(() => anomalyRules.value.filter((r) => r.enabled && r.service_name === serviceName.value))
const anomaliesFiring = computed(() => serviceAnomalies.value.filter((r) => r.state === 'anomalous').length)

// deploys is ordered most-recent-first by the API.
const lastDeploy = computed(() => deploys.value[0] ?? null)

function relTime(ts: string): string {
  const t = parseTs(ts)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Raw fetch to avoid polluting shared api.loading
async function fetchApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

function detailInterval(): string {
  const m = minutes.value
  if (m <= 15) return '1m'
  if (m <= 60) return '2m'
  if (m <= 360) return '10m'
  if (m <= 1440) return '30m'
  return '3h'
}

// Current query window + the standard service filter, shared across loaders.
function windowRange() {
  const now = new Date()
  const fromDate = new Date(now.getTime() - minutes.value * 60 * 1000)
  return { now, fromDate, from: fromDate.toISOString(), to: now.toISOString() }
}
function svcFilters(): Filter[] {
  return [{ field: 'service_name', op: '=', value: serviceName.value }]
}

// ═══ Lazy loading ═══
// Below-the-fold sections (recent spans/logs, funnels) fetch only once their
// area scrolls near the viewport, so the first paint isn't blocked on queries
// the user may never look at. `*Seen` flags let a window change (minutes) refetch
// a section that's already been revealed without waking ones still unseen.
const tracesSeen = ref(false)
const tracesLoading = ref(false)
const funnelsSeen = ref(false)
const funnelsRef = ref<HTMLElement | null>(null)
// Combined Endpoints / Top Errors tabbed card (APM Logs is now its own top-level tab).
const tabsCardRef = ref<HTMLElement | null>(null)
const activeServiceTab = ref<'endpoints' | 'errors'>('endpoints')
let lazyObservers: IntersectionObserver[] = []
let observersReady = false

// ═══ Top-level tabs ═══
// The page used to be one long vertical scroll (overview → charts → endpoints/
// errors/logs → funnels). That's too much to parse at once, so the sections are
// split into top-level tabs, deep-linkable via the `?tab=` query param so a tab
// is shareable and survives back/forward. Overview is populated by loadData()
// on mount; the heavier Endpoints/Spans/Logs/Funnels views load the first time
// their tab opens (their IntersectionObserver never fires while hidden).
type MainTab = 'overview' | 'endpoints' | 'spans' | 'logs' | 'funnels'
const TABS: MainTab[] = ['overview', 'endpoints', 'spans', 'logs', 'funnels']

function tabFromRoute(): MainTab {
  const t = route.query.tab
  return typeof t === 'string' && (TABS as string[]).includes(t) ? (t as MainTab) : 'overview'
}
const activeTab = ref<MainTab>(tabFromRoute())

// Trigger the lazy fetch backing a tab (no-op if already loaded). Spans and Logs
// share the same span feed (logs are extracted from span events).
function loadTabData(t: MainTab) {
  if (t === 'endpoints') loadActiveServiceTab()
  else if (t === 'spans' || t === 'logs') { if (!tracesSeen.value) loadTraces() }
  else if (t === 'funnels') { if (!funnelsSeen.value) { funnelsSeen.value = true; loadSvcFunnels() } }
}

// The tabs are <router-link>s that set `?tab=`; this keeps activeTab in sync with
// the URL (clicks, deep links, and browser back/forward all flow through here).
watch(() => route.query.tab, () => {
  activeTab.value = tabFromRoute()
  loadTabData(activeTab.value)
})

// Tab descriptors for the nav. `dot` mirrors service health (Overview only).
const mainTabs = computed<{ id: MainTab; label: string; dot: string }[]>(() => [
  { id: 'overview',  label: 'Overview',  dot: health.value },
  { id: 'endpoints', label: 'Endpoints', dot: '' },
  { id: 'spans',     label: 'Spans',     dot: '' },
  { id: 'logs',      label: 'Logs',      dot: '' },
  { id: 'funnels',   label: 'Funnels',   dot: '' },
])

function observeOnce(el: Element | null, cb: () => void) {
  if (!el) return
  if (typeof IntersectionObserver === 'undefined') { cb(); return } // SSR / old browsers
  const obs = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); cb() }
  }, { rootMargin: '300px 0px' })
  obs.observe(el)
  lazyObservers.push(obs)
}

function setupLazyObservers() {
  if (observersReady) return
  observersReady = true
  observeOnce(tabsCardRef.value, loadActiveServiceTab)
  observeOnce(funnelsRef.value, () => { funnelsSeen.value = true; loadSvcFunnels() })
}

// Load the data backing the active Endpoints/Top-Errors sub-tab, skipping the
// fetch if it has already loaded.
function loadActiveServiceTab() {
  if (activeServiceTab.value === 'endpoints') { if (!endpointsSeen.value) loadEndpoints() }
  else if (!errorsSeen.value) loadErrors()
}

function setServiceTab(t: 'endpoints' | 'errors') {
  activeServiceTab.value = t
  loadActiveServiceTab()
}

// Critical fetch: service graph + current timeseries. Drives the stat cards,
// health verdict, and primary chart lines — everything above the fold.
async function loadData() {
  loading.value = true
  const { now, fromDate, from, to } = windowRange()
  // Capture the exact window so deploy markers map onto the same axis as the charts.
  loadedFrom.value = fromDate.getTime()
  loadedTo.value = now.getTime()
  const filters = svcFilters()

  try {
    const [graphRes, tsRes] = await Promise.all([
      api.serviceGraph(minutes.value),
      fetchApi<{ buckets: TimeseriesBucket[]; grouped: boolean }>('/query/timeseries', {
        time_range: { from, to },
        filters,
        interval: detailInterval(),
      }),
    ])
    graphNodes.value = graphRes.nodes
    graphEdges.value = graphRes.edges
    timeseries.value = tsRes.buckets as TimeseriesBucket[]
  } catch {
    // silent
  } finally {
    loading.value = false
  }

  // Secondary chart data + deploys: off the critical path so first paint isn't
  // blocked. Charts are above the fold, so these fire immediately (not on scroll)
  // to avoid a flash of empty overlay/histogram.
  loadSecondaryCharts()
  loadDeploys(from, to)

  // A window change refetches sections the user has already scrolled to.
  if (endpointsSeen.value) loadEndpoints()
  if (errorsSeen.value) loadErrors()
  if (tracesSeen.value) loadTraces()
  if (funnelsSeen.value) loadSvcFunnels()
}

// Previous-period overlay + latency histogram. Not needed for first paint.
async function loadSecondaryCharts() {
  const { fromDate, from } = windowRange()
  const prevTo = from
  const prevFrom = new Date(fromDate.getTime() - minutes.value * 60 * 1000).toISOString()
  const filters = svcFilters()
  try {
    const [tsPrevRes, histRes] = await Promise.all([
      fetchApi<{ buckets: TimeseriesBucket[]; grouped: boolean }>('/query/timeseries', {
        time_range: { from: prevFrom, to: prevTo },
        filters,
        interval: detailInterval(),
      }),
      api.serviceLatencyHistogram(serviceName.value, minutes.value),
    ])
    timeseriesPrev.value = tsPrevRes.buckets as TimeseriesBucket[]
    latencyHist.value = histRes
  } catch {
    // silent — overlay/histogram simply stay empty
  }
}

// Recent spans/logs (the SpanLogTable feed). Lazy: only once scrolled near.
async function loadTraces() {
  tracesSeen.value = true
  tracesLoading.value = true
  const { from, to } = windowRange()
  try {
    const res = await fetchApi<{ rows: RushEvent[]; total: number }>('/query', {
      time_range: { from, to },
      filters: svcFilters(),
      limit: 100,
    })
    traces.value = res.rows
  } catch {
    // silent
  } finally {
    tracesLoading.value = false
  }
}

// Endpoint/operation RED breakdown. Lazy: only once scrolled near.
async function loadEndpoints() {
  endpointsSeen.value = true
  endpointsLoading.value = true
  try {
    const res = await api.serviceEndpoints(serviceName.value, minutes.value, endpointsMode.value)
    endpoints.value = res.endpoints
  } catch {
    endpoints.value = []
  } finally {
    endpointsLoading.value = false
  }
}

// Toggle Endpoints ↔ Operations; refetch immediately (the section is in view).
function setEndpointsMode(m: 'server' | 'operation') {
  if (endpointsMode.value === m) return
  endpointsMode.value = m
  loadEndpoints()
}

// Top Errors breakdown. Lazy: only once scrolled near.
async function loadErrors() {
  errorsSeen.value = true
  errorsLoading.value = true
  try {
    const res = await api.serviceErrors(serviceName.value, minutes.value, errorsMode.value)
    errorGroups.value = res.groups
  } catch {
    errorGroups.value = []
  } finally {
    errorsLoading.value = false
  }
}

function setErrorsMode(m: 'endpoint' | 'message') {
  if (errorsMode.value === m) return
  errorsMode.value = m
  loadErrors()
}

// Deploy markers — non-blocking: a failure here must not break the page.
async function loadDeploys(from: string, to: string) {
  try {
    const res = await api.listDeploys({ service_name: serviceName.value, from, to })
    deploys.value = res.deploys ?? []
  } catch {
    deploys.value = []
  }
}

onMounted(() => {
  loadData().then(() => nextTick(setupLazyObservers))
  // Deep link (?tab=spans|logs|endpoints|funnels): load that tab's data now.
  if (activeTab.value !== 'overview') loadTabData(activeTab.value)
  loadAttachments()
  if (features.value.deploy_markers === undefined) loadFeatures()
})
onUnmounted(() => { lazyObservers.forEach((o) => o.disconnect()); lazyObservers = [] })
watch(serviceName, loadAttachments)
watch(minutes, loadData)

const windowTo = computed(() => new Date().toISOString())
const windowFrom = computed(() => new Date(Date.now() - minutes.value * 60_000).toISOString())

function bubbleUpUrl(svc: string, from: string, to: string): string {
  const params = new URLSearchParams({ bubbleup: '1', bu_from: from, bu_to: to, service: svc })
  return `/?${params.toString()}`
}

// Rich health verdict: combines the in-window error rate with the signals
// attached to this service (firing alerts, breaching SLOs, active anomalies).
// Returns a level (mapped to the existing healthy/degraded/unhealthy badge
// classes, plus a muted "nodata" state) and the contributing reasons that
// drive the one-line "why" under the title.
const healthVerdict = computed(() => {
  const total = summary.value.total
  const rate = summary.value.errorRate
  if (total === 0) {
    return { level: 'nodata', label: 'no data', reasons: ['no traffic in this window'] }
  }

  const alerting = monitorsAlerting.value
  const warning = monitorsWarning.value
  const breaching = slosBreaching.value
  const anomalies = anomaliesFiring.value
  const reasons: string[] = []
  if (alerting > 0) reasons.push(`${alerting} monitor${alerting > 1 ? 's' : ''} alerting`)
  if (breaching > 0) reasons.push(`${breaching} SLO${breaching > 1 ? 's' : ''} breaching`)
  if (warning > 0) reasons.push(`${warning} monitor${warning > 1 ? 's' : ''} warning`)
  if (anomalies > 0) reasons.push(`${anomalies} ${anomalies > 1 ? 'anomalies' : 'anomaly'} firing`)

  // Critical: a monitor in alert state, a breaching SLO, or a high error rate.
  if (alerting > 0 || breaching > 0 || rate > 0.1) {
    if (rate > 0.1) reasons.push(`error rate ${formatPercent(rate)}`)
    return { level: 'unhealthy', label: 'critical', reasons }
  }
  // Degraded: a monitor in warning state, an active anomaly, or an elevated error rate.
  if (warning > 0 || anomalies > 0 || rate > 0.01) {
    if (rate > 0.01) reasons.push(`error rate ${formatPercent(rate)}`)
    return { level: 'degraded', label: 'degraded', reasons }
  }
  return { level: 'healthy', label: 'healthy', reasons: ['all signals nominal'] }
})

// Back-compat alias: the dot/badge class bindings key off the level string
// (healthy | degraded | unhealthy | nodata).
const health = computed(() => healthVerdict.value.level)

// Chart helpers
const CHART_W = 300
const CHART_H = 100
const CHART_PAD = 4

function barChartBars(values: number[], sharedMax?: number): { x: number; y: number; w: number; h: number }[] {
  if (values.length === 0) return []
  const max = sharedMax ?? Math.max(...values, 1)
  const barW = Math.max(1, (CHART_W - CHART_PAD * 2) / values.length - 1)
  return values.map((v, i) => {
    const x = CHART_PAD + i * ((CHART_W - CHART_PAD * 2) / values.length)
    const h = (v / max) * (CHART_H - CHART_PAD * 2)
    const y = CHART_H - CHART_PAD - h
    return { x, y, w: barW, h: Math.max(0, h) }
  })
}

function lineChartPoints(values: number[], sharedMax?: number): string {
  if (values.length === 0) return ''
  const max = sharedMax ?? Math.max(...values, 0.001)
  return values
    .map((v, i) => {
      const x = CHART_PAD + (i / Math.max(values.length - 1, 1)) * (CHART_W - CHART_PAD * 2)
      const y = CHART_H - CHART_PAD - (v / max) * (CHART_H - CHART_PAD * 2)
      return `${x},${y}`
    })
    .join(' ')
}

// Parse a timestamp that may be ISO or "YYYY-MM-DD HH:MM:SS" (ClickHouse style).
function parseTs(s: string): number {
  return Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'))
}

// Deploy markers positioned on the chart's x-axis. Empty when the feature is
// off or the window is degenerate. Each marker carries the CHART_W-space x plus
// display fields for the hover tooltip; markers outside the window are dropped.
const deployMarkers = computed(() => {
  if (features.value.deploy_markers === false) return []
  const span = loadedTo.value - loadedFrom.value
  if (span <= 0) return []
  const innerW = CHART_W - CHART_PAD * 2
  return deploys.value
    .map((d) => {
      const t = parseTs(d.deployed_at)
      const frac = (t - loadedFrom.value) / span
      return { d, frac, x: CHART_PAD + frac * innerW }
    })
    .filter((m) => Number.isFinite(m.frac) && m.frac >= 0 && m.frac <= 1)
})

function deployTooltip(d: DeployMarker): string {
  const when = new Date(parseTs(d.deployed_at))
  const t = `${when.getHours().toString().padStart(2, '0')}:${when.getMinutes().toString().padStart(2, '0')}`
  const parts = [d.version ? `v${d.version}` : 'deploy', t]
  if (d.deployed_by) parts.push(`by ${d.deployed_by}`)
  if (d.environment) parts.push(d.environment)
  return parts.join(' · ')
}

function lineChartArea(values: number[], sharedMax?: number): string {
  if (values.length === 0) return ''
  const pts = lineChartPoints(values, sharedMax)
  const lastX = CHART_PAD + ((values.length - 1) / Math.max(values.length - 1, 1)) * (CHART_W - CHART_PAD * 2)
  return `M ${CHART_PAD},${CHART_H - CHART_PAD} L ${pts.split(' ').join(' L ')} L ${lastX},${CHART_H - CHART_PAD} Z`
}

const requestCounts = computed(() => timeseries.value.map((b) => b.count))
const errorCounts = computed(() => timeseries.value.map((b) => b.error_count))
const p50 = computed(() => timeseries.value.map((b) => b.p50_ms))
const p95 = computed(() => timeseries.value.map((b) => b.p95_ms))
const p99 = computed(() => timeseries.value.map((b) => b.p99_ms))
const avg = computed(() => timeseries.value.map((b) => b.avg_duration_ms))

// Previous-period series, aligned by bucket index to the current series (same
// duration + interval ⇒ same bucket count). `cmpOn` gates the overlay so the
// charts stay clean when comparison is off or the prior window had no data.
const requestCountsPrev = computed(() => timeseriesPrev.value.map((b) => b.count))
const errorCountsPrev = computed(() => timeseriesPrev.value.map((b) => b.error_count))
const p50Prev = computed(() => timeseriesPrev.value.map((b) => b.p50_ms))
const p95Prev = computed(() => timeseriesPrev.value.map((b) => b.p95_ms))
const p99Prev = computed(() => timeseriesPrev.value.map((b) => b.p99_ms))
const avgPrev = computed(() => timeseriesPrev.value.map((b) => b.avg_duration_ms))
const cmpOn = computed(() => compareEnabled.value && timeseriesPrev.value.length > 0)

// Human label for the comparison window ("1h", "90m", "24h").
const humanWindow = computed(() => {
  const m = minutes.value
  if (m % 1440 === 0) return `${m / 1440}d`
  if (m % 60 === 0) return `${m / 60}h`
  return `${m}m`
})

// Shared Y-scale: when comparing, both periods must use the same max or the
// overlay is meaningless. Falls back to the current series alone when off.
function cmpMax(cur: number[], prev: number[]): number {
  return cmpOn.value ? Math.max(...cur, ...prev, 1) : Math.max(...cur, 1)
}
const reqMax = computed(() => cmpMax(requestCounts.value, requestCountsPrev.value))
const errMax = computed(() => cmpMax(errorCounts.value, errorCountsPrev.value))

// Previous value + signed delta% at a bucket index, for the hover tooltips.
function prevAt(prev: number[], idx: number): number {
  return prev[idx] ?? 0
}
function deltaPct(cur: number, prev: number): { txt: string; cls: string } | null {
  if (!cmpOn.value || prev <= 0) return null
  const d = ((cur - prev) / prev) * 100
  const cls = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down'
  const sign = d > 0 ? '+' : ''
  return { txt: `${sign}${d.toFixed(0)}%`, cls }
}

// Shared max for the combined latency chart so all lines use the same scale.
// Includes the previous-period lines when the comparison overlay is active.
const latencyMax = computed(() => Math.max(
  ...p50.value, ...p95.value, ...p99.value, ...avg.value,
  ...(cmpOn.value ? [...p50Prev.value, ...p95Prev.value, ...p99Prev.value, ...avgPrev.value] : []),
  0.001
))

// ═══ Latency distribution (histogram) ═══
// Backend returns sparse log2(ms) buckets; fill the gaps so bars are contiguous
// across the observed range, and expose the exponent bounds for marker math.
const histBars = computed(() => {
  const h = latencyHist.value
  if (!h || h.buckets.length === 0) return { bars: [] as { exp: number; count: number }[], minExp: 0, maxExp: 0 }
  const exps = h.buckets.map((b) => b.exp)
  const minExp = Math.min(...exps)
  const maxExp = Math.max(...exps)
  const byExp = new Map(h.buckets.map((b) => [b.exp, b.count]))
  const bars: { exp: number; count: number }[] = []
  for (let e = minExp; e <= maxExp; e++) bars.push({ exp: e, count: byExp.get(e) ?? 0 })
  return { bars, minExp, maxExp }
})
const histCounts = computed(() => histBars.value.bars.map((b) => b.count))
const hasHist = computed(() => histBars.value.bars.length > 0 && (latencyHist.value?.total ?? 0) > 0)

// Format a duration in ms with unit-appropriate precision (µs / ms / s).
function fmtDur(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)}µs`
  if (ms < 1000) return `${ms < 10 ? +ms.toFixed(1) : Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
}
// Label for bucket `exp`: the half-open range [2^exp, 2^(exp+1)) ms.
function histRangeLabel(exp: number): string {
  return `${fmtDur(Math.pow(2, exp))}–${fmtDur(Math.pow(2, exp + 1))}`
}
// X position (in CHART_W units) of a latency value, aligned to the even bar
// spacing: a value at log2=L sits at fractional bar index (L − minExp).
function histMarkerX(ms: number): number | null {
  const { bars, minExp } = histBars.value
  if (ms <= 0 || bars.length === 0) return null
  const step = (CHART_W - CHART_PAD * 2) / bars.length
  const x = CHART_PAD + (Math.log2(ms) - minExp) * step
  return Math.max(CHART_PAD, Math.min(CHART_W - CHART_PAD, x))
}
// Markers drawn over the histogram (P50/P95/P99), filtered to those in range.
const histMarkers = computed(() => {
  const h = latencyHist.value
  if (!h || !hasHist.value) return [] as { x: number; label: string; val: string; color: string }[]
  const defs = [
    { label: 'P50', ms: h.p50_ms, color: 'var(--amber)' },
    { label: 'P95', ms: h.p95_ms, color: 'var(--ok)' },
    { label: 'P99', ms: h.p99_ms, color: 'var(--error)' },
  ]
  const out: { x: number; label: string; val: string; color: string }[] = []
  for (const d of defs) {
    const x = histMarkerX(d.ms)
    if (x !== null) out.push({ x, label: d.label, val: fmtDur(d.ms), color: d.color })
  }
  return out
})
// Hover tooltip text for histogram bar at index.
function histHoverLabel(idx: number): string {
  const b = histBars.value.bars[idx]
  return b ? histRangeLabel(b.exp) : ''
}
// X-axis end labels (lowest / highest bucket bound).
const histMinLabel = computed(() => hasHist.value ? fmtDur(Math.pow(2, histBars.value.minExp)) : '')
const histMaxLabel = computed(() => hasHist.value ? fmtDur(Math.pow(2, histBars.value.maxExp + 1)) : '')

// Summary stats
const summary = computed(() => {
  const buckets = timeseries.value
  if (buckets.length === 0) return { total: 0, errors: 0, errorRate: 0, avgMs: 0, p50: 0, p95: 0, p99: 0 }
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const errors = buckets.reduce((s, b) => s + b.error_count, 0)
  const errorRate = total > 0 ? errors / total : 0
  const avgMs = total > 0 ? buckets.reduce((s, b) => s + b.avg_duration_ms * b.count, 0) / total : 0
  const last = [...buckets].reverse().find((b) => b.count > 0)
  return { total, errors, errorRate, avgMs, p50: last?.p50_ms ?? 0, p95: last?.p95_ms ?? 0, p99: last?.p99_ms ?? 0 }
})

// Service map edges
const svcEdges = computed(() => {
  const name = serviceName.value
  return {
    incoming: graphEdges.value.filter((e) => e.target === name),
    outgoing: graphEdges.value.filter((e) => e.source === name),
  }
})

const svcConnected = computed(() => {
  const names = new Set<string>()
  for (const e of svcEdges.value.incoming) names.add(e.source)
  for (const e of svcEdges.value.outgoing) names.add(e.target)
  return [...names]
})

// ═══ Per-edge RED (Rate / Errors / Duration) + dependency health ═══
// Each edge carries request_count, error_count, avg_duration_ms from the
// service_graph API. We derive an error rate and a health level (same 1%/10%
// thresholds as the service verdict) so upstream/downstream links can be
// colored by health at a glance and listed with their golden signals.
function edgeErrorRate(e: GraphEdge): number {
  return e.request_count > 0 ? e.error_count / e.request_count : 0
}
function edgeHealth(e: GraphEdge): 'healthy' | 'degraded' | 'unhealthy' {
  const r = edgeErrorRate(e)
  if (r > 0.1) return 'unhealthy'
  if (r > 0.01) return 'degraded'
  return 'healthy'
}
function edgeColor(e: GraphEdge): string {
  const h = edgeHealth(e)
  return h === 'unhealthy' ? 'var(--error)' : h === 'degraded' ? 'var(--warning)' : 'var(--ok)'
}
function edgeTitle(e: GraphEdge, other: string): string {
  return `${other} — ${formatCount(e.request_count)} req · ${formatPercent(edgeErrorRate(e))} err · ${formatMs(e.avg_duration_ms)} avg`
}
function goToService(name: string) {
  router.push({ path: `/services/${encodeURIComponent(name)}`, query: { t: String(minutes.value) } })
}

// ═══ Endpoint breakdown helpers ═══
function epErrorRate(e: EndpointRow): number {
  return e.req > 0 ? e.errors / e.req : 0
}
function epRps(e: EndpointRow): number {
  const secs = minutes.value * 60
  return secs > 0 ? e.req / secs : 0
}
function epColor(e: EndpointRow): string {
  const r = epErrorRate(e)
  return r > 0.1 ? 'var(--error)' : r > 0.01 ? 'var(--warning)' : 'var(--ok)'
}
function formatRps(r: number): string {
  if (r >= 100) return `${Math.round(r)}/s`
  if (r >= 1) return `${r.toFixed(1)}/s`
  if (r > 0) return `${(r * 60).toFixed(1)}/min`
  return '0'
}
// Sorted view of the endpoint rows. Numeric keys sort by value; 'endpoint' by
// label; 'errRate' is derived. Direction toggles per the header controls.
const sortedEndpoints = computed(() => {
  const rows = [...endpoints.value]
  const k = epSortKey.value
  const dir = epSortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    let av: number | string, bv: number | string
    if (k === 'endpoint') { av = a.endpoint; bv = b.endpoint }
    else if (k === 'errRate') { av = epErrorRate(a); bv = epErrorRate(b) }
    else { av = a[k]; bv = b[k] }
    if (typeof av === 'string') return dir * av.localeCompare(bv as string)
    return dir * ((av as number) - (bv as number))
  })
  return rows
})
function setEpSort(key: EpSortKey) {
  if (epSortKey.value === key) {
    epSortDir.value = epSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    epSortKey.value = key
    epSortDir.value = key === 'endpoint' ? 'asc' : 'desc'
  }
}
function epSortIndicator(key: EpSortKey): string {
  if (epSortKey.value !== key) return ''
  return epSortDir.value === 'asc' ? ' ▲' : ' ▼'
}
// Drill into Explore filtered to this endpoint/operation for the same window.
function exploreEndpoint(e: EndpointRow) {
  const parts = [`service_name=${serviceName.value}`]
  if (endpointsMode.value === 'operation') {
    parts.push(`span_name=${e.endpoint}`)
  } else {
    if (e.method) parts.push(`http_method=${e.method}`)
    if (e.path) parts.push(`http_path=${e.path}`)
  }
  router.push({ path: '/', query: { q: parts.join(' '), t: String(minutes.value) } })
}

// ═══ Top Errors helpers ═══
function errStatusColor(code: number): string {
  if (code >= 500) return 'var(--error)'
  if (code >= 400) return 'var(--warning)'
  return 'var(--text-muted)'
}
function errSeverityColor(sev: string): string {
  return sev === 'WARN' ? 'var(--warning)' : 'var(--error)'
}
// Drill into Explore: errored requests (endpoint mode) or the service's logs
// (message mode) for the same window.
function exploreError(g: ErrorGroup) {
  if (errorsMode.value === 'message') {
    const sev = g.severity || 'ERROR'
    router.push({ path: '/', query: { mode: 'logs', q: `service_name=${serviceName.value} severity=${sev}`, t: String(minutes.value) } })
  } else {
    const parts = [`service_name=${serviceName.value}`]
    if (g.method) parts.push(`http_method=${g.method}`)
    if (g.path) parts.push(`http_path=${g.path}`)
    if (g.status_code) parts.push(`http_status_code=${g.status_code}`)
    router.push({ path: '/', query: { q: parts.join(' '), t: String(minutes.value) } })
  }
}

// Time labels
const timeLabels = computed(() => {
  const buckets = timeseries.value
  if (buckets.length === 0) return { first: '', last: '' }
  const fmt = (b: string) => {
    const d = new Date(b.replace(' ', 'T') + (b.includes('Z') ? '' : 'Z'))
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  return { first: fmt(buckets[0]!.bucket), last: fmt(buckets[buckets.length - 1]!.bucket) }
})

// ═══ Chart interactivity ═══
const activeChart = ref<string | null>(null)
const hoverIdx = ref(-1)
const DATA_CHART_KEYS = ['req', 'err', 'latency', 'p50', 'p95', 'avg', 'p99', 'hist']
const anyChartHovered = computed(() => activeChart.value !== null && DATA_CHART_KEYS.includes(activeChart.value))

function chartMax(values: number[]): number {
  return Math.max(...values, 1)
}

function fmtAxis(v: number, isMs: boolean): string {
  if (isMs) {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}s`
    if (v >= 1) return `${Math.round(v)}ms`
    return '0'
  }
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(Math.round(v))
}

function onChartMove(e: MouseEvent, key: string, count: number) {
  activeChart.value = key
  const body = e.currentTarget as HTMLElement
  const area = body.querySelector('.chart-area') as HTMLElement
  if (!area || count === 0) return
  const rect = area.getBoundingClientRect()
  const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  hoverIdx.value = Math.round(relX * Math.max(count - 1, 0))
}

function onChartLeave() {
  activeChart.value = null
  hoverIdx.value = -1
}

function hoverLeft(count: number): string {
  if (count <= 1) return '50%'
  return `${(hoverIdx.value / (count - 1)) * 100}%`
}

function fmtBucketTime(idx: number): string {
  const b = timeseries.value[idx]
  if (!b) return ''
  const d = new Date(b.bucket.replace(' ', 'T') + (b.bucket.includes('Z') ? '' : 'Z'))
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ═══ Chart expand modal ═══
const expandedChart = ref<string | null>(null)

function openChart(key: string) {
  expandedChart.value = key
}
function closeChart() {
  expandedChart.value = null
  onChartLeave()
}

function chartVals(key: string): number[] {
  const m: Record<string, { value: number[] }> = {
    req: requestCounts, err: errorCounts,
    p50: p50, p95: p95, avg: avg, p99: p99,
  }
  return m[key]?.value ?? []
}
function chartValsPrev(key: string): number[] {
  const m: Record<string, { value: number[] }> = {
    req: requestCountsPrev, err: errorCountsPrev,
    p50: p50Prev, p95: p95Prev, avg: avgPrev, p99: p99Prev,
  }
  return m[key]?.value ?? []
}
// Shared Y-max for a given chart key, spanning current + previous when comparing.
function chartSharedMax(key: string): number {
  return cmpMax(chartVals(key), chartValsPrev(key))
}
function chartColor(key: string): string {
  const c: Record<string, string> = {
    req: 'var(--amber)', err: 'var(--error)',
    p50: 'var(--amber)', p95: 'var(--ok)',
    avg: 'var(--text-secondary)', p99: 'var(--error)',
  }
  return c[key] ?? 'var(--amber)'
}
function chartFillOpacity(key: string): string {
  return key === 'avg' ? '0.06' : '0.08'
}
function chartLabel(key: string): string {
  const t: Record<string, string> = {
    req: 'Requests', err: 'Errors',
    latency: 'Latency',
    p50: 'P50 Latency', p95: 'P95 Latency',
    avg: 'Avg Latency', p99: 'P99 Latency',
    map: 'Service Map',
    hist: 'Latency Distribution',
  }
  return t[key] ?? ''
}
function chartIsMs(key: string): boolean {
  return ['p50', 'p95', 'avg', 'p99'].includes(key)
}
function chartFmtVal(key: string, v: number): string {
  return chartIsMs(key) ? formatMs(v) : formatCount(v)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && expandedChart.value) {
    closeChart()
  }
}

onMounted(() => { window.addEventListener('keydown', handleKeydown) })
onUnmounted(() => { window.removeEventListener('keydown', handleKeydown) })

// Formatters
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(1)}ms`
  if (ms > 0) return `${(ms * 1000).toFixed(0)}us`
  return '-'
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function latencyClass(ms: number): string {
  if (ms >= 1000) return 'lat-high'
  if (ms >= 200) return 'lat-med'
  return 'lat-ok'
}

// ═══ Trace Funnels ═══

const svcFunnels     = ref<Funnel[]>([])
const svcFunnelLoaded = ref(false)
const svcFunnelSel   = ref<Funnel | null>(null)
const svcFunnelRes   = ref<FunnelResult | null>(null)
const svcFunnelBusy  = ref(false)
const svcFunnelRange = ref(60)
const svcFunnelErr   = ref<string | null>(null)
const svcFunnelShowCreate = ref(false)
const svcFunnelNewName    = ref('')
const svcFunnelSteps      = ref<FunnelStep[]>([])
const svcFunnelCreateErr  = ref<string | null>(null)

const RANGE_OPTS = [
  { l: '1h', v: 60 }, { l: '6h', v: 360 }, { l: '24h', v: 1440 }, { l: '7d', v: 10080 },
]

async function loadSvcFunnels() {
  try {
    const res = await api.listFunnels()
    // Prefer funnels that reference this service; fall back to all
    const all = res.funnels ?? []
    const matching = all.filter((f: Funnel) =>
      f.steps.some((s: FunnelStep) => s.service_name === serviceName.value)
    )
    svcFunnels.value = matching.length > 0 ? matching : all
    svcFunnelLoaded.value = true
    if (svcFunnels.value.length > 0 && !svcFunnelSel.value) {
      svcFunnelSel.value = svcFunnels.value[0]!
    }
  } catch { /* silent */ }
}

function selectSvcFunnel(f: Funnel) {
  svcFunnelSel.value = f
  svcFunnelRes.value = null
  svcFunnelErr.value = null
}

async function runSvcFunnel() {
  if (!svcFunnelSel.value) return
  svcFunnelBusy.value = true
  svcFunnelErr.value  = null
  svcFunnelRes.value  = null
  try {
    const to   = new Date().toISOString()
    const from = new Date(Date.now() - svcFunnelRange.value * 60_000).toISOString()
    svcFunnelRes.value = await api.runFunnel(svcFunnelSel.value.id, from, to)
  } catch (e: unknown) {
    svcFunnelErr.value = (e as Error)?.message || 'Failed to run funnel'
  } finally {
    svcFunnelBusy.value = false
  }
}

function initSvcFunnelSteps() {
  svcFunnelNewName.value = `${serviceName.value} funnel`
  svcFunnelSteps.value = [
    { label: serviceName.value, service_name: serviceName.value, http_path_prefix: '' },
    { label: 'Step 2', service_name: '', http_path_prefix: '' },
  ]
  svcFunnelCreateErr.value = null
}

function addSvcFunnelStep() {
  if (svcFunnelSteps.value.length >= 8) return
  svcFunnelSteps.value.push({
    label: `Step ${svcFunnelSteps.value.length + 1}`,
    service_name: '', http_path_prefix: '',
  })
}

function removeSvcFunnelStep(i: number) {
  if (svcFunnelSteps.value.length <= 2) return
  svcFunnelSteps.value.splice(i, 1)
}

async function createSvcFunnel() {
  svcFunnelCreateErr.value = null
  if (!svcFunnelNewName.value.trim()) {
    svcFunnelCreateErr.value = 'Name required'
    return
  }
  try {
    const steps = svcFunnelSteps.value.map(s => ({
      label: s.label,
      ...(s.service_name    ? { service_name: s.service_name }       : {}),
      ...(s.http_path_prefix ? { http_path_prefix: s.http_path_prefix } : {}),
    })) as FunnelStep[]
    const created = await api.createFunnel({ name: svcFunnelNewName.value.trim(), steps })
    svcFunnelShowCreate.value = false
    await loadSvcFunnels()
    // Select the newly created funnel
    const found = svcFunnels.value.find((f: Funnel) => f.id === (created as { id?: string })?.id)
    if (found) svcFunnelSel.value = found
  } catch (e: unknown) {
    svcFunnelCreateErr.value = (e as Error)?.message || 'Failed to create funnel'
  }
}

// ── SVG funnel geometry ──
const SF_CX      = 150   // center X in the 300-wide SVG
const SF_STEP_H  = 52    // height of each band
const SF_TAPER_H = 14    // height of taper between bands
const SF_MAX_HW  = 138   // half-width at 100%
const SF_MIN_HW  = 6     // minimum half-width (for near-zero steps)

function sfHalfW(pct: number): number {
  return Math.max((pct / 100) * SF_MAX_HW, SF_MIN_HW)
}
function sfBandY(i: number): number {
  return i * (SF_STEP_H + SF_TAPER_H)
}
function sfBandRect(i: number, pct: number): { x: number; y: number; w: number; h: number } {
  const hw = sfHalfW(pct)
  return { x: SF_CX - hw, y: sfBandY(i), w: hw * 2, h: SF_STEP_H }
}
function sfTaperPoints(i: number, pctTop: number, pctBot: number): string {
  const yT  = sfBandY(i) + SF_STEP_H
  const yB  = yT + SF_TAPER_H
  const hwT = sfHalfW(pctTop)
  const hwB = sfHalfW(pctBot)
  return `${SF_CX - hwT},${yT} ${SF_CX + hwT},${yT} ${SF_CX + hwB},${yB} ${SF_CX - hwB},${yB}`
}
function sfTotalH(n: number): number {
  return n * SF_STEP_H + (n - 1) * SF_TAPER_H
}
function sfColor(pct: number): string {
  if (pct >= 85) return '#22c55e'
  if (pct >= 65) return '#84cc16'
  if (pct >= 45) return '#f59e0b'
  if (pct >= 25) return '#f97316'
  return '#ef4444'
}
function sfFill(pct: number): string {
  if (pct >= 85) return 'rgba(34,197,94,0.16)'
  if (pct >= 65) return 'rgba(132,204,22,0.16)'
  if (pct >= 45) return 'rgba(245,158,11,0.16)'
  if (pct >= 25) return 'rgba(249,115,22,0.16)'
  return 'rgba(239,68,68,0.16)'
}
function sfPctLabel(step: FunnelResult['steps'][0], i: number): string {
  return i === 0 ? '100%' : step.pct_of_first.toFixed(1) + '%'
}


</script>

<template>
  <div class="svc-page">
    <!-- Header -->
    <div class="svc-page-header">
      <div class="svc-page-left">
        <button class="back-btn" @click="router.push('/services')">&larr; Services</button>
        <div class="svc-page-title">
          <span class="svc-dot" :class="health" />
          <span class="mono">{{ serviceName }}</span>
          <span class="health-badge" :class="health">{{ healthVerdict.label }}</span>
        </div>
        <div class="svc-health-why" :class="health">{{ healthVerdict.reasons.join(' · ') }}</div>
      </div>
      <div class="svc-page-controls">
        <TimePicker v-model="minutes" />
        <router-link
          :to="bubbleUpUrl(serviceName, windowFrom, windowTo)"
          class="btn-bubbleup"
          title="Identify outlier dimensions in this time window"
        >⬡ BubbleUp</router-link>
        <button class="refresh-btn" @click="loadData" :disabled="loading">{{ loading ? '...' : 'Refresh' }}</button>
      </div>
    </div>

    <!-- ═══ Top-level tab navigation (sticky) ═══ -->
    <nav class="svc-tabnav" role="tablist" aria-label="Service views">
      <router-link
        v-for="t in mainTabs" :key="t.id"
        :to="{ query: { ...route.query, tab: t.id } }"
        class="svc-maintab" :class="{ active: activeTab === t.id }"
        role="tab" :aria-selected="activeTab === t.id"
      >
        <span v-if="t.dot" class="svc-dot svc-maintab-dot" :class="t.dot" />
        <span class="svc-maintab-label">{{ t.label }}</span>
      </router-link>
    </nav>

    <div v-if="loading && timeseries.length === 0" class="empty-state card">
      <div class="empty-state-icon">&#9676;</div>
      <div>Loading service data...</div>
    </div>

    <template v-else>
      <!-- ░░░░ OVERVIEW ░░░░ — health KPIs, attached signals, topology -->
      <section v-show="activeTab === 'overview'" class="svc-panel">
      <!-- Summary stats -->
      <div class="svc-stats-row">
        <div class="svc-stat card">
          <div class="svc-stat-label">Total Requests</div>
          <div class="svc-stat-value mono">{{ formatCount(summary.total) }}</div>
        </div>
        <div class="svc-stat card">
          <div class="svc-stat-label">Error Rate</div>
          <div class="svc-stat-value mono" :class="{ 'status-error': summary.errorRate > 0.05 }">{{ formatPercent(summary.errorRate) }}</div>
        </div>
        <div class="svc-stat card">
          <div class="svc-stat-label">Avg Latency</div>
          <div class="svc-stat-value mono">{{ formatMs(summary.avgMs) }}</div>
        </div>
        <div class="svc-stat card">
          <div class="svc-stat-label">P50</div>
          <div class="svc-stat-value mono" :class="latencyClass(summary.p50)">{{ formatMs(summary.p50) }}</div>
        </div>
        <div class="svc-stat card">
          <div class="svc-stat-label">P95</div>
          <div class="svc-stat-value mono" :class="latencyClass(summary.p95)">{{ formatMs(summary.p95) }}</div>
        </div>
        <div class="svc-stat card">
          <div class="svc-stat-label">P99</div>
          <div class="svc-stat-value mono" :class="latencyClass(summary.p99)">{{ formatMs(summary.p99) }}</div>
        </div>
      </div>

      <!-- Attached to this service: alerts / SLOs / deploys / anomalies -->
      <div class="svc-attach-row">
        <router-link :to="{ path: '/alerts', query: { service: serviceName } }" class="svc-attach-tile" :class="{ crit: monitorsAlerting > 0, warn: monitorsAlerting === 0 && monitorsWarning > 0 }">
          <div class="svc-attach-top">
            <span class="svc-attach-label">Monitors</span>
            <span class="svc-attach-dot" :class="monitorsAlerting > 0 ? 'crit' : (monitorsWarning > 0 ? 'warn' : (serviceMonitors.length ? 'ok' : 'none'))" />
          </div>
          <div class="svc-attach-value mono">{{ serviceMonitors.length || '—' }}</div>
          <div class="svc-attach-sub">{{ serviceMonitors.length === 0 ? 'no monitors' : (monitorsAlerting > 0 ? `${monitorsAlerting} alerting` : (monitorsWarning > 0 ? `${monitorsWarning} warning` : 'all clear')) }}</div>
        </router-link>

        <router-link :to="{ path: '/slos', query: { service: serviceName } }" class="svc-attach-tile" :class="{ crit: slosBreaching > 0 }">
          <div class="svc-attach-top">
            <span class="svc-attach-label">SLOs</span>
            <span class="svc-attach-dot" :class="slosBreaching > 0 ? 'crit' : (serviceSlos.length ? 'ok' : 'none')" />
          </div>
          <div class="svc-attach-value mono">{{ serviceSlos.length || '—' }}</div>
          <div class="svc-attach-sub">{{ serviceSlos.length === 0 ? 'no SLOs' : (slosBreaching > 0 ? `${slosBreaching} breaching` : 'compliant') }}</div>
        </router-link>

        <router-link :to="{ path: '/deploys', query: { service: serviceName } }" class="svc-attach-tile">
          <div class="svc-attach-top">
            <span class="svc-attach-label">Last deploy</span>
            <span class="svc-attach-dot" :class="lastDeploy ? 'info' : 'none'" />
          </div>
          <div class="svc-attach-value mono">{{ lastDeploy ? (lastDeploy.version ? 'v' + lastDeploy.version : 'deploy') : '—' }}</div>
          <div class="svc-attach-sub">{{ lastDeploy ? relTime(lastDeploy.deployed_at) + (deploys.length > 1 ? ` · ${deploys.length} in window` : '') : 'none in window' }}</div>
        </router-link>

        <router-link :to="{ path: '/anomaly', query: { service: serviceName } }" class="svc-attach-tile" :class="{ warn: anomaliesFiring > 0 }">
          <div class="svc-attach-top">
            <span class="svc-attach-label">Anomalies</span>
            <span class="svc-attach-dot" :class="anomaliesFiring > 0 ? 'warn' : (serviceAnomalies.length ? 'ok' : 'none')" />
          </div>
          <div class="svc-attach-value mono">{{ serviceAnomalies.length || '—' }}</div>
          <div class="svc-attach-sub">{{ serviceAnomalies.length === 0 ? 'no rules' : (anomaliesFiring > 0 ? `${anomaliesFiring} firing` : 'normal') }}</div>
        </router-link>
      </div>

      <!-- Charts toolbar -->
      <div class="svc-charts-toolbar">
        <button
          class="cmp-toggle"
          :class="{ active: compareEnabled }"
          @click="compareEnabled = !compareEnabled"
          :title="compareEnabled ? 'Hide previous-period comparison' : 'Overlay the previous period'"
        >
          <span class="cmp-swatch"></span>
          vs previous {{ humanWindow }}
        </button>
      </div>

      <!-- Charts grid -->
      <div class="svc-charts-grid">
        <!-- Requests (bar) -->
        <PanelCard
          class="svc-chart-card chart-clickable"
          title="Requests"
          description="Request volume per bucket over the selected range. Click to expand."
          unit="req"
          @click="openChart('req')"
        >
          <div class="chart-body" @mousemove="onChartMove($event, 'req', requestCounts.length)" @mouseleave="onChartLeave">
            <div class="chart-y">
              <span class="y-label">{{ fmtAxis(reqMax, false) }}</span>
              <span class="y-label">{{ fmtAxis(reqMax / 2, false) }}</span>
              <span class="y-label">0</span>
            </div>
            <div class="chart-area">
              <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="svc-chart-svg">
                <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                <polyline v-if="cmpOn" :points="lineChartPoints(requestCountsPrev, reqMax)" class="cmp-line" />
                <rect v-for="(bar, i) in barChartBars(requestCounts, reqMax)" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" fill="var(--amber)" :opacity="anyChartHovered && hoverIdx === i ? 1 : 0.7" rx="1" />
                <g v-for="(m, mi) in deployMarkers" :key="'dep-req-' + mi">
                  <line :x1="m.x" :x2="m.x" y1="0" :y2="CHART_H" class="deploy-marker-line" />
                  <polygon :points="`${m.x - 2.5},0 ${m.x + 2.5},0 ${m.x},4`" class="deploy-marker-flag" />
                  <rect :x="m.x - 4" y="0" width="8" :height="CHART_H" fill="transparent"><title>{{ deployTooltip(m.d) }}</title></rect>
                </g>
              </svg>
              <div v-if="anyChartHovered" class="crosshair" :style="{ left: hoverLeft(requestCounts.length) }" />
              <div v-if="activeChart === 'req' && hoverIdx >= 0 && hoverIdx < requestCounts.length" class="chart-tip" :style="{ left: hoverLeft(requestCounts.length) }">
                <span class="tip-val">{{ formatCount(requestCounts[hoverIdx] ?? 0) }}</span>
                <template v-if="cmpOn">
                  <span class="tip-prev">prev {{ formatCount(prevAt(requestCountsPrev, hoverIdx)) }}</span>
                  <span v-if="deltaPct(requestCounts[hoverIdx] ?? 0, prevAt(requestCountsPrev, hoverIdx))" class="tip-delta" :class="deltaPct(requestCounts[hoverIdx] ?? 0, prevAt(requestCountsPrev, hoverIdx))!.cls">{{ deltaPct(requestCounts[hoverIdx] ?? 0, prevAt(requestCountsPrev, hoverIdx))!.txt }}</span>
                </template>
                <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
              </div>
            </div>
          </div>
          <div class="svc-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
        </PanelCard>

        <!-- Errors (bar) -->
        <PanelCard
          class="svc-chart-card chart-clickable"
          title="Errors"
          description="Count of error responses per bucket over the selected range. Click to expand."
          unit="errors"
          @click="openChart('err')"
        >
          <div class="chart-body" @mousemove="onChartMove($event, 'err', errorCounts.length)" @mouseleave="onChartLeave">
            <div class="chart-y">
              <span class="y-label">{{ fmtAxis(errMax, false) }}</span>
              <span class="y-label">{{ fmtAxis(errMax / 2, false) }}</span>
              <span class="y-label">0</span>
            </div>
            <div class="chart-area">
              <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="svc-chart-svg">
                <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                <polyline v-if="cmpOn" :points="lineChartPoints(errorCountsPrev, errMax)" class="cmp-line" />
                <rect v-for="(bar, i) in barChartBars(errorCounts, errMax)" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" fill="var(--error)" :opacity="anyChartHovered && hoverIdx === i ? 1 : 0.7" rx="1" />
                <g v-for="(m, mi) in deployMarkers" :key="'dep-err-' + mi">
                  <line :x1="m.x" :x2="m.x" y1="0" :y2="CHART_H" class="deploy-marker-line" />
                  <polygon :points="`${m.x - 2.5},0 ${m.x + 2.5},0 ${m.x},4`" class="deploy-marker-flag" />
                  <rect :x="m.x - 4" y="0" width="8" :height="CHART_H" fill="transparent"><title>{{ deployTooltip(m.d) }}</title></rect>
                </g>
              </svg>
              <div v-if="anyChartHovered" class="crosshair" :style="{ left: hoverLeft(errorCounts.length) }" />
              <div v-if="activeChart === 'err' && hoverIdx >= 0 && hoverIdx < errorCounts.length" class="chart-tip" :style="{ left: hoverLeft(errorCounts.length) }">
                <span class="tip-val">{{ formatCount(errorCounts[hoverIdx] ?? 0) }}</span>
                <template v-if="cmpOn">
                  <span class="tip-prev">prev {{ formatCount(prevAt(errorCountsPrev, hoverIdx)) }}</span>
                  <span v-if="deltaPct(errorCounts[hoverIdx] ?? 0, prevAt(errorCountsPrev, hoverIdx))" class="tip-delta" :class="deltaPct(errorCounts[hoverIdx] ?? 0, prevAt(errorCountsPrev, hoverIdx))!.cls">{{ deltaPct(errorCounts[hoverIdx] ?? 0, prevAt(errorCountsPrev, hoverIdx))!.txt }}</span>
                </template>
                <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
              </div>
            </div>
          </div>
          <div class="svc-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
        </PanelCard>

        <!-- Combined Latency (all percentiles on one graph) -->
        <PanelCard
          class="svc-chart-card chart-clickable"
          title="Latency"
          description="Request latency percentiles (P50/P95/P99) and average per bucket. Click to expand."
          unit="ms"
          @click="openChart('latency')"
        >
          <div class="latency-legend">
            <span class="latency-legend-item"><span class="latency-dot" style="background:var(--amber)"></span>P50</span>
            <span class="latency-legend-item"><span class="latency-dot" style="background:var(--ok)"></span>P95</span>
            <span class="latency-legend-item"><span class="latency-dot" style="background:var(--error)"></span>P99</span>
            <span class="latency-legend-item"><span class="latency-dot" style="background:var(--text-secondary)"></span>Avg</span>
          </div>
          <div class="chart-body" style="height:120px" @mousemove="onChartMove($event, 'latency', p50.length)" @mouseleave="onChartLeave">
            <div class="chart-y">
              <span class="y-label">{{ fmtAxis(latencyMax, true) }}</span>
              <span class="y-label">{{ fmtAxis(latencyMax / 2, true) }}</span>
              <span class="y-label">0</span>
            </div>
            <div class="chart-area">
              <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="svc-chart-svg">
                <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                <!-- Previous-period ghosts (behind current lines) -->
                <template v-if="cmpOn">
                  <polyline :points="lineChartPoints(p99Prev, latencyMax)" fill="none" stroke="var(--error)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                  <polyline :points="lineChartPoints(p95Prev, latencyMax)" fill="none" stroke="var(--ok)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                  <polyline :points="lineChartPoints(p50Prev, latencyMax)" fill="none" stroke="var(--amber)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                </template>
                <!-- P99 area (back) -->
                <path :d="lineChartArea(p99, latencyMax)" fill="var(--error)" opacity="0.05" />
                <polyline :points="lineChartPoints(p99, latencyMax)" fill="none" stroke="var(--error)" stroke-width="1.5" stroke-linejoin="round" />
                <!-- P95 -->
                <polyline :points="lineChartPoints(p95, latencyMax)" fill="none" stroke="var(--ok)" stroke-width="1.5" stroke-linejoin="round" />
                <!-- P50 -->
                <path :d="lineChartArea(p50, latencyMax)" fill="var(--amber)" opacity="0.08" />
                <polyline :points="lineChartPoints(p50, latencyMax)" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linejoin="round" />
                <!-- Avg (dashed) -->
                <polyline :points="lineChartPoints(avg, latencyMax)" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linejoin="round" />
                <g v-for="(m, mi) in deployMarkers" :key="'dep-lat-' + mi">
                  <line :x1="m.x" :x2="m.x" y1="0" :y2="CHART_H" class="deploy-marker-line" />
                  <polygon :points="`${m.x - 2.5},0 ${m.x + 2.5},0 ${m.x},4`" class="deploy-marker-flag" />
                  <rect :x="m.x - 4" y="0" width="8" :height="CHART_H" fill="transparent"><title>{{ deployTooltip(m.d) }}</title></rect>
                </g>
              </svg>
              <div v-if="anyChartHovered" class="crosshair" :style="{ left: hoverLeft(p50.length) }" />
              <div v-if="activeChart === 'latency' && hoverIdx >= 0 && hoverIdx < p50.length" class="chart-tip chart-tip-multi" :style="{ left: hoverLeft(p50.length) }">
                <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
                <span class="tip-row"><span class="latency-dot" style="background:var(--amber)"></span>P50 {{ formatMs(p50[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p50Prev, hoverIdx)) }}</span></span>
                <span class="tip-row"><span class="latency-dot" style="background:var(--ok)"></span>P95 {{ formatMs(p95[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p95Prev, hoverIdx)) }}</span></span>
                <span class="tip-row"><span class="latency-dot" style="background:var(--error)"></span>P99 {{ formatMs(p99[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p99Prev, hoverIdx)) }}</span></span>
                <span class="tip-row"><span class="latency-dot" style="background:var(--text-secondary)"></span>Avg {{ formatMs(avg[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(avgPrev, hoverIdx)) }}</span></span>
                <span v-if="cmpOn" class="tip-prev-note">now / prev {{ humanWindow }}</span>
              </div>
            </div>
          </div>
          <div class="svc-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
        </PanelCard>

        <!-- Latency Distribution (histogram of request durations) -->
        <PanelCard
          class="svc-chart-card chart-clickable"
          title="Latency Distribution"
          description="Distribution of request durations across latency buckets. Click to expand."
          unit="count"
          @click="openChart('hist')"
        >
          <div v-if="!hasHist" class="svc-map-empty text-muted">No latency data</div>
          <template v-else>
            <div class="chart-body" @mousemove="onChartMove($event, 'hist', histCounts.length)" @mouseleave="onChartLeave">
              <div class="chart-y">
                <span class="y-label">{{ fmtAxis(chartMax(histCounts), false) }}</span>
                <span class="y-label">{{ fmtAxis(chartMax(histCounts) / 2, false) }}</span>
                <span class="y-label">0</span>
              </div>
              <div class="chart-area">
                <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="svc-chart-svg">
                  <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                  <rect v-for="(bar, i) in barChartBars(histCounts)" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" fill="var(--purple, #8b5cf6)" :opacity="anyChartHovered && hoverIdx === i ? 1 : 0.6" rx="1" />
                  <line v-for="(m, mi) in histMarkers" :key="'hm-' + mi" :x1="m.x" :x2="m.x" y1="0" :y2="CHART_H" :stroke="m.color" stroke-width="1" stroke-dasharray="2,2" opacity="0.85" vector-effect="non-scaling-stroke" />
                </svg>
                <div v-if="anyChartHovered" class="crosshair" :style="{ left: hoverLeft(histCounts.length) }" />
                <div v-if="activeChart === 'hist' && hoverIdx >= 0 && hoverIdx < histCounts.length" class="chart-tip" :style="{ left: hoverLeft(histCounts.length) }">
                  <span class="tip-val">{{ formatCount(histCounts[hoverIdx] ?? 0) }}</span>
                  <span class="tip-time">{{ histHoverLabel(hoverIdx) }}</span>
                </div>
              </div>
            </div>
            <div class="svc-chart-time hist-axis">
              <span>{{ histMinLabel }}</span>
              <span class="hist-legend">
                <span v-for="(m, mi) in histMarkers" :key="'hl-' + mi" class="hist-legend-item"><span class="latency-dot" :style="{ background: m.color }"></span>{{ m.label }}</span>
              </span>
              <span>{{ histMaxLabel }}</span>
            </div>
          </template>
        </PanelCard>
      </div>

      <!-- Topology: who calls this service and what it depends on -->
      <div class="svc-overview-grid">
        <PanelCard
          class="svc-chart-card chart-clickable svc-map-card"
          title="Service Map"
          description="Upstream and downstream services connected to this service, colored by error rate. Click to expand."
          @click="openChart('map')"
        >
          <div v-if="svcConnected.length === 0" class="svc-map-empty text-muted">No connections found</div>
          <svg v-else viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet" class="svc-map-svg">
            <template v-for="(src, i) in svcEdges.incoming.slice(0, 3)" :key="'in-' + src.source">
              <line :x1="20" :y1="20 + i * 30" x2="120" y2="50" :stroke="edgeColor(src)" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#map-arrow)" opacity="0.8"><title>{{ edgeTitle(src, src.source) }}</title></line>
              <text :x="18" :y="20 + i * 30" text-anchor="end" class="map-label" dominant-baseline="central">{{ src.source }}</text>
            </template>
            <rect x="110" y="35" width="80" height="30" rx="4" fill="var(--amber-dim)" stroke="var(--amber)" stroke-width="1.5" />
            <text x="150" y="50" text-anchor="middle" dominant-baseline="central" class="map-center">{{ serviceName }}</text>
            <template v-for="(tgt, i) in svcEdges.outgoing.slice(0, 3)" :key="'out-' + tgt.target">
              <line x1="190" y1="50" :x2="280" :y2="20 + i * 30" :stroke="edgeColor(tgt)" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#map-arrow)" opacity="0.8"><title>{{ edgeTitle(tgt, tgt.target) }}</title></line>
              <text :x="282" :y="20 + i * 30" text-anchor="start" class="map-label" dominant-baseline="central">{{ tgt.target }}</text>
            </template>
            <defs>
              <marker id="map-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="var(--text-muted)" opacity="0.5" />
              </marker>
            </defs>
          </svg>
          <div class="svc-map-legend">
            <span class="mlg"><span class="mlg-dot" style="background:var(--ok)"></span>healthy</span>
            <span class="mlg"><span class="mlg-dot" style="background:var(--warning)"></span>&gt;1% err</span>
            <span class="mlg"><span class="mlg-dot" style="background:var(--error)"></span>&gt;10% err</span>
          </div>
        </PanelCard>
      </div>
      </section><!-- /overview -->

      <!-- ░░░░ ENDPOINTS ░░░░ — per-endpoint RED + top errors -->
      <section v-show="activeTab === 'endpoints'" class="svc-panel">
      <!-- ═══ Endpoints / Top Errors (tabbed) ═══ -->
      <div class="svc-tabs card" ref="tabsCardRef">
        <div class="ep-header">
          <div class="svc-tab-row">
            <button class="svc-tab" :class="{ active: activeServiceTab === 'endpoints' }" @click="setServiceTab('endpoints')">Endpoints</button>
            <button class="svc-tab" :class="{ active: activeServiceTab === 'errors' }" @click="setServiceTab('errors')">Top Errors</button>
          </div>
          <div v-if="activeServiceTab === 'endpoints'" class="ep-mode-toggle">
            <button class="ep-mode-btn" :class="{ active: endpointsMode === 'server' }" @click="setEndpointsMode('server')">Endpoints</button>
            <button class="ep-mode-btn" :class="{ active: endpointsMode === 'operation' }" @click="setEndpointsMode('operation')">Operations</button>
          </div>
          <div v-else-if="activeServiceTab === 'errors'" class="ep-mode-toggle">
            <button class="ep-mode-btn" :class="{ active: errorsMode === 'endpoint' }" @click="setErrorsMode('endpoint')">By endpoint</button>
            <button class="ep-mode-btn" :class="{ active: errorsMode === 'message' }" @click="setErrorsMode('message')">By message</button>
          </div>
        </div>

        <!-- Endpoints tab -->
        <template v-if="activeServiceTab === 'endpoints'">
          <div v-if="endpointsLoading || !endpointsSeen" class="ep-empty text-muted">Loading…</div>
          <div v-else-if="sortedEndpoints.length === 0" class="ep-empty text-muted">
            {{ endpointsMode === 'server' ? 'No HTTP endpoints in this window' : 'No operations in this window' }}
          </div>
          <table v-else class="ep-table">
            <thead>
              <tr>
                <th class="ep-th-name sortable" @click="setEpSort('endpoint')">{{ endpointsMode === 'server' ? 'Endpoint' : 'Operation' }}<span class="ep-sort">{{ epSortIndicator('endpoint') }}</span></th>
                <th class="sortable" @click="setEpSort('req')">Req<span class="ep-sort">{{ epSortIndicator('req') }}</span></th>
                <th>Rate</th>
                <th class="sortable" @click="setEpSort('errRate')">Err%<span class="ep-sort">{{ epSortIndicator('errRate') }}</span></th>
                <th class="sortable" @click="setEpSort('p50_ms')">P50<span class="ep-sort">{{ epSortIndicator('p50_ms') }}</span></th>
                <th class="sortable" @click="setEpSort('p95_ms')">P95<span class="ep-sort">{{ epSortIndicator('p95_ms') }}</span></th>
                <th class="sortable" @click="setEpSort('p99_ms')">P99<span class="ep-sort">{{ epSortIndicator('p99_ms') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in sortedEndpoints" :key="e.endpoint" class="ep-row" @click="exploreEndpoint(e)" title="Open in Explore">
                <td class="ep-name">
                  <span class="ep-dot" :style="{ background: epColor(e) }"></span>
                  <span v-if="e.method" class="ep-method">{{ e.method }}</span>
                  <span class="mono ep-path">{{ endpointsMode === 'server' ? (e.path || '/') : e.endpoint }}</span>
                </td>
                <td class="mono">{{ formatCount(e.req) }}</td>
                <td class="mono ep-sub">{{ formatRps(epRps(e)) }}</td>
                <td class="mono" :style="{ color: epColor(e) }">{{ formatPercent(epErrorRate(e)) }}</td>
                <td class="mono">{{ formatMs(e.p50_ms) }}</td>
                <td class="mono">{{ formatMs(e.p95_ms) }}</td>
                <td class="mono">{{ formatMs(e.p99_ms) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Top Errors tab -->
        <template v-else-if="activeServiceTab === 'errors'">
          <div v-if="errorsLoading || !errorsSeen" class="ep-empty text-muted">Loading…</div>
          <div v-else-if="errorGroups.length === 0" class="ep-empty text-muted">
            {{ errorsMode === 'endpoint' ? 'No errors in this window' : 'No error/warn logs in this window' }}
          </div>
          <table v-else class="ep-table">
            <thead>
              <tr>
                <th class="ep-th-name">{{ errorsMode === 'endpoint' ? 'Error' : 'Message' }}</th>
                <th>Count</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in errorGroups" :key="g.key" class="ep-row" @click="exploreError(g)" title="Open in Explore">
                <td class="ep-name">
                  <template v-if="errorsMode === 'endpoint'">
                    <span class="err-badge" :style="{ color: errStatusColor(g.status_code), borderColor: errStatusColor(g.status_code) }">{{ g.status_code }}</span>
                    <span v-if="g.method" class="ep-method">{{ g.method }}</span>
                    <span class="mono ep-path">{{ g.path }}</span>
                  </template>
                  <template v-else>
                    <span class="err-badge" :style="{ color: errSeverityColor(g.severity), borderColor: errSeverityColor(g.severity) }">{{ g.severity }}</span>
                    <span class="mono err-msg" :title="g.example">{{ g.key }}</span>
                  </template>
                </td>
                <td class="mono">{{ formatCount(g.count) }}</td>
                <td class="mono ep-sub">{{ relTime(g.last_seen) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

      </div>
      </section><!-- /endpoints -->

      <!-- ░░░░ SPANS ░░░░ — recent spans for this service -->
      <section v-show="activeTab === 'spans'" class="svc-panel">
        <div class="svc-tab-logs card">
          <SpanLogTable
            force-mode="spans"
            :spans="traces"
            :show-service="false"
            :loading="loading || tracesLoading || !tracesSeen"
            :service-name="serviceName"
            :minutes="minutes"
            @click-span="(span) => router.push(`/trace/${span.trace_id}`)"
            @click-trace="(traceId) => router.push(`/trace/${traceId}`)"
          />
        </div>
      </section><!-- /spans -->

      <!-- ░░░░ LOGS ░░░░ — APM log lines extracted from span events -->
      <section v-show="activeTab === 'logs'" class="svc-panel">
        <div class="svc-tab-logs card">
          <SpanLogTable
            force-mode="logs"
            :spans="traces"
            :show-service="false"
            :loading="loading || tracesLoading || !tracesSeen"
            :service-name="serviceName"
            :minutes="minutes"
            @click-span="(span) => router.push(`/trace/${span.trace_id}`)"
            @click-trace="(traceId) => router.push(`/trace/${traceId}`)"
          />
        </div>
      </section><!-- /logs -->

      <!-- ░░░░ FUNNELS ░░░░ — trace funnel drop-off -->
      <section v-show="activeTab === 'funnels'" class="svc-panel">
      <!-- ═══ Trace Funnels ═══ -->
      <div class="svc-funnels card" ref="funnelsRef">
        <!-- Header row -->
        <div class="sf-header">
          <div class="sf-title">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" class="sf-icon-svg">
              <path d="M1 2h12l-5 6v4l-2-1V8L1 2z" stroke="currentColor" stroke-width="1.4"
                    stroke-linejoin="round" fill="none"/>
            </svg>
            Trace Funnels
          </div>
          <div class="sf-header-right">
            <template v-if="svcFunnelSel">
              <div class="sf-range-row">
                <button
                  v-for="opt in RANGE_OPTS" :key="opt.v"
                  class="sf-range-btn" :class="{ active: svcFunnelRange === opt.v }"
                  @click="svcFunnelRange = opt.v"
                >{{ opt.l }}</button>
              </div>
              <button class="sf-run-btn" @click="runSvcFunnel" :disabled="svcFunnelBusy">
                <span v-if="svcFunnelBusy" class="sf-spinner">⟳</span>
                <span v-else>▶ Run</span>
              </button>
            </template>
            <button
              class="sf-new-btn"
              :class="{ active: svcFunnelShowCreate }"
              @click="svcFunnelShowCreate = !svcFunnelShowCreate; if (svcFunnelShowCreate) initSvcFunnelSteps()"
            >{{ svcFunnelShowCreate ? '✕' : '+ New' }}</button>
          </div>
        </div>

        <!-- Create form -->
        <div v-if="svcFunnelShowCreate" class="sf-create-form">
          <div class="sf-form-row">
            <label class="sf-label">Name</label>
            <input class="sf-input sf-input-wide" v-model="svcFunnelNewName" placeholder="e.g. Checkout flow" />
          </div>
          <div class="sf-steps-list">
            <div v-for="(step, i) in svcFunnelSteps" :key="i" class="sf-step-row">
              <span class="sf-step-idx">{{ i + 1 }}</span>
              <input class="sf-input" v-model="step.label" placeholder="Label" style="width:100px" />
              <input class="sf-input" v-model="step.service_name" placeholder="service" style="width:120px" />
              <input class="sf-input mono" v-model="step.http_path_prefix" placeholder="/path/prefix" style="width:130px" />
              <input class="sf-input" type="number" v-model.number="step.min_status_code" placeholder="min" style="width:54px" />
              <span class="sf-range-sep">–</span>
              <input class="sf-input" type="number" v-model.number="step.max_status_code" placeholder="max" style="width:54px" />
              <button v-if="svcFunnelSteps.length > 2" class="sf-remove-btn" @click="removeSvcFunnelStep(i)" title="Remove">✕</button>
            </div>
          </div>
          <div class="sf-form-actions">
            <button class="sf-add-step-btn" @click="addSvcFunnelStep" :disabled="svcFunnelSteps.length >= 8">+ Step</button>
            <div class="sf-form-actions-right">
              <div v-if="svcFunnelCreateErr" class="sf-form-err">{{ svcFunnelCreateErr }}</div>
              <button class="sf-btn-cancel" @click="svcFunnelShowCreate = false">Cancel</button>
              <button class="sf-btn-create" @click="createSvcFunnel">Create Funnel</button>
            </div>
          </div>
        </div>

        <!-- Funnel pills -->
        <div v-if="svcFunnelLoaded && svcFunnels.length > 0" class="sf-pills">
          <button
            v-for="f in svcFunnels" :key="f.id"
            class="sf-pill" :class="{ active: svcFunnelSel?.id === f.id }"
            @click="selectSvcFunnel(f)"
          >
            <span class="sf-pill-name">{{ f.name }}</span>
            <span class="sf-pill-steps">{{ f.steps.length }}s</span>
          </button>
        </div>

        <div v-if="svcFunnelLoaded && svcFunnels.length === 0 && !svcFunnelShowCreate"
             class="sf-empty-hint">
          No funnels yet — create one to track drop-off through {{ serviceName }}
        </div>

        <!-- Error -->
        <div v-if="svcFunnelErr" class="sf-err-msg">{{ svcFunnelErr }}</div>

        <!-- ── Result visualization ── -->
        <div v-if="svcFunnelRes" class="sf-result">
          <div class="sf-funnel-layout">
            <!-- Left: step labels -->
            <div class="sf-labels">
              <div
                v-for="(step, i) in svcFunnelRes.steps" :key="i"
                class="sf-label-cell"
                :style="{ height: SF_STEP_H + 'px', marginBottom: i < svcFunnelRes.steps.length - 1 ? SF_TAPER_H + 'px' : '0' }"
              >
                <span class="sf-label-num">{{ i + 1 }}</span>
                <span class="sf-label-text">{{ step.label }}</span>
              </div>
            </div>

            <!-- Center: SVG funnel -->
            <svg
              :viewBox="`0 0 300 ${sfTotalH(svcFunnelRes.steps.length)}`"
              :height="sfTotalH(svcFunnelRes.steps.length)"
              width="300"
              class="sf-funnel-svg"
              preserveAspectRatio="xMidYMin meet"
            >
              <template v-for="(step, i) in svcFunnelRes.steps" :key="i">
                <!-- Band -->
                <rect
                  :x="sfBandRect(i, step.pct_of_first).x"
                  :y="sfBandRect(i, step.pct_of_first).y"
                  :width="sfBandRect(i, step.pct_of_first).w"
                  :height="sfBandRect(i, step.pct_of_first).h"
                  :fill="sfFill(step.pct_of_first)"
                  :stroke="sfColor(step.pct_of_first)"
                  stroke-width="1.5"
                  rx="3"
                  class="sf-band"
                  :style="{ animationDelay: `${i * 70}ms` }"
                />
                <!-- Taper to next step -->
                <polygon
                  v-if="i < svcFunnelRes.steps.length - 1"
                  :points="sfTaperPoints(i, step.pct_of_first, svcFunnelRes.steps[i + 1]!.pct_of_first)"
                  :fill="sfFill(step.pct_of_first)"
                  fill-opacity="0.45"
                  stroke="none"
                  class="sf-taper"
                  :style="{ animationDelay: `${i * 70 + 35}ms` }"
                />
                <!-- Count label inside band -->
                <text
                  :x="SF_CX"
                  :y="sfBandY(i) + SF_STEP_H / 2"
                  text-anchor="middle"
                  dominant-baseline="central"
                  class="sf-band-count"
                >{{ step.count.toLocaleString() }}</text>
              </template>
            </svg>

            <!-- Right: pct + drop-off -->
            <div class="sf-stats">
              <div
                v-for="(step, i) in svcFunnelRes.steps" :key="i"
                class="sf-stat-cell"
                :style="{ height: SF_STEP_H + 'px', marginBottom: i < svcFunnelRes.steps.length - 1 ? SF_TAPER_H + 'px' : '0' }"
              >
                <span class="sf-stat-pct" :style="{ color: sfColor(i === 0 ? 100 : step.pct_of_first) }">
                  {{ sfPctLabel(step, i) }}
                </span>
                <span v-if="i > 0" class="sf-stat-drop">
                  −{{ step.drop_off.toLocaleString() }}
                </span>
                <span v-if="i > 0" class="sf-stat-prev">
                  {{ step.pct_of_prev.toFixed(0) }}% of prev
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </section><!-- /funnels -->

    </template>

    <!-- ═══ Expanded chart modal ═══ -->
    <Teleport to="body">
      <div v-if="expandedChart" class="chart-modal-overlay" @click.self="closeChart">
        <div class="chart-modal">
          <div class="chart-modal-header">
            <span class="chart-modal-title">{{ chartLabel(expandedChart) }}</span>
            <button class="chart-modal-close" @click="closeChart">&times;</button>
          </div>
          <div class="chart-modal-body">
            <!-- Service Map -->
            <template v-if="expandedChart === 'map'">
              <div v-if="svcConnected.length === 0" class="svc-map-empty text-muted">No connections found</div>
              <svg v-else viewBox="0 0 600 250" preserveAspectRatio="xMidYMid meet" class="modal-map-svg">
                <template v-for="(src, i) in svcEdges.incoming.slice(0, 5)" :key="'min-' + src.source">
                  <line :x1="40" :y1="30 + i * 45" x2="230" y2="125" :stroke="edgeColor(src)" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#modal-arrow)" opacity="0.85"><title>{{ edgeTitle(src, src.source) }}</title></line>
                  <text :x="36" :y="30 + i * 45" text-anchor="end" class="modal-map-label" dominant-baseline="central">{{ src.source }}</text>
                </template>
                <rect x="220" y="100" width="160" height="50" rx="6" fill="var(--amber-dim)" stroke="var(--amber)" stroke-width="2" />
                <text x="300" y="125" text-anchor="middle" dominant-baseline="central" class="modal-map-center">{{ serviceName }}</text>
                <template v-for="(tgt, i) in svcEdges.outgoing.slice(0, 5)" :key="'mout-' + tgt.target">
                  <line x1="380" y1="125" :x2="560" :y2="30 + i * 45" :stroke="edgeColor(tgt)" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#modal-arrow)" opacity="0.85"><title>{{ edgeTitle(tgt, tgt.target) }}</title></line>
                  <text :x="564" :y="30 + i * 45" text-anchor="start" class="modal-map-label" dominant-baseline="central">{{ tgt.target }}</text>
                </template>
                <defs>
                  <marker id="modal-arrow" markerWidth="8" markerHeight="5" refX="8" refY="2.5" orient="auto">
                    <polygon points="0 0, 8 2.5, 0 5" fill="var(--text-muted)" opacity="0.5" />
                  </marker>
                </defs>
              </svg>

              <!-- Dependency RED table: upstream callers + downstream dependencies,
                   each with rate / error% / latency and a health dot. -->
              <div class="dep-red">
                <div class="dep-red-col" v-if="svcEdges.incoming.length">
                  <div class="dep-red-head">Upstream — callers</div>
                  <div class="dep-red-row dep-red-hdr"><span>Service</span><span>Req</span><span>Err</span><span>Avg</span></div>
                  <button v-for="e in svcEdges.incoming" :key="'dr-in-' + e.source" class="dep-red-row" @click="goToService(e.source)">
                    <span class="dep-svc"><span class="dep-dot" :style="{ background: edgeColor(e) }"></span>{{ e.source }}</span>
                    <span class="mono">{{ formatCount(e.request_count) }}</span>
                    <span class="mono" :style="{ color: edgeColor(e) }">{{ formatPercent(edgeErrorRate(e)) }}</span>
                    <span class="mono">{{ formatMs(e.avg_duration_ms) }}</span>
                  </button>
                </div>
                <div class="dep-red-col" v-if="svcEdges.outgoing.length">
                  <div class="dep-red-head">Downstream — dependencies</div>
                  <div class="dep-red-row dep-red-hdr"><span>Service</span><span>Req</span><span>Err</span><span>Avg</span></div>
                  <button v-for="e in svcEdges.outgoing" :key="'dr-out-' + e.target" class="dep-red-row" @click="goToService(e.target)">
                    <span class="dep-svc"><span class="dep-dot" :style="{ background: edgeColor(e) }"></span>{{ e.target }}</span>
                    <span class="mono">{{ formatCount(e.request_count) }}</span>
                    <span class="mono" :style="{ color: edgeColor(e) }">{{ formatPercent(edgeErrorRate(e)) }}</span>
                    <span class="mono">{{ formatMs(e.avg_duration_ms) }}</span>
                  </button>
                </div>
              </div>
            </template>

            <!-- Latency Distribution (histogram, expanded) -->
            <template v-else-if="expandedChart === 'hist'">
              <div v-if="!hasHist" class="svc-map-empty text-muted">No latency data in this window</div>
              <template v-else>
                <div class="chart-body modal-chart-body" @mousemove="onChartMove($event, 'hist', histCounts.length)" @mouseleave="onChartLeave">
                  <div class="chart-y">
                    <span class="y-label">{{ fmtAxis(chartMax(histCounts), false) }}</span>
                    <span class="y-label">{{ fmtAxis(chartMax(histCounts) / 2, false) }}</span>
                    <span class="y-label">0</span>
                  </div>
                  <div class="chart-area">
                    <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="modal-chart-svg">
                      <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                      <rect v-for="(bar, i) in barChartBars(histCounts)" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" fill="var(--purple, #8b5cf6)" :opacity="activeChart === 'hist' && hoverIdx === i ? 1 : 0.6" rx="1" />
                      <line v-for="(m, mi) in histMarkers" :key="'mhm-' + mi" :x1="m.x" :x2="m.x" y1="0" :y2="CHART_H" :stroke="m.color" stroke-width="1" stroke-dasharray="3,2" opacity="0.85" vector-effect="non-scaling-stroke" />
                    </svg>
                    <div v-if="activeChart === 'hist'" class="crosshair" :style="{ left: hoverLeft(histCounts.length) }" />
                    <div v-if="activeChart === 'hist' && hoverIdx >= 0 && hoverIdx < histCounts.length" class="chart-tip" :style="{ left: hoverLeft(histCounts.length) }">
                      <span class="tip-val">{{ formatCount(histCounts[hoverIdx] ?? 0) }}</span>
                      <span class="tip-time">{{ histHoverLabel(hoverIdx) }}</span>
                    </div>
                  </div>
                </div>
                <div class="svc-chart-time modal-chart-time hist-axis">
                  <span>{{ histMinLabel }}</span>
                  <span class="hist-legend">
                    <span v-for="(m, mi) in histMarkers" :key="'mhl-' + mi" class="hist-legend-item"><span class="latency-dot" :style="{ background: m.color }"></span>{{ m.label }} {{ m.val }}</span>
                  </span>
                  <span>{{ histMaxLabel }}</span>
                </div>
              </template>
            </template>

            <!-- Bar charts (req, err) -->
            <template v-else-if="expandedChart === 'req' || expandedChart === 'err'">
              <div class="chart-body modal-chart-body" @mousemove="onChartMove($event, expandedChart!, chartVals(expandedChart!).length)" @mouseleave="onChartLeave">
                <div class="chart-y">
                  <span class="y-label">{{ fmtAxis(chartSharedMax(expandedChart!), false) }}</span>
                  <span class="y-label">{{ fmtAxis(chartSharedMax(expandedChart!) / 2, false) }}</span>
                  <span class="y-label">0</span>
                </div>
                <div class="chart-area">
                  <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="modal-chart-svg">
                    <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                    <polyline v-if="cmpOn" :points="lineChartPoints(chartValsPrev(expandedChart!), chartSharedMax(expandedChart!))" class="cmp-line" />
                    <rect v-for="(bar, i) in barChartBars(chartVals(expandedChart!), chartSharedMax(expandedChart!))" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" :fill="chartColor(expandedChart!)" :opacity="activeChart === expandedChart && hoverIdx === i ? 1 : 0.7" rx="1" />
                  </svg>
                  <div v-if="activeChart === expandedChart" class="crosshair" :style="{ left: hoverLeft(chartVals(expandedChart!).length) }" />
                  <div v-if="activeChart === expandedChart && hoverIdx >= 0 && hoverIdx < chartVals(expandedChart!).length" class="chart-tip" :style="{ left: hoverLeft(chartVals(expandedChart!).length) }">
                    <span class="tip-val">{{ chartFmtVal(expandedChart!, chartVals(expandedChart!)[hoverIdx] ?? 0) }}</span>
                    <template v-if="cmpOn">
                      <span class="tip-prev">prev {{ chartFmtVal(expandedChart!, prevAt(chartValsPrev(expandedChart!), hoverIdx)) }}</span>
                      <span v-if="deltaPct(chartVals(expandedChart!)[hoverIdx] ?? 0, prevAt(chartValsPrev(expandedChart!), hoverIdx))" class="tip-delta" :class="deltaPct(chartVals(expandedChart!)[hoverIdx] ?? 0, prevAt(chartValsPrev(expandedChart!), hoverIdx))!.cls">{{ deltaPct(chartVals(expandedChart!)[hoverIdx] ?? 0, prevAt(chartValsPrev(expandedChart!), hoverIdx))!.txt }}</span>
                    </template>
                    <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
                  </div>
                </div>
              </div>
              <div class="svc-chart-time modal-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
            </template>

            <!-- Combined latency (expanded) -->
            <template v-else-if="expandedChart === 'latency'">
              <div class="latency-legend" style="margin-bottom:8px">
                <span class="latency-legend-item"><span class="latency-dot" style="background:var(--amber)"></span>P50</span>
                <span class="latency-legend-item"><span class="latency-dot" style="background:var(--ok)"></span>P95</span>
                <span class="latency-legend-item"><span class="latency-dot" style="background:var(--error)"></span>P99</span>
                <span class="latency-legend-item"><span class="latency-dot" style="background:var(--text-secondary)"></span>Avg</span>
              </div>
              <div class="chart-body modal-chart-body" @mousemove="onChartMove($event, 'latency', p50.length)" @mouseleave="onChartLeave">
                <div class="chart-y">
                  <span class="y-label">{{ fmtAxis(latencyMax, true) }}</span>
                  <span class="y-label">{{ fmtAxis(latencyMax / 2, true) }}</span>
                  <span class="y-label">0</span>
                </div>
                <div class="chart-area">
                  <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="modal-chart-svg">
                    <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                    <template v-if="cmpOn">
                      <polyline :points="lineChartPoints(p99Prev, latencyMax)" fill="none" stroke="var(--error)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                      <polyline :points="lineChartPoints(p95Prev, latencyMax)" fill="none" stroke="var(--ok)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                      <polyline :points="lineChartPoints(p50Prev, latencyMax)" fill="none" stroke="var(--amber)" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" stroke-linejoin="round" />
                    </template>
                    <path :d="lineChartArea(p99, latencyMax)" fill="var(--error)" opacity="0.05" />
                    <polyline :points="lineChartPoints(p99, latencyMax)" fill="none" stroke="var(--error)" stroke-width="1.5" stroke-linejoin="round" />
                    <polyline :points="lineChartPoints(p95, latencyMax)" fill="none" stroke="var(--ok)" stroke-width="1.5" stroke-linejoin="round" />
                    <path :d="lineChartArea(p50, latencyMax)" fill="var(--amber)" opacity="0.08" />
                    <polyline :points="lineChartPoints(p50, latencyMax)" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linejoin="round" />
                    <polyline :points="lineChartPoints(avg, latencyMax)" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linejoin="round" />
                  </svg>
                  <div v-if="activeChart === 'latency'" class="crosshair" :style="{ left: hoverLeft(p50.length) }" />
                  <div v-if="activeChart === 'latency' && hoverIdx >= 0 && hoverIdx < p50.length" class="chart-tip chart-tip-multi" :style="{ left: hoverLeft(p50.length) }">
                    <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
                    <span class="tip-row"><span class="latency-dot" style="background:var(--amber)"></span>P50 {{ formatMs(p50[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p50Prev, hoverIdx)) }}</span></span>
                    <span class="tip-row"><span class="latency-dot" style="background:var(--ok)"></span>P95 {{ formatMs(p95[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p95Prev, hoverIdx)) }}</span></span>
                    <span class="tip-row"><span class="latency-dot" style="background:var(--error)"></span>P99 {{ formatMs(p99[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(p99Prev, hoverIdx)) }}</span></span>
                    <span class="tip-row"><span class="latency-dot" style="background:var(--text-secondary)"></span>Avg {{ formatMs(avg[hoverIdx] ?? 0) }}<span v-if="cmpOn" class="tip-row-prev">/ {{ formatMs(prevAt(avgPrev, hoverIdx)) }}</span></span>
                    <span v-if="cmpOn" class="tip-prev-note">now / prev {{ humanWindow }}</span>
                  </div>
                </div>
              </div>
              <div class="svc-chart-time modal-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
            </template>

            <!-- Line charts (p50, p95, avg, p99) -->
            <template v-else>
              <div class="chart-body modal-chart-body" @mousemove="onChartMove($event, expandedChart!, chartVals(expandedChart!).length)" @mouseleave="onChartLeave">
                <div class="chart-y">
                  <span class="y-label">{{ fmtAxis(chartMax(chartVals(expandedChart!)), true) }}</span>
                  <span class="y-label">{{ fmtAxis(chartMax(chartVals(expandedChart!)) / 2, true) }}</span>
                  <span class="y-label">0</span>
                </div>
                <div class="chart-area">
                  <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none" class="modal-chart-svg">
                    <line x1="0" :x2="CHART_W" :y1="CHART_H / 2" :y2="CHART_H / 2" class="grid-line" />
                    <path :d="lineChartArea(chartVals(expandedChart!))" :fill="chartColor(expandedChart!)" :opacity="chartFillOpacity(expandedChart!)" />
                    <polyline :points="lineChartPoints(chartVals(expandedChart!))" fill="none" :stroke="chartColor(expandedChart!)" stroke-width="2" stroke-linejoin="round" />
                  </svg>
                  <div v-if="activeChart === expandedChart" class="crosshair" :style="{ left: hoverLeft(chartVals(expandedChart!).length) }" />
                  <div v-if="activeChart === expandedChart && hoverIdx >= 0 && hoverIdx < chartVals(expandedChart!).length" class="chart-tip" :style="{ left: hoverLeft(chartVals(expandedChart!).length) }">
                    <span class="tip-val">{{ chartFmtVal(expandedChart!, chartVals(expandedChart!)[hoverIdx] ?? 0) }}</span>
                    <span class="tip-time">{{ fmtBucketTime(hoverIdx) }}</span>
                  </div>
                </div>
              </div>
              <div class="svc-chart-time modal-chart-time"><span>{{ timeLabels.first }}</span><span>{{ timeLabels.last }}</span></div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="../styles/views/ServiceDetailView.css"></style>
<style src="../styles/views/ServiceDetailView.global.css"></style>
