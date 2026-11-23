<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import { useTenant } from '../composables/useTenant'
import SpanLogTable from '../components/SpanLogTable.vue'
import DataTable, { type DataTableColumn } from '../components/DataTable.vue'
import TimePicker from '../components/TimePicker.vue'
import PanelCard from '../components/PanelCard.vue'
import ServiceTagBreakdown from '../components/ServiceTagBreakdown.vue'
import { HistogramPanel, TimeSeriesPanel } from '../components/panels'
import TimeseriesWidget from '../components/widgets/TimeseriesWidget.vue'
import { provideChartHover } from '../composables/useChartHover'
import type { TimeSeriesPanelSeries } from '../components/panels'
import type { TimeDomain, GraphNode, GraphEdge, TimeseriesBucket, RushEvent, Filter, Funnel, FunnelResult, FunnelStep, DeployMarker, Monitor, Slo, AnomalyRule, LatencyHistogram, EndpointRow, ErrorGroup, ServiceTimeBreakdown, ServiceTimeBreakdownTimeseries } from '../types'
import { applyTimeRangeOverride, useTimeRangePreference } from '../composables/useTimeRangePreference'
import { serviceQueryInterval, serviceQueryBucketSeconds } from '../lib/serviceQuery'
import { parseUtcTimestamp } from '../lib/utcTimestamp'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { features, loadFeatures } = useFeatures()
const { activeTenant } = useTenant()
const chartHover = provideChartHover()

const serviceName = computed(() => route.params.serviceName as string)

// State
const graphNodes = ref<GraphNode[]>([])
const graphEdges = ref<GraphEdge[]>([])
const timeseries = ref<TimeseriesBucket[]>([])
const chartDomain = ref<TimeDomain>()
const overviewWindow = ref<{ from: string; to: string }>()
const timeseriesError = ref('')
const graphError = ref('')
let loadGeneration = 0
// Previous-period series: the same-duration window immediately preceding the
// current one (shifted back by `minutes`). Overlaid faintly on the charts when
// the "vs previous" comparison is enabled, so spikes/regressions read against a
// baseline instead of in isolation.
const timeseriesPrev = ref<TimeseriesBucket[]>([])
const compareEnabled = ref(true)
// Full latency distribution (log2-ms buckets) for this service — the shape the
// percentile timeseries can't show. Fetched per window alongside the charts.
const latencyHist = ref<LatencyHistogram | null>(null)
const timeBreakdown = ref<ServiceTimeBreakdown | null>(null)
const timeBreakdownSeries = ref<ServiceTimeBreakdownTimeseries | null>(null)
const timeBreakdownLoading = ref(false)

// Per-endpoint RED breakdown. `mode` toggles between the service's HTTP entry
// points (server) and its downstream operations (db/cache/etc.). Lazy-loaded.
const endpoints = ref<EndpointRow[]>([])
const endpointsMode = ref<'server' | 'operation'>('server')
const endpointsLoading = ref(false)
const endpointsSeen = ref(false)
type EpSortKey = 'endpoint' | 'impact' | 'req' | 'errRate' | 'p50_ms' | 'p95_ms' | 'p99_ms'
const epSortKey = ref<EpSortKey>('impact')
const epSortDir = ref<'asc' | 'desc'>('desc')

// Top Errors: grouped failures, by errored endpoint (status×method×path) or by
// normalized log-message template. Lazy-loaded like the other heavy sections.
const errorGroups = ref<ErrorGroup[]>([])
const errorsMode = ref<'endpoint' | 'message'>('endpoint')
const errorsLoading = ref(false)
const errorsSeen = ref(false)
// Lightweight evidence used by the operational briefing. These are kept
// separate from the lazy Endpoints tab so changing that tab to Operations or
// message-pattern mode never changes the briefing's meaning.
const briefingEndpoints = ref<EndpointRow[]>([])
const briefingErrors = ref<ErrorGroup[]>([])
const briefingSignalsLoading = ref(false)
const traces = ref<RushEvent[]>([])
const loading = ref(true)
const serviceStatus = ref<'checking' | 'found' | 'missing' | 'error'>('checking')
const initMinutes = Number(route.query.t)
const minutes = useTimeRangePreference()
if (initMinutes > 0) applyTimeRangeOverride(initMinutes)

// Deploy markers are overlaid by the reusable time-series panels.
const deploys = ref<DeployMarker[]>([])

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
  const t = parseUtcTimestamp(ts)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function detailInterval(): string {
  return serviceQueryInterval(minutes.value)
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
const logTraces = ref<RushEvent[]>([])
const logsSeen = ref(false)
const logsLoading = ref(false)
const logsLoadingMore = ref(false)
const logNextCursor = ref<string | null>(null)
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

// Trigger the lazy fetch backing a tab (no-op if already loaded). Logs are
// extracted from span events, but use a deeper independent feed so the log
// console can show substantially more lines without making Spans heavier.
function loadTabData(t: MainTab) {
  if (t === 'endpoints') loadActiveServiceTab()
  else if (t === 'spans') { if (!tracesSeen.value) loadTraces() }
  else if (t === 'logs') { if (!logsSeen.value) loadLogTraces() }
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
  const generation = ++loadGeneration
  loading.value = true
  timeseriesError.value = ''
  graphError.value = ''
  timeseriesPrev.value = []
  const { from, to } = windowRange()
  overviewWindow.value = { from, to }
  const interval = serviceQueryBucketSeconds(minutes.value)
  chartDomain.value = { from: Math.floor(parseUtcTimestamp(from) / 1000 / interval) * interval, to: parseUtcTimestamp(to) / 1000 }
  chartZoom.value = null
  chartHover.set(null)
  const filters = svcFilters()

  const [graphRes, tsRes] = await Promise.allSettled([
    api.serviceGraph(minutes.value),
    api.queryTimeseries({
      time_range: { from, to },
      filters,
      interval: detailInterval(),
    }),
  ])
  if (generation !== loadGeneration) return
  if (graphRes.status === 'fulfilled') {
    graphNodes.value = graphRes.value.nodes
    graphEdges.value = graphRes.value.edges
  } else {
    graphNodes.value = []
    graphEdges.value = []
    graphError.value = 'The service map could not be loaded. Other service data is still available.'
  }
  if (tsRes.status === 'fulfilled') {
    timeseries.value = tsRes.value.buckets as TimeseriesBucket[]
  } else {
    timeseries.value = []
    timeseriesError.value = 'Request and latency data could not be loaded. Try again.'
  }
  loading.value = false

  // Secondary chart data + deploys: off the critical path so first paint isn't
  // blocked. Charts are above the fold, so these fire immediately (not on scroll)
  // to avoid a flash of empty overlay/histogram.
  loadSecondaryCharts(from, generation)
  loadDeploys(from, to)
  loadBriefingSignals()

  // A window change refetches sections the user has already scrolled to.
  if (endpointsSeen.value) loadEndpoints()
  if (errorsSeen.value) loadErrors()
  if (tracesSeen.value && !tracesLoading.value) loadTraces()
  if (logsSeen.value && !logsLoading.value && !logsLoadingMore.value) loadLogTraces()
  if (funnelsSeen.value) loadSvcFunnels()
}

// Previous-period overlay + latency histogram. Not needed for first paint.
async function loadSecondaryCharts(from: string, generation: number) {
  const prevTo = from
  const prevFrom = new Date(parseUtcTimestamp(from) - minutes.value * 60_000).toISOString()
  const filters = svcFilters()
  const requestService = serviceName.value
  const requestMinutes = minutes.value
  timeBreakdownLoading.value = true
  const [tsPrevRes, histRes, breakdownRes, breakdownSeriesRes] = await Promise.allSettled([
    api.queryTimeseries({
      time_range: { from: prevFrom, to: prevTo },
      filters,
      interval: detailInterval(),
    }),
    api.serviceLatencyHistogram(requestService, requestMinutes),
    api.serviceTimeBreakdown(requestService, requestMinutes),
    api.serviceTimeBreakdownTimeseries(requestService, requestMinutes, detailInterval()),
  ])

  // A slow response from a previous service/window must not paint stale data
  // over the newly selected service. Each secondary panel is independent so a
  // failing breakdown query cannot blank the latency comparison.
  if (generation === loadGeneration) {
    if (tsPrevRes.status === 'fulfilled') timeseriesPrev.value = tsPrevRes.value.buckets as TimeseriesBucket[]
    if (histRes.status === 'fulfilled') latencyHist.value = histRes.value
    timeBreakdown.value = breakdownRes.status === 'fulfilled' ? breakdownRes.value : null
    timeBreakdownSeries.value = breakdownSeriesRes.status === 'fulfilled' ? breakdownSeriesRes.value : null
    timeBreakdownLoading.value = false
  }
}

// Recent spans/logs (the SpanLogTable feed). Lazy: only once scrolled near.
async function loadTraces() {
  tracesSeen.value = true
  tracesLoading.value = true
  const { from, to } = windowRange()
  try {
    const res = await api.queryEvents({
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

// The log console gets five times the source-event depth of the Spans tab.
// This stays below the query API's 1,000-row cap and remains lazy/non-critical.
const LOG_SOURCE_PAGE_SIZE = 500

async function loadLogTraces(append = false) {
  if (append && (!logNextCursor.value || logsLoadingMore.value)) return
  logsSeen.value = true
  if (append) logsLoadingMore.value = true
  else {
    logsLoading.value = true
    logNextCursor.value = null
  }
  const { from, to } = windowRange()
  try {
    const res = await api.queryEvents({
      time_range: { from, to },
      filters: svcFilters(),
      limit: LOG_SOURCE_PAGE_SIZE,
      ...(append && logNextCursor.value ? { cursor: logNextCursor.value } : {}),
    })
    if (append) {
      // Cursor pages should not overlap, but de-dupe defensively in case older
      // servers fall back to offset behavior for a malformed/stale cursor.
      const seen = new Set(logTraces.value.map((row) => `${row.timestamp}:${row.span_id}`))
      logTraces.value = [...logTraces.value, ...res.rows.filter((row) => !seen.has(`${row.timestamp}:${row.span_id}`))]
    } else {
      logTraces.value = res.rows
    }
    logNextCursor.value = res.rows.length === LOG_SOURCE_PAGE_SIZE ? (res.next_cursor ?? null) : null
  } catch {
    if (append) {
      // Stop auto-retry loops while the sentinel remains visible. Refreshing or
      // changing the time window starts a fresh cursor chain.
      logNextCursor.value = null
    } else {
      logTraces.value = []
      logNextCursor.value = null
    }
  } finally {
    if (append) logsLoadingMore.value = false
    else logsLoading.value = false
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

// The briefing is useful above the fold, but its supporting endpoint/error
// queries must not delay the primary RED metrics. Load them in parallel after
// the critical timeseries request has settled.
async function loadBriefingSignals() {
  briefingSignalsLoading.value = true
  const [ep, err] = await Promise.allSettled([
    api.serviceEndpoints(serviceName.value, minutes.value, 'server'),
    api.serviceErrors(serviceName.value, minutes.value, 'endpoint'),
  ])
  briefingEndpoints.value = ep.status === 'fulfilled' ? ep.value.endpoints : []
  briefingErrors.value = err.status === 'fulfilled' ? err.value.groups : []
  briefingSignalsLoading.value = false
}

async function initializeService() {
  loadGeneration++
  serviceStatus.value = 'checking'
  loading.value = true
  try {
    // Match the Services catalog's fast service-name lookup. The full
    // `/services` catalog also returns endpoint rows and can be slow or stall
    // independently of the trace queries needed by this detail page.
    const names = await api.suggestValues('service_name')
    serviceStatus.value = names.includes(serviceName.value) ? 'found' : 'missing'
  } catch {
    // Keep the older catalog endpoint as a compatibility fallback for tenants
    // where suggestions are unavailable.
    try {
      const { services } = await api.getServices()
      serviceStatus.value = services.some((service) => service.service_name === serviceName.value)
        ? 'found'
        : 'missing'
    } catch {
      serviceStatus.value = 'error'
    }
  }

  if (serviceStatus.value !== 'found') {
    loading.value = false
    return
  }

  await loadData()
  await nextTick(setupLazyObservers)
  // Deep link (?tab=spans|logs|endpoints|funnels): load that tab's data now.
  if (activeTab.value !== 'overview') loadTabData(activeTab.value)
  loadAttachments()
  if (features.value.deploy_markers === undefined) loadFeatures()
}

onMounted(initializeService)
onUnmounted(() => { loadGeneration++; lazyObservers.forEach((o) => o.disconnect()); lazyObservers = [] })
watch(serviceName, () => {
  // Vue reuses this component for /services/:serviceName navigation. Clear the
  // previous service immediately so a failed or slow tenant-scoped request can
  // never leave another service's data visible under the new URL.
  graphNodes.value = []
  graphEdges.value = []
  timeseries.value = []
  timeseriesPrev.value = []
  latencyHist.value = null
  timeBreakdown.value = null
  timeBreakdownSeries.value = null
  timeBreakdownLoading.value = false
  endpoints.value = []
  errorGroups.value = []
  briefingEndpoints.value = []
  briefingErrors.value = []
  traces.value = []
  logTraces.value = []
  logNextCursor.value = null
  deploys.value = []
  initializeService()
})
watch(minutes, () => { if (serviceStatus.value === 'found') loadData() })

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
  if (loading.value) return { level: 'nodata', label: 'loading', reasons: ['loading request data'] }
  if (timeseriesError.value) return { level: 'nodata', label: 'unavailable', reasons: ['request data could not be loaded'] }
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

// Shift the previous window by its duration. Sparse buckets stay in their
// actual positions instead of aligning to unrelated samples by array index.
function seriesPoints(buckets: TimeseriesBucket[], values: number[], offset = 0): [number, number][] {
  return buckets.flatMap((bucket, index) => {
    const time = parseUtcTimestamp(bucket.bucket) / 1000 + offset
    const value = values[index]
    return Number.isFinite(time) && value != null ? [[time, value]] : []
  })
}

function comparisonSeries(name: string, values: number[], color = 'var(--text-muted)'): TimeSeriesPanelSeries {
  return {
    name: `${name} · previous`,
    points: seriesPoints(timeseriesPrev.value, values, minutes.value * 60),
    color,
    lineStyle: 'dashed',
    opacity: 0.55,
    barOverlay: true,
  }
}

const serviceChartDeploys = computed(() => features.value.deploy_markers === false ? [] : deploys.value)
const requestChartSeries = computed<TimeSeriesPanelSeries[]>(() => [
  { name: 'Requests', points: seriesPoints(timeseries.value, requestCounts.value), color: 'var(--amber)' },
  ...(cmpOn.value ? [comparisonSeries('Requests', requestCountsPrev.value)] : []),
])
const errorChartSeries = computed<TimeSeriesPanelSeries[]>(() => [
  { name: 'Errors', points: seriesPoints(timeseries.value, errorCounts.value), color: 'var(--error)' },
  ...(cmpOn.value ? [comparisonSeries('Errors', errorCountsPrev.value)] : []),
])
const latencyColors = {
  p50: 'var(--ok)',
  p95: 'var(--accent)',
  p99: '#8b5cf6',
}
const latencyChartSeries = computed<TimeSeriesPanelSeries[]>(() => [
  { name: 'P50', points: seriesPoints(timeseries.value, p50.value), color: latencyColors.p50 },
  { name: 'P95', points: seriesPoints(timeseries.value, p95.value), color: latencyColors.p95 },
  { name: 'P99', points: seriesPoints(timeseries.value, p99.value), color: latencyColors.p99 },
  { name: 'Average', points: seriesPoints(timeseries.value, avg.value), color: 'var(--text-secondary)', lineStyle: 'dashed' },
  ...(cmpOn.value ? [
    comparisonSeries('P50', p50Prev.value, latencyColors.p50),
    comparisonSeries('P95', p95Prev.value, latencyColors.p95),
    comparisonSeries('P99', p99Prev.value, latencyColors.p99),
    comparisonSeries('Average', avgPrev.value, 'var(--text-secondary)'),
  ] : []),
])

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
// X-axis end labels (lowest / highest bucket bound).
const histMinLabel = computed(() => hasHist.value ? fmtDur(Math.pow(2, histBars.value.minExp)) : '')
const histMaxLabel = computed(() => hasHist.value ? fmtDur(Math.pow(2, histBars.value.maxExp + 1)) : '')
const latencyDistributionBins = computed(() => hasHist.value
  ? histBars.value.bars.map(bar => ({ key: histRangeLabel(bar.exp), count: bar.count }))
  : [])
const latencyDistributionMarkers = computed(() => {
  const histogram = latencyHist.value
  const { bars, minExp } = histBars.value
  if (!histogram || !hasHist.value || bars.length === 0) return []
  return [
    { label: 'P50', ms: histogram.p50_ms, color: latencyColors.p50 },
    { label: 'P95', ms: histogram.p95_ms, color: latencyColors.p95 },
    { label: 'P99', ms: histogram.p99_ms, color: latencyColors.p99 },
  ].map(marker => ({
    label: marker.label,
    value: fmtDur(marker.ms),
    color: marker.color,
    position: Math.max(0, Math.min(1, (Math.log2(Math.max(marker.ms, Number.EPSILON)) - minExp) / bars.length)),
  }))
})

type ServiceSummary = { total: number; errors: number; errorRate: number; avgMs: number; p50: number; p95: number; p99: number }

function summarizeBuckets(buckets: TimeseriesBucket[]): ServiceSummary {
  if (buckets.length === 0) return { total: 0, errors: 0, errorRate: 0, avgMs: 0, p50: 0, p95: 0, p99: 0 }
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const errors = buckets.reduce((s, b) => s + b.error_count, 0)
  const errorRate = total > 0 ? errors / total : 0
  const avgMs = total > 0 ? buckets.reduce((s, b) => s + b.avg_duration_ms * b.count, 0) / total : 0
  const last = [...buckets].reverse().find((b) => b.count > 0)
  return { total, errors, errorRate, avgMs, p50: last?.p50_ms ?? 0, p95: last?.p95_ms ?? 0, p99: last?.p99_ms ?? 0 }
}

// Summary stats for the active and immediately preceding windows. Keeping the
// aggregation identical makes briefing deltas consistent with the cards.
const summary = computed(() => summarizeBuckets(timeseries.value))
const previousSummary = computed(() => summarizeBuckets(timeseriesPrev.value))

const timeBreakdownBuckets = computed(() => timeBreakdownSeries.value?.buckets ?? [])
const timeBreakdownDatabases = computed(() => timeBreakdown.value?.databases ?? [])
const timeBreakdownChartSeries = computed<TimeSeriesPanelSeries[]>(() => {
  const requestCount = timeBreakdown.value?.request_count ?? 0
  const windowAverage = (field: 'application_time_ms' | 'database_time_ms') => {
    if (requestCount <= 0 || !timeBreakdown.value) return undefined
    return timeBreakdown.value[field] / requestCount
  }
  const toPoints = (field: 'application_time_ms' | 'database_time_ms') => timeBreakdownBuckets.value
    .map((bucket) => [parseUtcTimestamp(bucket.bucket) / 1000, bucket[field]] as [number, number])
    .filter(([timestamp]) => Number.isFinite(timestamp))
  return [
    { name: 'Application average', points: toPoints('application_time_ms'), color: 'var(--amber)', legendValue: windowAverage('application_time_ms') },
    { name: 'Database average', points: toPoints('database_time_ms'), color: 'var(--purple, #8b5cf6)', legendValue: windowAverage('database_time_ms') },
  ]
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

// ═══ Operational briefing ═══
// Rank evidence by likely user impact rather than by any one raw metric. The
// score stays internal; the UI explains the concrete traffic/error/latency
// facts so responders never have to trust an opaque number.
function endpointImpact(e: EndpointRow): number {
  return e.req * Math.max(e.p95_ms, 1) * (1 + epErrorRate(e) * 20)
}
function dependencyImpact(e: GraphEdge): number {
  return e.request_count * Math.max(e.avg_duration_ms, 1) * (1 + edgeErrorRate(e) * 20)
}

const briefingTopEndpoint = computed(() =>
  [...briefingEndpoints.value].sort((a, b) => endpointImpact(b) - endpointImpact(a))[0] ?? null
)
const briefingTopError = computed(() =>
  [...briefingErrors.value].sort((a, b) => b.count - a.count)[0] ?? null
)
const briefingDependency = computed(() =>
  [...svcEdges.value.outgoing].sort((a, b) => dependencyImpact(b) - dependencyImpact(a))[0] ?? null
)

function relativeDelta(current: number, previous: number): number | null {
  if (!timeseriesPrev.value.length || previous <= 0) return null
  return ((current - previous) / previous) * 100
}
function signedPct(value: number | null): string {
  if (value === null) return 'no baseline'
  if (Math.abs(value) < 0.5) return 'unchanged'
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}%`
}
function deltaTone(value: number | null, increaseIsBad = true): string {
  if (value === null || Math.abs(value) < 0.5) return 'flat'
  const worse = increaseIsBad ? value > 0 : value < 0
  return worse ? 'bad' : 'good'
}

const briefingDeltas = computed(() => ({
  traffic: relativeDelta(summary.value.total, previousSummary.value.total),
  errors: relativeDelta(summary.value.errorRate, previousSummary.value.errorRate),
  p95: relativeDelta(summary.value.p95, previousSummary.value.p95),
}))

const briefingHeadline = computed(() => {
  if (summary.value.total === 0) return 'No service traffic was observed in this window.'
  if (health.value === 'unhealthy') return `Immediate attention: ${healthVerdict.value.reasons.join(', ')}.`
  if (health.value === 'degraded') return `Service degradation detected: ${healthVerdict.value.reasons.join(', ')}.`
  const d = briefingDeltas.value
  if (d.errors !== null && d.errors >= 25) return `Error rate climbed ${signedPct(d.errors)} versus the previous ${humanWindow.value}.`
  if (d.p95 !== null && d.p95 >= 25) return `P95 latency climbed ${signedPct(d.p95)} versus the previous ${humanWindow.value}.`
  return `No material regression detected versus the previous ${humanWindow.value}.`
})

const briefingDetail = computed(() => {
  const parts: string[] = []
  const err = briefingTopError.value
  const ep = briefingTopEndpoint.value
  const dep = briefingDependency.value
  if (err) parts.push(`${err.key} is the most frequent error (${formatCount(err.count)})`)
  if (ep) parts.push(`${ep.endpoint} has the highest current impact`)
  if (dep && edgeHealth(dep) !== 'healthy') parts.push(`${dep.target} is a ${edgeHealth(dep)} dependency`)
  if (lastDeploy.value) parts.push(`${lastDeploy.value.version ? `v${lastDeploy.value.version}` : 'a deploy'} landed ${relTime(lastDeploy.value.deployed_at)}`)
  return parts.length ? parts.join(' · ') : 'Traffic, errors, latency, dependencies, and attached signals are within their current thresholds.'
})

const briefingInvestigateTo = computed(() => {
  const ep = briefingTopEndpoint.value
  const err = briefingTopError.value
  const dep = briefingDependency.value
  const q = `Investigate what changed for ${serviceName.value} in the last ${humanWindow.value} and explain the likely cause of its ${healthVerdict.value.label} state.`
  const context = [
    `Traffic ${signedPct(briefingDeltas.value.traffic)} vs previous window`,
    `error rate ${formatPercent(summary.value.errorRate)} (${signedPct(briefingDeltas.value.errors)})`,
    `p95 ${formatMs(summary.value.p95)} (${signedPct(briefingDeltas.value.p95)})`,
    ep ? `highest-impact endpoint ${ep.endpoint}` : '',
    err ? `top error ${err.key} (${err.count})` : '',
    dep ? `highest-impact downstream ${dep.target}` : '',
    lastDeploy.value ? `latest deploy ${lastDeploy.value.version || lastDeploy.value.id} ${relTime(lastDeploy.value.deployed_at)}` : '',
  ].filter(Boolean).join('; ')
  return { path: '/investigate', query: { q, ctx: context } }
})

function exploreBriefingEndpoint() {
  const e = briefingTopEndpoint.value
  if (!e) return
  const parts = [`service_name=${serviceName.value}`]
  if (e.method) parts.push(`http_method=${e.method}`)
  if (e.path) parts.push(`http_path=${e.path}`)
  router.push({ path: '/', query: { mode: 'spans', q: parts.join(' '), t: String(minutes.value) } })
}

function openBriefingErrors() {
  activeServiceTab.value = 'errors'
  loadActiveServiceTab()
  router.push({ query: { ...route.query, tab: 'endpoints' } })
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

// Impact is deliberately modeled from metrics responders can verify in the
// same row: traffic × p95 latency × an error-rate penalty. The table shows each
// row's share of total modeled impact rather than the raw unitless score.
const totalEndpointImpact = computed(() =>
  endpoints.value.reduce((total, e) => total + endpointImpact(e), 0)
)
function epImpactShare(e: EndpointRow): number {
  const total = totalEndpointImpact.value
  return total > 0 ? endpointImpact(e) / total : 0
}
function formatImpactShare(e: EndpointRow): string {
  const pct = epImpactShare(e) * 100
  if (pct >= 10) return `${pct.toFixed(0)}%`
  if (pct >= 1) return `${pct.toFixed(1)}%`
  return pct > 0 ? '<1%' : '0%'
}
// Sorted view of the endpoint rows. Numeric keys sort by value; 'endpoint' by
// label; 'impact' and 'errRate' are derived. Direction toggles per the header.
const sortedEndpoints = computed(() => {
  const rows = [...endpoints.value]
  const k = epSortKey.value
  const dir = epSortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    let av: number | string, bv: number | string
    if (k === 'endpoint') { av = a.endpoint; bv = b.endpoint }
    else if (k === 'impact') { av = endpointImpact(a); bv = endpointImpact(b) }
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
const endpointTableColumns = computed<DataTableColumn[]>(() => [
  { key: 'endpoint', label: endpointsMode.value === 'server' ? 'Endpoint' : 'Operation', sortable: true },
  { key: 'impact', label: 'Impact', align: 'right', sortable: true, headerClass: 'svc-table-impact' },
  { key: 'req', label: 'Req', align: 'right', sortable: true },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'errRate', label: 'Err%', align: 'right', sortable: true },
  { key: 'p50_ms', label: 'P50', align: 'right', sortable: true },
  { key: 'p95_ms', label: 'P95', align: 'right', sortable: true },
  { key: 'p99_ms', label: 'P99', align: 'right', sortable: true },
])

function onEndpointTableSort(key: string) {
  if (key === 'endpoint' || key === 'impact' || key === 'req' || key === 'errRate' || key === 'p50_ms' || key === 'p95_ms' || key === 'p99_ms') {
    setEpSort(key)
  }
}

function endpointRow(row: Record<string, unknown>): EndpointRow {
  return row as unknown as EndpointRow
}

function onEndpointTableRowClick(row: Record<string, unknown>) {
  exploreEndpoint(endpointRow(row))
}

const errorTableColumns = computed<DataTableColumn[]>(() => [
  { key: 'error', label: errorsMode.value === 'endpoint' ? 'Error' : 'Message' },
  { key: 'count', label: 'Count', align: 'right' },
  { key: 'last_seen', label: 'Last seen', align: 'right' },
])

const errorTableRows = computed(() => errorGroups.value.map((group) => ({ ...group, error: group.key })))

function onErrorTableRowClick(row: Record<string, unknown>) {
  const key = String(row.key ?? '')
  const group = errorGroups.value.find((candidate) => candidate.key === key)
  if (group) exploreError(group)
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
  router.push({ path: '/', query: { mode: 'spans', q: parts.join(' '), t: String(minutes.value) } })
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
    router.push({ path: '/', query: { mode: 'spans', q: parts.join(' '), t: String(minutes.value) } })
  }
}

type ChartView = 'signals' | 'latency' | 'hist' | 'map'
const expandedChart = ref<ChartView | null>(null)
const chartDialog = ref<HTMLDialogElement | null>(null)
const chartZoom = ref<TimeDomain | null>(null)
const expandedDomain = computed(() => chartZoom.value ?? chartDomain.value)
const chartTitles: Record<ChartView, string> = {
  signals: 'Traffic and errors',
  latency: 'Request latency',
  hist: 'Latency distribution',
  map: 'Service map',
}

const signalCharts = computed(() => [
  { name: 'Requests', unit: 'req', series: requestChartSeries.value },
  { name: 'Errors', unit: 'errors', series: errorChartSeries.value },
])

async function openChart(key: ChartView) {
  chartHover.set(null)
  chartZoom.value = null
  expandedChart.value = key
  await nextTick()
  chartDialog.value?.showModal()
}

function closeChart() {
  chartDialog.value?.close()
  expandedChart.value = null
  chartHover.set(null)
}

function zoomCharts(range: TimeDomain) {
  const domain = expandedDomain.value
  if (!domain) return
  const step = serviceQueryBucketSeconds(minutes.value)
  chartZoom.value = {
    from: Math.max(domain.from, Math.floor(range.from / step) * step),
    to: Math.min(domain.to, Math.ceil(range.to / step) * step),
  }
  chartHover.set(null)
}

function resetChartZoom() {
  chartZoom.value = null
  chartHover.set(null)
}

function inExpandedRange(series: TimeSeriesPanelSeries[]) {
  const range = expandedDomain.value
  if (!range || !chartZoom.value) return series
  return series.map(item => ({
    ...item,
    points: item.points.filter(([time]) => time >= range.from && time < range.to),
  }))
}
watch([serviceName, activeTenant], closeChart)


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
    if (svcFunnelSel.value) await runSvcFunnel()
  } catch { /* silent */ }
}

function selectSvcFunnel(f: Funnel) {
  svcFunnelSel.value = f
  svcFunnelRes.value = null
  svcFunnelErr.value = null
  void runSvcFunnel()
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

function svcFunnelStepMeta(index: number): string {
  const step = svcFunnelSel.value?.steps[index]
  if (!step) return 'Trace match'
  const status = step.min_status_code || step.max_status_code
    ? `status ${step.min_status_code ?? 'any'}–${step.max_status_code ?? 'any'}`
    : ''
  return [step.service_name || 'any service', step.http_path_prefix || 'all paths', status]
    .filter(Boolean)
    .join(' · ')
}

function sfStageClass(pct: number): string {
  if (pct >= 85) return 'sf-stage-good'
  if (pct >= 65) return 'sf-stage-watch'
  return 'sf-stage-drop'
}

function sfPctLabel(step: FunnelResult['steps'][0], index: number): string {
  return index === 0 ? '100%' : `${step.pct_of_first.toFixed(1)}%`
}

function sfLastPct(steps: FunnelResult['steps']): number {
  return steps[steps.length - 1]?.pct_of_first ?? 0
}

function sfConversionLabel(steps: FunnelResult['steps']): string {
  const last = steps[steps.length - 1]
  return last ? sfPctLabel(last, steps.length - 1) : '—'
}

function sfTotalLoss(steps: FunnelResult['steps']): number {
  return Math.max((steps[0]?.count ?? 0) - (steps[steps.length - 1]?.count ?? 0), 0)
}


</script>

<template>
  <div class="svc-page">
    <div v-if="serviceStatus === 'checking'" class="empty-state card">
      <div class="empty-state-icon">&#9676;</div>
      <div>Checking service access...</div>
    </div>

    <div v-else-if="serviceStatus === 'missing'" class="empty-state card">
      <div class="empty-state-icon">&#8709;</div>
      <div>Service not found in <span class="mono">{{ activeTenant }}</span></div>
      <div class="text-muted"><span class="mono">{{ serviceName }}</span> has no APM data in the active tenant.</div>
      <button class="back-btn" @click="router.push('/services')">&larr; Back to services</button>
    </div>

    <div v-else-if="serviceStatus === 'error'" class="empty-state card">
      <div class="empty-state-icon">!</div>
      <div>Could not verify service access</div>
      <div class="text-muted">The tenant-scoped service list could not be loaded.</div>
      <button class="refresh-btn" @click="initializeService">Try again</button>
    </div>

    <template v-else>
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
      <div v-if="timeseriesError || graphError" class="empty-state card" role="alert">
        <p v-if="timeseriesError">{{ timeseriesError }}</p>
        <p v-if="graphError">{{ graphError }}</p>
        <button class="refresh-btn" :disabled="loading" @click="loadData">Retry service data</button>
      </div>
      <!-- Operational briefing: a concise answer to what changed and where to start. -->
      <section v-if="!timeseriesError" class="svc-briefing" :class="health" aria-labelledby="svc-briefing-title">
        <div class="svc-briefing-main">
          <div class="svc-briefing-kicker">
            <span class="svc-briefing-pulse" :class="health" />
            <span>What changed</span>
            <span class="svc-briefing-window">{{ humanWindow }} vs previous {{ humanWindow }}</span>
          </div>
          <h2 id="svc-briefing-title">{{ briefingHeadline }}</h2>
          <p>{{ briefingSignalsLoading && !briefingTopEndpoint ? 'Ranking endpoint and error evidence…' : briefingDetail }}</p>
        </div>
        <router-link
          v-if="features.sre_agent"
          :to="briefingInvestigateTo"
          class="svc-briefing-investigate"
        >
          Investigate regression <span aria-hidden="true">→</span>
        </router-link>

        <div class="svc-briefing-evidence">
          <div class="svc-evidence">
            <span class="svc-evidence-label">Traffic</span>
            <strong class="mono">{{ formatCount(summary.total) }}</strong>
            <span class="svc-evidence-delta" :class="deltaTone(briefingDeltas.traffic, false)">{{ signedPct(briefingDeltas.traffic) }}</span>
          </div>
          <div class="svc-evidence">
            <span class="svc-evidence-label">Error rate</span>
            <strong class="mono">{{ formatPercent(summary.errorRate) }}</strong>
            <span class="svc-evidence-delta" :class="deltaTone(briefingDeltas.errors)">{{ signedPct(briefingDeltas.errors) }}</span>
          </div>
          <div class="svc-evidence">
            <span class="svc-evidence-label">P95 latency</span>
            <strong class="mono">{{ formatMs(summary.p95) }}</strong>
            <span class="svc-evidence-delta" :class="deltaTone(briefingDeltas.p95)">{{ signedPct(briefingDeltas.p95) }}</span>
          </div>
          <button class="svc-evidence svc-evidence-action" :disabled="!briefingTopEndpoint" @click="exploreBriefingEndpoint">
            <span class="svc-evidence-label">Highest-impact endpoint</span>
            <strong class="mono svc-evidence-name">{{ briefingTopEndpoint?.endpoint || (briefingSignalsLoading ? 'Ranking…' : 'No endpoint data') }}</strong>
            <span v-if="briefingTopEndpoint" class="svc-evidence-meta">{{ formatCount(briefingTopEndpoint.req) }} req · {{ formatPercent(epErrorRate(briefingTopEndpoint)) }} err · {{ formatMs(briefingTopEndpoint.p95_ms) }} p95</span>
          </button>
          <button class="svc-evidence svc-evidence-action" :disabled="!briefingDependency" @click="briefingDependency && goToService(briefingDependency.target)">
            <span class="svc-evidence-label">Downstream risk</span>
            <strong class="mono svc-evidence-name">{{ briefingDependency?.target || 'No downstream calls' }}</strong>
            <span v-if="briefingDependency" class="svc-evidence-meta" :class="`tone-${edgeHealth(briefingDependency)}`">{{ formatPercent(edgeErrorRate(briefingDependency)) }} err · {{ formatMs(briefingDependency.avg_duration_ms) }} avg</span>
          </button>
          <button class="svc-evidence svc-evidence-action" :disabled="!briefingTopError" @click="openBriefingErrors">
            <span class="svc-evidence-label">Top error</span>
            <strong class="mono svc-evidence-name">{{ briefingTopError?.key || (briefingSignalsLoading ? 'Grouping…' : 'No errors') }}</strong>
            <span v-if="briefingTopError" class="svc-evidence-meta">{{ formatCount(briefingTopError.count) }} occurrences · {{ relTime(briefingTopError.last_seen) }}</span>
          </button>
        </div>
      </section>

      <!-- Summary stats -->
      <div v-if="!timeseriesError" class="svc-stats-row">
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
        <TimeSeriesPanel
          class="svc-chart-card svc-chart-card-wide"
          title="Latency"
          description="Request latency percentiles and average per bucket."
          :range-label="humanWindow"
          unit="ms"
          :series="latencyChartSeries"
          :time-domain="chartDomain"
          :bucket-seconds="serviceQueryBucketSeconds(minutes)"
          :error="timeseriesError || null"
          :deploys="serviceChartDeploys"
          :loading="loading"
          linked-readout
        >
          <template #actions>
            <button class="svc-chart-expand" type="button" @click="openChart('latency')">Expand latency</button>
          </template>
        </TimeSeriesPanel>

        <TimeSeriesPanel
          v-for="signal in signalCharts"
          :key="signal.name"
          class="svc-chart-card"
          :title="signal.name"
          :range-label="humanWindow"
          :unit="signal.unit"
          :series="signal.series"
          :time-domain="chartDomain"
          :bucket-seconds="serviceQueryBucketSeconds(minutes)"
          display-mode="stacked-bars"
          :error="timeseriesError || null"
          :deploys="serviceChartDeploys"
          :loading="loading"
          linked-readout
        >
          <template #actions>
            <button class="svc-chart-expand" type="button" :aria-label="`Expand ${signal.name.toLowerCase()}`" @click="openChart('signals')">Expand</button>
          </template>
        </TimeSeriesPanel>

        <HistogramPanel
          class="svc-chart-card chart-clickable"
          title="Latency Distribution"
          description="Distribution of request durations across latency buckets. Click to expand."
          caption="Request count grouped into logarithmic duration ranges."
          source-label="Spans"
          :range-label="humanWindow"
          unit="requests"
          :bins="latencyDistributionBins"
          :markers="latencyDistributionMarkers"
          :min-label="histMinLabel"
          :max-label="histMaxLabel"
          :loading="timeBreakdownLoading && !latencyHist"
          role="button"
          tabindex="0"
          @click="openChart('hist')"
          @keydown.enter="openChart('hist')"
          @keydown.space.prevent="openChart('hist')"
        />
      </div>

      <ServiceTagBreakdown
        v-if="activeTab === 'overview' && overviewWindow"
        :service="serviceName"
        :tenant="activeTenant"
        :range="overviewWindow"
      />

      <!-- Topology: who calls this service and what it depends on -->
      <div class="svc-overview-grid">
        <TimeSeriesPanel
          class="svc-chart-card svc-time-series-card"
          title="Application vs database time"
          description="Stacked bars show the application and estimated database portions of average request duration in each interval."
          caption="Each bar totals average request duration. Database impact is capped; raw DB call time is shown separately below."
          source-label="Spans"
          :range-label="humanWindow"
          :series="timeBreakdownChartSeries"
          display-mode="stacked-bars"
          :bucket-seconds="serviceQueryBucketSeconds(minutes)"
          :time-domain="{ from: parseUtcTimestamp(windowFrom) / 1000, to: parseUtcTimestamp(windowTo) / 1000 }"
          :loading="timeBreakdownLoading"
          unit="ms"
        >
          <template #details>
            <div class="svc-time-series-meta">
              <span><b>{{ timeBreakdown ? fmtDur(timeBreakdown.application_time_ms) : '-' }}</b> total application time</span>
              <span><b>{{ timeBreakdown ? fmtDur(timeBreakdown.database_time_ms) : '-' }}</b> total database impact</span>
              <span><b>{{ timeBreakdown ? fmtDur(timeBreakdown.wall_time_ms) : '-' }}</b> total wall time</span>
              <span><b>{{ timeBreakdown ? formatCount(timeBreakdown.database_calls) : '-' }}</b> database calls</span>
              <span><b>{{ timeBreakdown ? fmtDur(timeBreakdown.database_call_time_ms) : '-' }}</b> raw DB call time</span>
            </div>
            <div v-if="timeBreakdownDatabases.length" class="svc-time-databases">
              <div class="svc-time-database-head">
                <span>Database targets</span>
                <span>Calls</span>
                <span>Raw time</span>
                <span>P95</span>
              </div>
              <div v-for="database in timeBreakdownDatabases.slice(0, 5)" :key="`${database.system}:${database.target}`" class="svc-time-database-row">
                <span class="svc-time-database-name">
                  <b>{{ database.target }}</b>
                  <small>{{ database.system }}</small>
                </span>
                <span class="mono">{{ formatCount(database.calls) }}</span>
                <span class="mono">{{ fmtDur(database.total_ms) }}</span>
                <span class="mono">{{ formatMs(database.p95_ms) }}</span>
              </div>
            </div>
          </template>
        </TimeSeriesPanel>
        <PanelCard
          class="svc-chart-card chart-clickable svc-map-card"
          title="Service Map"
          description="Upstream and downstream services connected to this service, colored by error rate. Click to expand."
          @click="openChart('map')"
        >
          <div v-if="svcConnected.length === 0" class="svc-map-empty text-muted">No connections found</div>
          <svg v-else viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet" class="svc-map-svg">
            <template v-for="(src, i) in svcEdges.incoming.slice(0, 3)" :key="'in-' + src.source">
              <line :x1="20" :y1="20 + i * 30" x2="120" y2="50" :stroke="edgeColor(src)" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-dasharray="3,2" marker-end="url(#map-arrow)" opacity="0.8"><title>{{ edgeTitle(src, src.source) }}</title></line>
              <text :x="18" :y="20 + i * 30" text-anchor="end" class="map-label" dominant-baseline="central">{{ src.source }}</text>
            </template>
            <rect x="110" y="35" width="80" height="30" rx="4" fill="var(--amber-dim)" stroke="var(--amber)" stroke-width="1.5" />
            <text x="150" y="50" text-anchor="middle" dominant-baseline="central" class="map-center">{{ serviceName }}</text>
            <template v-for="(tgt, i) in svcEdges.outgoing.slice(0, 3)" :key="'out-' + tgt.target">
              <line x1="190" y1="50" :x2="280" :y2="20 + i * 30" :stroke="edgeColor(tgt)" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-dasharray="3,2" marker-end="url(#map-arrow)" opacity="0.8"><title>{{ edgeTitle(tgt, tgt.target) }}</title></line>
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
      <div class="svc-tabs card service-table-frame" ref="tabsCardRef">
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
          <div v-else class="ep-table-wrap">
          <div class="ep-impact-note">
            <span aria-hidden="true">◎</span>
            Impact estimates user exposure from traffic × p95 latency × error rate. Higher-impact rows are the best starting point.
          </div>
          <DataTable
            class="svc-breakdown-table svc-breakdown-table--wide"
            bare
            :columns="endpointTableColumns"
            :rows="sortedEndpoints"
            row-key="endpoint"
            :sort-key="epSortKey"
            :sort-direction="epSortDir"
            clickable-rows
            @sort="onEndpointTableSort"
            @row-click="onEndpointTableRowClick"
          >
            <template #cell-endpoint="{ row }">
              <div class="ep-name">
                <span class="ep-dot" :style="{ background: epColor(endpointRow(row)) }"></span>
                <span v-if="row.method" class="ep-method">{{ row.method }}</span>
                <span class="mono ep-path">{{ endpointsMode === 'server' ? (row.path || '/') : row.endpoint }}</span>
              </div>
            </template>
            <template #cell-impact="{ row }">
              <div class="ep-impact-value">
                <span class="mono">{{ formatImpactShare(endpointRow(row)) }}</span>
                <span class="ep-impact-track" aria-hidden="true"><span :style="{ width: `${Math.max(epImpactShare(endpointRow(row)) * 100, 1)}%` }" /></span>
              </div>
            </template>
            <template #cell-req="{ row }"><span class="mono">{{ formatCount(Number(row.req)) }}</span></template>
            <template #cell-rate="{ row }"><span class="mono ep-sub">{{ formatRps(epRps(endpointRow(row))) }}</span></template>
            <template #cell-errRate="{ row }"><span class="mono" :style="{ color: epColor(endpointRow(row)) }">{{ formatPercent(epErrorRate(endpointRow(row))) }}</span></template>
            <template #cell-p50_ms="{ row }"><span class="mono">{{ formatMs(Number(row.p50_ms)) }}</span></template>
            <template #cell-p95_ms="{ row }"><span class="mono">{{ formatMs(Number(row.p95_ms)) }}</span></template>
            <template #cell-p99_ms="{ row }"><span class="mono">{{ formatMs(Number(row.p99_ms)) }}</span></template>
          </DataTable>
          </div>
        </template>

        <!-- Top Errors tab -->
        <template v-else-if="activeServiceTab === 'errors'">
          <div v-if="errorsLoading || !errorsSeen" class="ep-empty text-muted">Loading…</div>
          <div v-else-if="errorGroups.length === 0" class="ep-empty text-muted">
            {{ errorsMode === 'endpoint' ? 'No errors in this window' : 'No error/warn logs in this window' }}
          </div>
          <div v-else class="ep-table-wrap">
            <DataTable
              class="svc-breakdown-table"
              bare
              :columns="errorTableColumns"
              :rows="errorTableRows"
              row-key="key"
              clickable-rows
              @row-click="onErrorTableRowClick"
            >
              <template #cell-error="{ row }">
                <div class="ep-name">
                  <template v-if="errorsMode === 'endpoint'">
                    <span class="err-badge" :style="{ color: errStatusColor(Number(row.status_code)), borderColor: errStatusColor(Number(row.status_code)) }">{{ row.status_code }}</span>
                    <span v-if="row.method" class="ep-method">{{ row.method }}</span>
                    <span class="mono ep-path">{{ row.path }}</span>
                  </template>
                  <template v-else>
                    <span class="err-badge" :style="{ color: errSeverityColor(String(row.severity)), borderColor: errSeverityColor(String(row.severity)) }">{{ row.severity }}</span>
                    <span class="mono err-msg" :title="String(row.example)">{{ row.key }}</span>
                  </template>
                </div>
              </template>
              <template #cell-count="{ row }"><span class="mono">{{ formatCount(Number(row.count)) }}</span></template>
              <template #cell-last_seen="{ row }"><span class="mono ep-sub">{{ relTime(String(row.last_seen)) }}</span></template>
            </DataTable>
          </div>
        </template>

      </div>
      </section><!-- /endpoints -->

      <!-- ░░░░ SPANS ░░░░ — recent spans for this service -->
      <section v-show="activeTab === 'spans'" class="svc-panel">
        <div class="svc-tab-logs service-table-frame">
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
        <div class="svc-tab-logs service-table-frame">
          <SpanLogTable
            force-mode="logs"
            :spans="logTraces"
            :show-service="false"
            :loading="loading || logsLoading || !logsSeen"
            :service-name="serviceName"
            :minutes="minutes"
            :result-limit="500"
            :has-more="!!logNextCursor"
            :loading-more="logsLoadingMore"
            @load-more="loadLogTraces(true)"
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
            <span>Trace funnels</span>
            <span class="sf-scope">/ {{ serviceName }}</span>
          </div>
          <div class="sf-header-right">
            <template v-if="svcFunnelSel">
              <div class="sf-range-row">
              <button
                v-for="opt in RANGE_OPTS" :key="opt.v"
                class="sf-range-btn" :class="{ active: svcFunnelRange === opt.v }"
                @click="svcFunnelRange = opt.v; runSvcFunnel()"
              >{{ opt.l }}</button>
              </div>
              <button class="sf-run-btn" @click="runSvcFunnel" :disabled="svcFunnelBusy">
                <span v-if="svcFunnelBusy" class="sf-spinner" aria-hidden="true"></span>
                <span v-if="svcFunnelBusy">Running</span>
                <span v-else>Run analysis</span>
              </button>
            </template>
            <button
              class="sf-new-btn"
              :class="{ active: svcFunnelShowCreate }"
              @click="svcFunnelShowCreate = !svcFunnelShowCreate; if (svcFunnelShowCreate) initSvcFunnelSteps()"
            >{{ svcFunnelShowCreate ? 'Close' : 'New funnel' }}</button>
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

        <div v-if="svcFunnelBusy" class="sf-loading" role="status">
          <span class="sf-loading-mark"></span>
          <span>Reading trace progression for the selected window…</span>
        </div>

        <div v-else-if="svcFunnelRes" class="sf-result">
          <div class="sf-result-header">
            <div class="sf-result-title">
              <span class="sf-kicker">Trace progression</span>
              <strong>{{ svcFunnelSel?.name }}</strong>
              <span class="sf-result-window">last {{ svcFunnelRange === 60 ? '1h' : svcFunnelRange === 360 ? '6h' : svcFunnelRange === 1440 ? '24h' : '7d' }}</span>
            </div>
            <div class="sf-summary" aria-label="Funnel summary">
              <div class="sf-summary-item">
                <span>Conversion</span>
                <strong :class="sfStageClass(sfLastPct(svcFunnelRes.steps))">
                  {{ sfConversionLabel(svcFunnelRes.steps) }}
                </strong>
              </div>
              <div class="sf-summary-item">
                <span>Observed</span>
                <strong>{{ (svcFunnelRes.steps[0]?.count ?? 0).toLocaleString() }}</strong>
                <small>distinct traces</small>
              </div>
              <div class="sf-summary-item">
                <span>Lost</span>
                <strong class="sf-loss">{{ sfTotalLoss(svcFunnelRes.steps).toLocaleString() }}</strong>
                <small>through the path</small>
              </div>
            </div>
          </div>

          <div class="sf-flow-head" aria-hidden="true">
            <span>Stage</span>
            <span>Trace volume</span>
            <span>Share of entry</span>
          </div>

          <ol class="sf-stage-list">
            <li
              v-for="(step, i) in svcFunnelRes.steps" :key="i"
              :class="['sf-stage', sfStageClass(i === 0 ? 100 : step.pct_of_first)]"
            >
              <div class="sf-stage-index">{{ String(i + 1).padStart(2, '0') }}</div>
              <div class="sf-stage-copy">
                <div class="sf-stage-label">
                  <strong>{{ step.label }}</strong>
                  <span v-if="i === 0" class="sf-entry-tag">entry</span>
                </div>
                <span class="sf-stage-meta">{{ svcFunnelStepMeta(i) }}</span>
              </div>
              <div class="sf-stage-volume">
                <div class="sf-stage-track" aria-hidden="true">
                  <span :style="{ width: `${Math.max(step.pct_of_first, 2)}%` }"></span>
                </div>
                <strong>{{ step.count.toLocaleString() }}</strong>
              </div>
              <div class="sf-stage-stats">
                <strong>{{ sfPctLabel(step, i) }}</strong>
                <span v-if="i > 0">−{{ step.drop_off.toLocaleString() }} from prior</span>
                <span v-else>baseline</span>
              </div>
            </li>
          </ol>

          <div class="sf-result-note">
            <span class="sf-note-rule"></span>
            Counts represent distinct traces matching each stage in the selected window. Use the stage with the largest drop-off as the next investigation target.
          </div>
        </div>

        <div v-else-if="svcFunnelSel && svcFunnelLoaded" class="sf-no-result">
          <div>
            <strong>Run this funnel against trace data</strong>
            <span>Choose a time window, then inspect where traffic leaves the path.</span>
          </div>
          <button class="sf-run-btn" @click="runSvcFunnel">Run analysis</button>
        </div>
      </div>
      </section><!-- /funnels -->

    </template>

    <!-- ═══ Expanded chart modal ═══ -->
    <Teleport to="body">
      <dialog v-if="expandedChart" ref="chartDialog" class="chart-modal" aria-labelledby="service-chart-title"
        @cancel.prevent="closeChart" @click.self="closeChart">
        <div class="chart-modal-header">
          <h2 id="service-chart-title" class="chart-modal-title">{{ chartTitles[expandedChart] }}</h2>
          <button class="chart-modal-close" type="button" aria-label="Close expanded chart" autofocus @click="closeChart">&times;</button>
        </div>
        <div class="chart-modal-body">
            <!-- Service Map -->
            <template v-if="expandedChart === 'map'">
              <div v-if="svcConnected.length === 0" class="svc-map-empty text-muted">No connections found</div>
              <svg v-else viewBox="0 0 600 250" preserveAspectRatio="xMidYMid meet" class="modal-map-svg">
                <template v-for="(src, i) in svcEdges.incoming.slice(0, 5)" :key="'min-' + src.source">
                  <line :x1="40" :y1="30 + i * 45" x2="230" y2="125" :stroke="edgeColor(src)" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-dasharray="3,2" marker-end="url(#modal-arrow)" opacity="0.85"><title>{{ edgeTitle(src, src.source) }}</title></line>
                  <text :x="36" :y="30 + i * 45" text-anchor="end" class="modal-map-label" dominant-baseline="central">{{ src.source }}</text>
                </template>
                <rect x="220" y="100" width="160" height="50" rx="6" fill="var(--amber-dim)" stroke="var(--amber)" stroke-width="2" />
                <text x="300" y="125" text-anchor="middle" dominant-baseline="central" class="modal-map-center">{{ serviceName }}</text>
                <template v-for="(tgt, i) in svcEdges.outgoing.slice(0, 5)" :key="'mout-' + tgt.target">
                  <line x1="380" y1="125" :x2="560" :y2="30 + i * 45" :stroke="edgeColor(tgt)" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-dasharray="3,2" marker-end="url(#modal-arrow)" opacity="0.85"><title>{{ edgeTitle(tgt, tgt.target) }}</title></line>
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
            <HistogramPanel
              v-else-if="expandedChart === 'hist'"
              title="Request duration buckets"
              unit="requests"
              :bins="latencyDistributionBins"
              :markers="latencyDistributionMarkers"
              :min-label="histMinLabel"
              :max-label="histMaxLabel"
              :loading="timeBreakdownLoading && !latencyHist"
            />

            <template v-else>
              <div class="expanded-chart-controls">
                <span>Drag across the plot to zoom.</span>
                <button class="svc-chart-expand" type="button" :disabled="!chartZoom" @click="resetChartZoom">Reset zoom</button>
              </div>
              <TimeseriesWidget
                v-if="expandedChart === 'latency'"
                class="expanded-latency"
                :buckets="[]"
                :series="inExpandedRange(latencyChartSeries)"
                unit="ms"
                :time-domain="expandedDomain"
                :bucket-seconds="serviceQueryBucketSeconds(minutes)"
                :deploys="serviceChartDeploys"
                zoomable
                @range-select="zoomCharts"
              />
              <div v-else class="expanded-signals">
                <section v-for="signal in signalCharts" :key="signal.name" :aria-label="signal.name">
                  <h3>{{ signal.name }}</h3>
                  <TimeseriesWidget
                    :buckets="[]"
                    :series="inExpandedRange(signal.series)"
                    :unit="signal.unit"
                    :time-domain="expandedDomain"
                    :bucket-seconds="serviceQueryBucketSeconds(minutes)"
                    :deploys="serviceChartDeploys"
                    display-mode="stacked-bars"
                    linked-readout
                    zoomable
                    @range-select="zoomCharts"
                  />
                </section>
              </div>
            </template>
        </div>
      </dialog>
    </Teleport>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ServiceDetailView.css"></style>
<style src="../styles/views/ServiceDetailView.global.css"></style>
