<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { RushEvent, Filter, CountBucket, QueryFilter, GroupResult, SavedQuery, TimeseriesBucket, TraceResponse, SpanNode, LogRecord, BubbleUpResponse } from '../types'
import SavedQueries from '../components/SavedQueries.vue'
import QueryHistory from '../components/QueryHistory.vue'
import { useQueryHistory } from '../composables/useQueryHistory'
import type { HistoryEntry } from '../composables/useQueryHistory'
import TimePicker from '../components/TimePicker.vue'
import ContextMenu from '../components/ContextMenu.vue'
import PanelCard from '../components/PanelCard.vue'
import { useTenant } from '../composables/useTenant'
import { compareFindingStrength, compareFindingSummary, rankCompareFindings } from '../lib/compareFindings'

interface ContextMenuItem {
  label: string
  icon?: string
  action: () => void
  separator?: false
  disabled?: boolean
}

interface ContextMenuSeparator {
  separator: true
}

type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ExploreHistoryQuery {
  filters: Filter[]
  groupBy?: string
  search?: string
  timePreset: number
  viewMode: 'spans' | 'logs'
}

const { entries: exploreHistory, push: pushHistory, remove: removeHistory, clear: clearHistory } = useQueryHistory<ExploreHistoryQuery>('rush_explore_history')

const router = useRouter()
const route = useRoute()
const api = useApi()
const { features } = useFeatures()

const selectedPreset = ref(60)

// ═══ Custom time range ═══
const customRange = ref<{ from: string; to: string } | null>(null)

// Reactive "now" anchor for relative ranges. `new Date()` is not reactive, so a
// computed that calls it would cache forever and the window (and the histogram
// axis derived from it) would freeze at first access. We bump `nowTick` whenever
// a query is issued (search, live poll) so the window — and everything that reads
// it — always reflects the current time at query moment.
const nowTick = ref(Date.now())
function refreshNow() { nowTick.value = Date.now() }

const timeRange = computed(() => {
  if (customRange.value) return customRange.value
  const to = new Date(nowTick.value)
  const from = new Date(to.getTime() - selectedPreset.value * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
})

// ═══ Search mode ═══
const showQueryBuilder = ref(false)

const searchInput = ref('')
const filters = ref<Filter[]>([])

// ═══ Natural language query mode ═══
interface NlChip { field: string; op: string; value: string | number }
const nlMode = ref(false)
const nlInput = ref('')
const nlInputEl = ref<HTMLInputElement | null>(null)
const nlLoading = ref(false)
const nlChips = ref<NlChip[]>([])
const nlSearch = ref('')
const nlConfidence = ref(0)
const builderFilters = ref<QueryFilter[]>([])
const results = ref<RushEvent[]>([])
const total = ref(0)
const histogram = ref<CountBucket[]>([])
const queryDurationMs = ref<number | null>(null)
const searching = ref(false)
const histogramPhase = ref<'idle' | 'waiting' | 'loading' | 'done'>('idle')

// ═══ Logs match histogram (adaptive, click-to-zoom) ═══
// Time-bucketed count of matching log lines across the selected range, fetched
// in parallel and non-blocking so rows render immediately. Backed by the
// dedicated /logs/histogram endpoint (adaptive bucket sizing, ~120 buckets).
const matchHisto = ref<{ ts: number; count: number }[]>([])
const matchHistoInterval = ref(0)
const matchHistoLoading = ref(false)
// Monotonic token so a slow histogram from a superseded search can't overwrite
// the current one when it resolves late.
let matchHistoSeq = 0
const PAGE_SIZE = 100
const loadingMore = ref(false)
const hasMore = computed(() => results.value.length < total.value)
const expandedRow = ref<number | null>(null)
const expandedTab = ref<'metrics' | 'attributes' | 'k8s' | 'context' | null>(null)

// ═══ Keyboard navigation (vim/k9s style) ═══
const selectedRowIndex = ref(-1)
const showShortcuts = ref(false)
let lastGPress = 0

// Lazy-loaded data for active expanded row
const expandedApm = ref<TimeseriesBucket[] | null>(null)
const expandedApmLoading = ref(false)
const expandedApmEventMs = ref(0) // event timestamp in ms, for marker position
const expandedTrace = ref<TraceResponse | null>(null)
const expandedTraceLoading = ref(false)
const timelineExpandedSpan = ref<string | null>(null)

const expandedRowData = computed(() => {
  if (expandedRow.value === null) return null
  return results.value[expandedRow.value] || null
})

// Which span is "active" in the detail modal (defaults to the clicked row's span)
const selectedSpanId = ref<string | null>(null)

const activeSpanId = computed(() => {
  return selectedSpanId.value || expandedRowData.value?.span_id || null
})

// The active SpanNode from the trace (for showing selected span's details)
const activeSpanNode = computed((): import('../types').SpanNode | null => {
  const id = activeSpanId.value
  if (!id || !expandedTrace.value) return null
  const allSpans = flattenSpans(expandedTrace.value.spans)
  return allSpans.find(s => s.span_id === id) || null
})

const expandedTraceSpans = computed(() => {
  if (!expandedTrace.value) return []
  return flattenSpans(expandedTrace.value.spans)
})

// ═══ View mode: spans vs logs ═══
const viewMode = ref<'spans' | 'logs'>('spans')
const tracesOnly = ref(false)
const apmResultMode = ref<'individual' | 'groups'>('individual')
const otelLogs = ref<LogRecord[]>([])

// Per-tenant signal config: when APM is disabled for the active tenant we hide
// the APM/Logs toggle and force the Logs view. The tenant list (with signals)
// loads asynchronously, so react to it changing too.
const { apmEnabled, loadTenants: loadTenantSignals, loaded: tenantsLoaded } = useTenant()
if (!tenantsLoaded.value) loadTenantSignals()

// ═══ Live mode ═══
const liveMode = ref(false)
let liveInterval: ReturnType<typeof setInterval> | null = null
let livePolling = false
const liveNewIds = ref(new Set<string>())
let livePrevIds = new Set<string>()

function setViewMode(mode: 'spans' | 'logs') {
  viewMode.value = mode
  const query = { ...route.query }
  if (mode === 'logs') {
    query.mode = 'logs'
  } else {
    delete query.mode
  }
  router.replace({ query })
  // Always re-search when switching modes — refreshes both the list
  // AND the histogram (which uses a different endpoint per mode).
  search({ skipHistory: true })
}

watch(tracesOnly, () => {
  if (viewMode.value === 'spans') search({ skipHistory: true })
})

// If APM is disabled for this tenant, the APM/traces views aren't available —
// force the Logs view (covers async tenant-config load and tenant switches).
watch(apmEnabled, (enabled) => {
  if (!enabled && viewMode.value === 'spans') {
    tracesOnly.value = false
    setViewMode('logs')
  }
}, { immediate: true })

watch([selectedPreset, customRange], () => {
  search({ skipHistory: true })
})

// Fields that only exist on spans (spans), not on logs
const SPAN_ONLY_FIELDS = ['duration_ns', 'http_status_code', 'http_method', 'http_path', 'status']

async function fetchOtelLogs() {
  try {
    const activeFilters = getActiveFilters()
      .filter(f => !SPAN_ONLY_FIELDS.includes(f.field))
    const searchParam = searchText.value || undefined
    const res = await api.queryLogs({
      slim: true,
      time_range: timeRange.value,
      filters: activeFilters,
      limit: 500,
      search: searchParam,
    })
    otelLogs.value = res.rows
  } catch { /* error in api.error */ }
}

async function livePoll() {
  if (livePolling || !liveMode.value) return
  livePolling = true
  try {
    const activeFilters = getActiveFilters()
    const searchParam = searchText.value || undefined
    // Advance the shared window to now so the query AND the histogram axis
    // (filledHistogram reads timeRange) slide forward together each poll.
    refreshNow()
    const tr = timeRange.value

    const eventsRes = await api.queryEvents({
      time_range: tr,
      filters: activeFilters,
      limit: 100,
      search: searchParam,
    })
    const queryResult = eventsRes as { rows: RushEvent[]; total: number }
    // Track which rows are new for the fade-in effect
    const freshIds = new Set(queryResult.rows.map(r => r.span_id))
    const newIds = new Set<string>()
    for (const id of freshIds) {
      if (!livePrevIds.has(id)) newIds.add(id)
    }
    liveNewIds.value = newIds
    livePrevIds = freshIds
    results.value = queryResult.rows
    total.value = queryResult.total

    const intervalBucket = selectedPreset.value <= 60 ? '1m' : selectedPreset.value <= 360 ? '5m' : '1h'
    const isLogs = viewMode.value === 'logs'
    const logFilters = activeFilters.filter(f => !SPAN_ONLY_FIELDS.includes(f.field))

    if (isLogs) {
      const countRes = await api.countLogs({
        time_range: tr,
        filters: logFilters,
        interval: intervalBucket,
        search: searchParam,
      })
      histogram.value = countRes as CountBucket[]
      const logsRes = await api.queryLogs({
        slim: true,
        time_range: tr,
        filters: logFilters,
        limit: 500,
        search: searchParam,
      })
      otelLogs.value = logsRes.rows
      total.value = (logsRes as { rows: LogRecord[]; total: number }).total
    } else {
      const countRes = await api.queryCount({
        time_range: tr,
        filters: activeFilters,
        interval: intervalBucket,
        search: searchParam,
      })
      histogram.value = countRes as CountBucket[]
    }
  } catch {
    // Swallow errors silently for live polling — don't let a transient
    // failure stick in api.error and replace the results table with an
    // error banner.  Clear the error so the existing results stay visible.
    api.error.value = null
  } finally {
    livePolling = false
  }
}

function stopLive() {
  liveMode.value = false
  if (liveInterval) {
    clearInterval(liveInterval)
    liveInterval = null
  }
  liveNewIds.value = new Set()
  livePrevIds = new Set()
}

function toggleLive() {
  if (liveMode.value) {
    stopLive()
  } else {
    liveMode.value = true
    customRange.value = null
    livePoll()
    liveInterval = setInterval(livePoll, 10000)
  }
}

interface LogEntry {
  timestamp: number
  service_name: string
  trace_id: string
  span_id: string
  level: string
  message: string
  event_name: string
  event_attrs: Record<string, unknown>
  resource_attrs: Record<string, string>
  span_http_method: string
  span_http_path: string
  _sourceRowIndex: number
  _sourceLogIndex: number
  _detailLoaded: boolean
  _source: 'span' | 'otel'
}

const logEntries = computed(() => {
  const entries: LogEntry[] = []

  // Span event logs
  for (let ri = 0; ri < results.value.length; ri++) {
    const row = results.value[ri]!
    // Extract resource-level attrs from the parent span (k8s metadata, etc.)
    let spanResourceAttrs: Record<string, string> = {}
    try {
      const parsed = JSON.parse(row.attributes || '{}')
      for (const [k, v] of Object.entries(parsed)) {
        if (k.startsWith('k8s.') || k.startsWith('container.') || k.startsWith('cloud.') || k.startsWith('host.') || k === 'deployment.environment') {
          spanResourceAttrs[k] = String(v)
        }
      }
    } catch {}
    for (let i = 0; i < row.event_names.length; i++) {
      let attrs: Record<string, unknown> = {}
      try { attrs = JSON.parse(row.event_attributes[i] || '{}') } catch {}
      const message = (attrs['log.message'] as string) || (attrs['exception.message'] as string) || row.event_names[i] || ''
      const level = (attrs['log.level'] as string) || (attrs['log.severity'] as string) || ''
      entries.push({
        timestamp: row.event_timestamps[i] ?? row.timestamp,
        service_name: row.service_name,
        trace_id: row.trace_id,
        span_id: row.span_id,
        level: level.toLowerCase(),
        message,
        event_name: row.event_names[i] || '',
        event_attrs: attrs,
        resource_attrs: spanResourceAttrs,
        span_http_method: row.http_method,
        span_http_path: row.http_path,
        _sourceRowIndex: ri,
        _sourceLogIndex: -1,
        _detailLoaded: true,
        _source: 'span',
      })
    }
  }

  // logs records
  for (let sourceLogIndex = 0; sourceLogIndex < otelLogs.value.length; sourceLogIndex++) {
    const log = otelLogs.value[sourceLogIndex]!
    entries.push({
      timestamp: log.Timestamp,
      service_name: log.ServiceName,
      trace_id: log.TraceId,
      span_id: log.SpanId,
      level: (log.SeverityText || '').toLowerCase(),
      message: log.Body,
      event_name: '',
      event_attrs: log.LogAttributes || {},
      resource_attrs: log.ResourceAttributes || {},
      span_http_method: '',
      span_http_path: '',
      _sourceRowIndex: -1,
      _sourceLogIndex: sourceLogIndex,
      _detailLoaded: log.ResourceAttributes !== undefined && log.LogAttributes !== undefined,
      _source: 'otel',
    })
  }

  entries.sort((a, b) => b.timestamp - a.timestamp)

  // Client-side filter with AND/OR boolean logic support.
  // Parses search text the same way the backend does: OR is explicit,
  // space-separated terms are AND, AND keyword is also AND.
  const raw = searchText.value?.trim()
  if (!raw) return entries

  const matchEntry = (e: typeof entries[0], term: string): boolean => {
    // key=value attribute lookup
    const eqIdx = term.indexOf('=')
    if (eqIdx > 0 && eqIdx < term.length - 1) {
      const key = term.substring(0, eqIdx).toLowerCase()
      const val = term.substring(eqIdx + 1).toLowerCase()
      // Check event_attrs and resource_attrs
      const allAttrs = { ...e.resource_attrs, ...e.event_attrs }
      for (const [k, v] of Object.entries(allAttrs)) {
        if (k.toLowerCase() !== key) continue
        const sv = String(v).toLowerCase()
        if (val.includes('*')) {
          const pattern = val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
          if (new RegExp(`^${pattern}$`).test(sv)) return true
        } else {
          if (sv === val) return true
        }
      }
      return false
    }

    // Free-text search across all fields including resource_attrs, trace/span IDs
    const t = term.toLowerCase()
    const fields = [
      e.message.toLowerCase(),
      e.event_name.toLowerCase(),
      e.service_name.toLowerCase(),
      e.level.toLowerCase(),
      e.trace_id.toLowerCase(),
      e.span_id.toLowerCase(),
      JSON.stringify(e.event_attrs).toLowerCase(),
      JSON.stringify(e.resource_attrs).toLowerCase(),
    ]
    if (t.includes('*')) {
      const pattern = t.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      const re = new RegExp(pattern)
      return fields.some(f => re.test(f))
    }
    return fields.some(f => f.includes(t))
  }

  // Tokenize with quoted-phrase support, then parse into OR-groups of AND-terms
  // (mirrors backend tokenize_search + parse_search_expr)
  const tokenize = (s: string): string[] => {
    const toks: string[] = []
    let i = 0
    while (i < s.length) {
      if (s[i] === ' ' || s[i] === '\t') { i++; continue }
      if (s[i] === '"') {
        i++ // skip opening quote
        let phrase = ''
        while (i < s.length && s[i] !== '"') { phrase += s[i]; i++ }
        if (i < s.length) i++ // skip closing quote
        if (phrase) toks.push(phrase)
      } else {
        let word = ''
        while (i < s.length && s[i] !== ' ' && s[i] !== '\t' && s[i] !== '"') { word += s[i]; i++ }
        if (word) toks.push(word)
      }
    }
    return toks
  }
  const tokens = tokenize(raw)
  const andGroups: string[][] = [[]]
  for (const tok of tokens) {
    if (tok.toUpperCase() === 'OR') {
      andGroups.push([])
    } else if (tok.toUpperCase() !== 'AND') {
      andGroups[andGroups.length - 1]!.push(tok)
    }
  }
  const groups = andGroups.filter(g => g.length > 0)
  if (!groups.length) return entries

  return entries.filter(e => {
    // Collected logs have already been filtered by the shared server compiler.
    // Their attribute maps are intentionally absent from slim list rows, so a
    // second client-side attribute search would incorrectly hide valid matches.
    if (e._source === 'otel') return true
    // OR between groups, AND within each group
    return groups.some(group => group.every(term => matchEntry(e, term)))
  })
})

const expandedLogRow = ref<number | null>(null)

const logDetailLoading = ref(new Set<number>())
const logDetailErrors = ref(new Set<number>())

async function hydrateOtelLog(entry: LogEntry): Promise<void> {
  const idx = entry._sourceLogIndex
  if (entry._source !== 'otel' || idx < 0 || entry._detailLoaded || logDetailLoading.value.has(idx)) return
  const row = otelLogs.value[idx]
  if (!row) return

  logDetailLoading.value = new Set(logDetailLoading.value).add(idx)
  const errors = new Set(logDetailErrors.value)
  errors.delete(idx)
  logDetailErrors.value = errors
  try {
    const detail = await api.getLogDetail(row)
    const next = [...otelLogs.value]
    // Preserve list-only locator fields so reopening does not require another list query.
    next[idx] = { ...row, ...detail }
    otelLogs.value = next
  } catch {
    logDetailErrors.value = new Set(logDetailErrors.value).add(idx)
  } finally {
    const loading = new Set(logDetailLoading.value)
    loading.delete(idx)
    logDetailLoading.value = loading
  }
}

function toggleLogRow(index: number) {
  // A user interaction dismisses the deep-link highlight.
  if (highlightLogIdx.value !== null) highlightLogIdx.value = null
  if (inlineExpandedLog.value === index) {
    inlineExpandedLog.value = null
  } else {
    inlineExpandedLog.value = index
    const entry = logEntries.value[index]
    if (entry) void hydrateOtelLog(entry)
  }
  // Keep the address bar shareable: an expanded log encodes `&log=<ts>` so the
  // link reopens and scrolls to this exact line for context.
  syncUrlState()
}

// Deep-link target resolution: scroll to (and briefly highlight) the log line
// nearest `targetTs` (ns). Two complications handled here:
//  1. Nanosecond timestamps exceed JS's safe-integer range, so they round when
//     parsed — we match by *nearest*, never exact equality.
//  2. The logs list is capped (500 rows, newest first). In a dense window the
//     target is usually NOT on the loaded page, so if the closest loaded row is
//     far from the target we reload a tight window centered on it first.
function nearestLogIdx(targetTs: number): { idx: number; dist: number } {
  let idx = -1
  let best = Infinity
  logEntries.value.forEach((e, i) => {
    const d = Math.abs(e.timestamp - targetTs)
    if (d < best) { best = d; idx = i }
  })
  return { idx, dist: best }
}

async function scrollToLogByTimestamp(targetTs: number) {
  let { idx, dist } = nearestLogIdx(targetTs)
  // If nothing loaded, or the closest loaded log is more than ~0.5s away, the
  // target isn't on the current page — reload a ±5s context window around it so
  // it's guaranteed present (and shows the surrounding lines for context).
  if (idx < 0 || dist > 500_000_000) {
    const tsMs = targetTs / 1_000_000
    customRange.value = {
      from: new Date(tsMs - 5_000).toISOString(),
      to: new Date(tsMs + 5_000).toISOString(),
    }
    await search({ skipHistory: true })
    if (viewMode.value === 'logs') await fetchOtelLogs()
    await nextTick()
    ;({ idx, dist } = nearestLogIdx(targetTs))
  }
  if (idx < 0) return
  inlineExpandedLog.value = idx
  selectedRowIndex.value = idx
  // Persistent highlight — stays until the user clicks another row (cleared in
  // toggleLogRow) so the deep-linked line remains obvious, not a brief flash.
  highlightLogIdx.value = idx
  await nextTick()
  // Small delay so the expanded detail panel has rendered before we center.
  setTimeout(() => {
    document.querySelector(`.et-row[data-log-i="${idx}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 80)
}

function logLevelClass(level: string): string {
  if (level === 'error' || level === 'fatal') return 'lv-error'
  if (level === 'warn' || level === 'warning') return 'lv-warn'
  if (level === 'debug' || level === 'trace') return 'lv-debug'
  return 'lv-info'
}

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function fmtDateUtc(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function formatLogTimestamp(ns: number): string {
  try {
    const d = new Date(ns / 1_000_000)
    if (isNaN(d.getTime())) return String(ns)
    const time = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)
    return `${fmtDate(d)} ${time}`
  } catch { return String(ns) }
}

function timestampTooltip(ns: number): string {
  try {
    const d = new Date(ns / 1_000_000)
    if (isNaN(d.getTime())) return ''
    const localTime = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)
    const utcTime = d.toISOString().slice(11, 23)
    return `Local: ${fmtDate(d)} ${localTime}\nUTC:   ${fmtDateUtc(d)} ${utcTime}`
  } catch { return '' }
}

// ═══ Quick filters ═══
const quickService = ref('')
const quickMethod = ref('')
const quickStatusRange = ref('')  // '2xx' | '4xx' | '5xx' | ''
const quickErrorOnly = ref(false)
const quickDuration = ref('')     // 'fast' | 'med' | 'slow' | ''
const durationSliderMin = ref(0)           // ns — 0 means unset
const durationSliderMax = ref(30_000_000_000)  // ns — default 30s
const availableServices = ref<string[]>([])

// Server-side facet counts (from group-by queries, not client-side row counting)
const serverServiceCounts = ref<Map<string, number>>(new Map())
const serverStatusCounts = ref<{ ok: number; clientErr: number; serverErr: number }>({ ok: 0, clientErr: 0, serverErr: 0 })
const serverMethodCounts = ref<Map<string, number>>(new Map())

async function loadServices() {
  try {
    const vals = await api.suggestValues('service_name')
    availableServices.value = vals.filter(Boolean)
  } catch { /* ignore */ }
}

function getQuickFilters(): Filter[] {
  const qf: Filter[] = []
  if (quickService.value) qf.push({ field: 'service_name', op: '=', value: quickService.value })
  if (quickMethod.value) qf.push({ field: 'http_method', op: '=', value: quickMethod.value })
  if (quickErrorOnly.value) qf.push({ field: 'status', op: '=', value: 'ERROR' })
  if (quickStatusRange.value === '2xx') {
    qf.push({ field: 'http_status_code', op: '>=', value: 200 })
    qf.push({ field: 'http_status_code', op: '<', value: 300 })
  } else if (quickStatusRange.value === '4xx') {
    qf.push({ field: 'http_status_code', op: '>=', value: 400 })
    qf.push({ field: 'http_status_code', op: '<', value: 500 })
  } else if (quickStatusRange.value === '5xx') {
    qf.push({ field: 'http_status_code', op: '>=', value: 500 })
  }
  const sliderMaxNs = SLIDER_STOPS[SLIDER_STOPS.length - 1] ?? 0
  const sliderMinActive = durationSliderMin.value > 0
  const sliderMaxActive = durationSliderMax.value > 0 && durationSliderMax.value < sliderMaxNs
  if (sliderMinActive || sliderMaxActive) {
    // Slider overrides presets
    if (sliderMinActive) {
      qf.push({ field: 'duration_ns', op: '>=', value: durationSliderMin.value })
    }
    if (sliderMaxActive) {
      qf.push({ field: 'duration_ns', op: '<=', value: durationSliderMax.value })
    }
  } else if (quickDuration.value === 'fast') {
    qf.push({ field: 'duration_ns', op: '<', value: 100_000_000 })
  } else if (quickDuration.value === 'med') {
    qf.push({ field: 'duration_ns', op: '>=', value: 100_000_000 })
    qf.push({ field: 'duration_ns', op: '<', value: 500_000_000 })
  } else if (quickDuration.value === 'slow') {
    qf.push({ field: 'duration_ns', op: '>=', value: 500_000_000 })
  }
  return qf
}

function toggleQuickService(val: string) {
  quickService.value = quickService.value === val ? '' : val
  search()
}
function toggleQuickMethod(val: string) {
  quickMethod.value = quickMethod.value === val ? '' : val
  search()
}
function toggleQuickStatus(val: string) {
  quickStatusRange.value = quickStatusRange.value === val ? '' : val
  search()
}
function toggleQuickDuration(val: string) {
  quickDuration.value = quickDuration.value === val ? '' : val
  durationSliderMin.value = 0
  durationSliderMax.value = 0
  search()
}

// Slider constants — positions map to nanosecond values on a log scale
const SLIDER_STOPS = [
  0,               // 0 (unset)
  1_000_000,       // 1ms
  5_000_000,       // 5ms
  10_000_000,      // 10ms
  25_000_000,      // 25ms
  50_000_000,      // 50ms
  100_000_000,     // 100ms
  250_000_000,     // 250ms
  500_000_000,     // 500ms
  1_000_000_000,   // 1s
  2_000_000_000,   // 2s
  5_000_000_000,   // 5s
  10_000_000_000,  // 10s
  30_000_000_000,  // 30s
]

function sliderPosToNs(pos: number): number {
  const idx = Math.round(pos)
  return SLIDER_STOPS[Math.min(idx, SLIDER_STOPS.length - 1)] ?? 0
}

function nsToSliderPos(ns: number): number {
  if (ns <= 0) return 0
  for (let i = SLIDER_STOPS.length - 1; i >= 0; i--) {
    if (ns >= SLIDER_STOPS[i]!) return i
  }
  return 0
}

function onSliderMinChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  const ns = sliderPosToNs(val)
  durationSliderMin.value = ns
  // Ensure min doesn't exceed max
  if (durationSliderMax.value > 0 && ns > durationSliderMax.value) {
    durationSliderMax.value = ns
  }
  quickDuration.value = ''
  search()
}

function onSliderMaxChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  const ns = sliderPosToNs(val)
  durationSliderMax.value = ns
  // Ensure max doesn't go below min
  if (durationSliderMin.value > 0 && ns < durationSliderMin.value && ns > 0) {
    durationSliderMin.value = ns
  }
  quickDuration.value = ''
  search()
}

function clearDurationSlider() {
  durationSliderMin.value = 0
  durationSliderMax.value = 0
  search()
}

function clearQuickFilters() {
  quickService.value = ''
  quickMethod.value = ''
  quickStatusRange.value = ''
  quickErrorOnly.value = false
  quickDuration.value = ''
  durationSliderMin.value = 0
  durationSliderMax.value = 0
  search()
}

const hasQuickFilters = computed(() => {
  const maxNs = SLIDER_STOPS[SLIDER_STOPS.length - 1] ?? 0
  const sliderActive = durationSliderMin.value > 0 || (durationSliderMax.value > 0 && durationSliderMax.value < maxNs)
  return quickService.value || quickMethod.value || quickStatusRange.value || quickErrorOnly.value || quickDuration.value || sliderActive
})

// ═══ Facet counts (computed from current results) ═══
const facetCollapsed = ref<Record<string, boolean>>({})

function toggleFacet(name: string) {
  facetCollapsed.value[name] = !facetCollapsed.value[name]
}

const serviceFacets = computed(() => {
  // In logs mode, always derive from logEntries
  if (viewMode.value === 'logs') {
    const counts = new Map<string, number>()
    for (const entry of logEntries.value) {
      counts.set(entry.service_name, (counts.get(entry.service_name) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }
  // Use server-side counts when available (accurate across all results, not just loaded page)
  if (serverServiceCounts.value.size > 0) {
    const entries = [...serverServiceCounts.value.entries()]
    // Merge in available services that have 0 count
    for (const svc of availableServices.value) {
      if (!serverServiceCounts.value.has(svc)) entries.push([svc, 0])
    }
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }
  // Fallback: count from loaded rows
  const counts = new Map<string, number>()
  for (const row of results.value) {
    counts.set(row.service_name, (counts.get(row.service_name) || 0) + 1)
  }
  for (const svc of availableServices.value) {
    if (!counts.has(svc)) counts.set(svc, 0)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
})

const methodFacets = computed(() => {
  // Use server-side counts when available
  if (serverMethodCounts.value.size > 0) {
    return [...serverMethodCounts.value.entries()]
      .filter(([name]) => name)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }
  // Fallback: count from loaded rows
  const counts = new Map<string, number>()
  for (const row of results.value) {
    if (row.http_method) counts.set(row.http_method, (counts.get(row.http_method) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
})

const statusFacets = computed(() => {
  // In logs mode, always derive from logEntries severity levels
  if (viewMode.value === 'logs') {
    let ok = 0, clientErr = 0, serverErr = 0
    for (const entry of logEntries.value) {
      const lvl = entry.level.toLowerCase()
      if (lvl === 'error' || lvl === 'fatal' || lvl === 'critical') serverErr++
      else if (lvl === 'warn' || lvl === 'warning') clientErr++
      else ok++
    }
    return [
      { name: '2xx', label: 'OK', count: ok, color: 'var(--ok)' },
      { name: '4xx', label: 'Client Error', count: clientErr, color: 'var(--warning)' },
      { name: '5xx', label: 'Server Error', count: serverErr, color: 'var(--error)' },
    ]
  }
  // Use server-side counts when available
  const ss = serverStatusCounts.value
  if (ss.ok > 0 || ss.clientErr > 0 || ss.serverErr > 0) {
    return [
      { name: '2xx', label: 'OK', count: ss.ok, color: 'var(--ok)' },
      { name: '4xx', label: 'Client Error', count: ss.clientErr, color: 'var(--warning)' },
      { name: '5xx', label: 'Server Error', count: ss.serverErr, color: 'var(--error)' },
    ]
  }
  // Fallback: count from loaded rows
  let ok = 0, clientErr = 0, serverErr = 0
  for (const row of results.value) {
    if (row.http_status_code >= 500) serverErr++
    else if (row.http_status_code >= 400) clientErr++
    else ok++
  }
  return [
    { name: '2xx', label: 'OK', count: ok, color: 'var(--ok)' },
    { name: '4xx', label: 'Client Error', count: clientErr, color: 'var(--warning)' },
    { name: '5xx', label: 'Server Error', count: serverErr, color: 'var(--error)' },
  ]
})

// @ts-ignore reserved for template use
const durationStats = computed(() => {
  // In logs mode with active search, derive from logEntries (no duration data → zeros)
  if (viewMode.value === 'logs' && searchText.value?.trim() && logEntries.value.length === 0) {
    return { min: 0, max: 0, minLabel: '0ms', maxLabel: '0ms' }
  }
  if (!results.value.length) return { min: 0, max: 0, minLabel: '0ms', maxLabel: '0ms' }
  const durs = results.value.map(r => r.duration_ns)
  const min = Math.min(...durs)
  const max = Math.max(...durs)
  return { min, max, minLabel: formatDuration(min), maxLabel: formatDuration(max) }
})

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ═══ Group-by ═══
const groupByField = ref('')
const groupResults = ref<GroupResult[]>([])
const groupLoading = ref(false)

const searchText = ref('')  // free-text portion of search input

function parseSearch() {
  const input = searchInput.value.trim()
  const newFilters: Filter[] = []
  const textParts: string[] = []

  // Tokenize respecting quotes: quoted phrases go straight to search text
  let i = 0
  while (i < input.length) {
    if (input[i] === ' ' || input[i] === '\t') { i++; continue }
    if (input[i] === '"') {
      // Quoted phrase → always search text (including the quotes for backend parsing)
      const start = i
      i++ // skip opening quote
      while (i < input.length && input[i] !== '"') i++
      if (i < input.length) i++ // skip closing quote
      textParts.push(input.substring(start, i))
    } else {
      // Unquoted word — but if we hit a quote after an operator (e.g. key="val"),
      // consume through the closing quote so the value stays with the key.
      let word = ''
      while (i < input.length && input[i] !== ' ' && input[i] !== '\t') {
        if (input[i] === '"' || input[i] === "'") {
          const q = input[i]
          word += input[i]; i++ // opening quote
          while (i < input.length && input[i] !== q) { word += input[i]; i++ }
          if (i < input.length) { word += input[i]; i++ } // closing quote
        } else {
          word += input[i]; i++
        }
      }
      if (!word) continue
      // Check if it's a filter expression (key=value, key!=value, etc.)
      // But only if it's NOT an OR/AND keyword
      if (word.toUpperCase() === 'OR' || word.toUpperCase() === 'AND') {
        textParts.push(word)
      } else {
        const match = word.match(/^([^=!<>]+)(!=|>=|<=|=|>|<)(.+)$/)
        if (match) {
          const field = match[1] ?? ''
          const op = match[2] ?? '='
          // Strip surrounding quotes from the value: "atlas" → atlas
          let value = match[3] ?? ''
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          const numVal = Number(value)
          newFilters.push({ field, op, value: isNaN(numVal) ? value : numVal })
        } else {
          textParts.push(word)
        }
      }
    }
  }
  filters.value = newFilters
  searchText.value = textParts.join(' ')
}

function getActiveFilters(): Filter[] {
  let base: Filter[]
  if (showQueryBuilder.value) {
    base = builderFilters.value
      .filter(f => f.field && f.value)
      .map(f => {
        const numVal = Number(f.value)
        return { field: f.field, op: f.op, value: isNaN(numVal) ? f.value : numVal }
      })
  } else {
    parseSearch()
    base = filters.value
  }
  const all = [...base, ...getQuickFilters()]
  if (tracesOnly.value && viewMode.value === 'spans') {
    all.push({ field: 'parent_span_id', op: '=', value: '' })
  }
  return all
}

async function search(opts?: { skipHistory?: boolean }) {
  if (searching.value) return // prevent duplicate concurrent searches
  stopLive()
  closeBubbleUp()
  refreshNow() // anchor the relative window to current time for this search
  selectedRowIndex.value = -1
  searching.value = true
  const searchStart = performance.now()
  queryDurationMs.value = null
  const activeFilters = getActiveFilters()
  filters.value = activeFilters
  const searchParam = searchText.value || undefined

  if (!opts?.skipHistory && (activeFilters.length > 0 || searchParam)) {
    pushHistory({
      filters: activeFilters,
      groupBy: groupByField.value || undefined,
      search: searchParam,
      timePreset: selectedPreset.value,
      viewMode: viewMode.value,
    })
  }

  try {
    const isLogs = viewMode.value === 'logs'
    const intervalBucket = selectedPreset.value <= 60 ? '1m' : selectedPreset.value <= 360 ? '5m' : '1h'
    const logFilters = activeFilters.filter(f => !SPAN_ONLY_FIELDS.includes(f.field))

    // Phase 1: Load search results first (histogram waits)
    histogram.value = []
    histogramPhase.value = 'waiting'
    serverServiceCounts.value = new Map()
    serverStatusCounts.value = { ok: 0, clientErr: 0, serverErr: 0 }
    serverMethodCounts.value = new Map()

    if (isLogs) {
      // ── Logs mode: only fetch logs (skip slow span query) ──
      // Clear span-mode data so facets don't show stale span counts
      results.value = []
      serverServiceCounts.value = new Map()
      serverStatusCounts.value = { ok: 0, clientErr: 0, serverErr: 0 }

      // Match histogram: fire-and-forget so it never blocks row rendering.
      // (For common terms over wide ranges the count scan can take seconds.)
      matchHisto.value = []
      void fetchMatchHistogram(searchParam, logFilters)

      const logPromises: Promise<any>[] = [
        api.queryLogs({
          slim: true,
          time_range: timeRange.value,
          filters: logFilters,
          limit: 500,
          search: searchParam,
        }),
      ]
      if (groupByField.value) {
        groupLoading.value = true
        logPromises.push(
          api.queryGroup({
            time_range: timeRange.value,
            filters: activeFilters,
            group_by: [groupByField.value],
            limit: 20,
            search: searchParam,
          })
        )
      }
      const settled = await Promise.allSettled(logPromises)
      if (settled[0]?.status === 'fulfilled') {
        const logResult = (settled[0] as PromiseFulfilledResult<any>).value as { rows: LogRecord[]; total: number }
        otelLogs.value = logResult.rows
        total.value = logResult.total
      }
      if (groupByField.value && settled[1]?.status === 'fulfilled') {
        const gr = (settled[1] as PromiseFulfilledResult<any>).value as { groups: GroupResult[] }
        groupResults.value = gr.groups || []
      }
    } else {
      // ── Spans mode: fetch spans (+ logs if searching) ──
      // The match histogram is a logs-mode feature; supersede any in-flight
      // fetch and clear it so it doesn't linger in spans view.
      matchHistoSeq++
      matchHisto.value = []
      matchHistoLoading.value = false
      const resultPromises: Promise<any>[] = [
        api.queryEvents({
          time_range: timeRange.value,
          filters: activeFilters,
          limit: 100,
          search: searchParam,
        }),
      ]
      if (groupByField.value) {
        groupLoading.value = true
        resultPromises.push(
          api.queryGroup({
            time_range: timeRange.value,
            filters: activeFilters,
            group_by: [groupByField.value],
            limit: 20,
            search: searchParam,
          })
        )
      }
      if (searchParam) {
        resultPromises.push(
          api.queryLogs({
            slim: true,
            time_range: timeRange.value,
            filters: logFilters,
            limit: 500,
            search: searchParam,
          })
        )
      }
      // Facet queries: service_name, status code, and method breakdowns (server-side, not limited by page size)
      resultPromises.push(
        api.queryGroup({
          time_range: timeRange.value,
          filters: activeFilters,
          group_by: ['service_name'],
          limit: 100,
          search: searchParam,
        }).catch(() => null)
      )
      resultPromises.push(
        api.queryGroup({
          time_range: timeRange.value,
          filters: activeFilters,
          group_by: ['http_status_code'],
          limit: 100,
          search: searchParam,
        }).catch(() => null)
      )
      resultPromises.push(
        api.queryGroup({
          time_range: timeRange.value,
          filters: activeFilters,
          group_by: ['http_method'],
          limit: 20,
          search: searchParam,
        }).catch(() => null)
      )

      const settled = await Promise.allSettled(resultPromises)

      // Process span results
      if (settled[0]?.status === 'fulfilled') {
        const queryResult = (settled[0] as PromiseFulfilledResult<any>).value as { rows: RushEvent[]; total: number }
        results.value = queryResult.rows
        total.value = queryResult.total
      }
      // Process group results
      let nextIdx = 1
      if (groupByField.value) {
        if (settled[nextIdx]?.status === 'fulfilled') {
          const gr = (settled[nextIdx] as PromiseFulfilledResult<any>).value as { groups: GroupResult[] }
          groupResults.value = gr.groups || []
        }
        nextIdx++
      }
      // Process log results (only when searching from spans mode)
      if (searchParam) {
        if (settled[nextIdx]?.status === 'fulfilled') {
          const logResult = (settled[nextIdx] as PromiseFulfilledResult<any>).value as { rows: LogRecord[]; total: number }
          otelLogs.value = logResult.rows
          // Auto-switch to logs view when searching found no spans but did find logs
          if (results.value.length === 0 && logResult.rows.length > 0) {
            viewMode.value = 'logs'
            total.value = logResult.total
          }
        } else if (settled[nextIdx]?.status === 'rejected') {
          console.error('[search] queryLogs failed:', (settled[nextIdx] as PromiseRejectedResult).reason)
        }
        nextIdx++
      }

      // Process server-side service facets
      if (settled[nextIdx]?.status === 'fulfilled') {
        const facetResult = (settled[nextIdx] as PromiseFulfilledResult<any>).value as { groups: GroupResult[] } | null
        if (facetResult?.groups) {
          const m = new Map<string, number>()
          for (const g of facetResult.groups) m.set(g.key, g.count)
          serverServiceCounts.value = m
        }
      }
      nextIdx++

      // Process server-side status facets
      if (settled[nextIdx]?.status === 'fulfilled') {
        const facetResult = (settled[nextIdx] as PromiseFulfilledResult<any>).value as { groups: GroupResult[] } | null
        if (facetResult?.groups) {
          let ok = 0, clientErr = 0, serverErr = 0
          for (const g of facetResult.groups) {
            const code = parseInt(g.key, 10) || 0
            if (code >= 500) serverErr += g.count
            else if (code >= 400) clientErr += g.count
            else ok += g.count
          }
          serverStatusCounts.value = { ok, clientErr, serverErr }
        }
      }
      nextIdx++

      // Process server-side method facets
      if (settled[nextIdx]?.status === 'fulfilled') {
        const facetResult = (settled[nextIdx] as PromiseFulfilledResult<any>).value as { groups: GroupResult[] } | null
        if (facetResult?.groups) {
          const m = new Map<string, number>()
          for (const g of facetResult.groups) {
            if (g.key) m.set(g.key, g.count)
          }
          serverMethodCounts.value = m
        }
      }
    }

    // Results are in — stop main spinner, show results immediately
    searching.value = false
    groupLoading.value = false
    queryDurationMs.value = Math.round(performance.now() - searchStart)

    // Phase 2: Now load histogram
    histogramPhase.value = 'loading'
    console.log('[search] histogramPhase → loading')

    try {
      const histoResult = isLogs
        ? await api.countLogs({
            time_range: timeRange.value,
            filters: logFilters,
            interval: intervalBucket,
            search: searchParam,
          })
        : await api.queryCount({
            time_range: timeRange.value,
            filters: activeFilters,
            interval: intervalBucket,
            search: searchParam,
          })
      histogram.value = histoResult as CountBucket[]
    } catch (e) {
      console.error('[search] histogram query failed:', e)
      histogram.value = []
    }
    histogramPhase.value = 'idle'
  } catch (err) {
    console.error('[search] exception in result processing:', err)
    histogramPhase.value = 'idle'
  } finally {
    queryDurationMs.value = queryDurationMs.value ?? Math.round(performance.now() - searchStart)
    searching.value = false
    groupLoading.value = false
    syncUrlState()
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const activeFilters = getActiveFilters()
    const searchParam = searchText.value || undefined
    const res = await api.queryEvents({
      time_range: timeRange.value,
      filters: activeFilters,
      limit: PAGE_SIZE,
      offset: results.value.length,
      search: searchParam,
    })
    const queryResult = res as { rows: RushEvent[]; total: number }
    results.value = [...results.value, ...queryResult.rows]
    total.value = queryResult.total
  } catch {
    // error captured in api.error
  } finally {
    loadingMore.value = false
  }
}

// ═══ Infinite scroll observer ═══
let scrollObserver: IntersectionObserver | null = null

function setupScrollObserver() {
  if (scrollObserver) scrollObserver.disconnect()
  scrollObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && hasMore.value && !loadingMore.value && !api.loading.value) {
          loadMore()
          break
        }
      }
    },
    { rootMargin: '200px' }
  )
  // Observe all sentinels currently in the DOM
  document.querySelectorAll('.scroll-sentinel').forEach(el => {
    scrollObserver!.observe(el)
  })
}

// Re-attach observer when view mode changes or results update
watch([() => viewMode.value, () => results.value.length], () => {
  nextTick(() => setupScrollObserver())
})

onUnmounted(() => {
  if (scrollObserver) scrollObserver.disconnect()
  stopLive()
})


function loadSavedQuery(query: SavedQuery) {
  // Restore filters into the search bar (text-mode filter syntax: field=value).
  searchInput.value = query.filters
    .map(f => `${f.field}${f.op}${f.value}`)
    .join(' ')
  groupByField.value = query.groupBy
  selectedPreset.value = query.timePreset
  search()
}

function loadHistoryEntry(entry: HistoryEntry<ExploreHistoryQuery>) {
  const q = entry.query
  // Restore filters into the search bar
  filters.value = q.filters
  searchInput.value = q.filters
    .map(f => `${f.field}${f.op}${f.value}`)
    .join(' ')
  if (q.search) {
    searchInput.value = searchInput.value ? `${searchInput.value} ${q.search}` : q.search
  }
  searchText.value = q.search || ''
  groupByField.value = q.groupBy || ''
  selectedPreset.value = q.timePreset
  if (q.viewMode && q.viewMode !== viewMode.value) {
    setViewMode(q.viewMode)
  }
  search({ skipHistory: true })
}

// ═══ Formatting helpers ═══

function formatDuration(ns: number): string {
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(0)}µs`
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`
  return `${(ns / 1_000_000_000).toFixed(2)}s`
}

function formatTimestamp(ts: number | string): string {
  try {
    const ms = typeof ts === 'number' ? ts / 1_000_000 : Number(ts) / 1_000_000
    const d = new Date(ms)
    if (isNaN(d.getTime())) return String(ts)
    const time = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return `${fmtDate(d)} ${time}`
  } catch { return String(ts) }
}

function spanTimestampTooltip(ts: number | string): string {
  try {
    const ms = typeof ts === 'number' ? ts / 1_000_000 : Number(ts) / 1_000_000
    const d = new Date(ms)
    if (isNaN(d.getTime())) return ''
    const localTime = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const utcTime = d.toISOString().slice(11, 19)
    return `Local: ${fmtDate(d)} ${localTime}\nUTC:   ${fmtDateUtc(d)} ${utcTime}`
  } catch { return '' }
}



function statusClass(status: string, code: number): string {
  if (status === 'ERROR' || code >= 500) return 'status-error'
  if (code >= 400) return 'status-warning'
  return 'status-ok'
}

function durationClass(ns: number): string {
  if (ns >= 1_000_000_000) return 'dur-slow'
  if (ns >= 500_000_000) return 'dur-warn'
  if (ns >= 100_000_000) return 'dur-med'
  return 'dur-fast'
}

// ═══ Attribute helpers ═══

function parseAttributes(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

const CONTEXT_KEYS = [
  'user.id', 'user.email', 'user.subscription.plan', 'user.subscription.trial',
  'user.activated', 'article.id', 'article.published', 'article.title',
  'article.word_count', 'gateway.route', 'email.status', 'email.provider',
  'email.error', 'queue.system', 'queue.name', 'db.system', 'db.operation',
  'db.table', 'db.rows_affected', 'cache.system', 'cache.operation',
  'cache.hit', 'deploy.version', 'deploy.commit',
  'feature_flags.new_editor', 'feature_flags.v2_api', 'slow_request',
  'downstream.articles.status', 'downstream.notifications.status',
]

const NOISE_KEYS = new Set([
  'http.method', 'http.route', 'http.target', 'http.url', 'http.scheme',
  'http.status_code', 'http.status_text', 'http.flavor', 'http.host',
  'http.user_agent', 'http.request_content_length_uncompressed',
  'http.request.method', 'http.request.method_original',
  'http.response.status_code', 'http.response.header.content-length',
  'net.host.ip', 'net.host.name', 'net.host.port',
  'net.peer.ip', 'net.peer.port', 'net.transport',
  'network.peer.address', 'network.peer.port',
  'server.address', 'server.port',
  'url.full', 'url.path', 'url.query', 'url.scheme',
  'user_agent.original', 'service.name', 'service.version', 'host.name',
])

function getContextAttrs(raw: string): { key: string; value: string }[] {
  const attrs = parseAttributes(raw)
  const out: { key: string; value: string }[] = []
  for (const key of CONTEXT_KEYS) {
    if (key in attrs && attrs[key] !== '' && attrs[key] !== undefined)
      out.push({ key, value: String(attrs[key]) })
  }
  return out
}

function getFilteredAttrs(raw: string): Record<string, unknown> {
  const attrs = parseAttributes(raw)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!NOISE_KEYS.has(k)) out[k] = v
  }
  return out
}


// ═══ Stats ═══

const stats = computed(() => {
  if (!results.value.length) return null
  const rows = results.value
  const errCount = rows.filter(r => r.status === 'ERROR' || r.http_status_code >= 500).length
  const durs = rows.map(r => r.duration_ns).sort((a, b) => a - b)
  const p50 = durs[Math.floor(durs.length * 0.5)] ?? 0
  const p99 = durs[Math.floor(durs.length * 0.99)] ?? 0
  const svcs = new Set(rows.map(r => r.service_name))
  return {
    total: total.value,
    errorRate: rows.length ? (errCount / rows.length * 100).toFixed(1) : '0.0',
    p50: formatDuration(p50),
    p99: formatDuration(p99),
    services: svcs.size,
  }
})

const logStats = computed(() => {
  if (!otelLogs.value.length) return null
  const logs = otelLogs.value
  const errCount = logs.filter(l =>
    l.SeverityText === 'ERROR' || l.SeverityText === 'FATAL' || l.SeverityText === 'CRITICAL'
  ).length
  const warnCount = logs.filter(l =>
    l.SeverityText === 'WARN' || l.SeverityText === 'WARNING'
  ).length
  const svcs = new Set(logs.map(l => l.ServiceName))
  return {
    total: logs.length,
    errors: errCount,
    warnings: warnCount,
    errorRate: logs.length ? (errCount / logs.length * 100).toFixed(1) : '0.0',
    services: svcs.size,
  }
})

// ═══ Duration bar ═══

const maxDuration = computed(() => Math.max(...results.value.map(r => r.duration_ns), 1))

const traceGroups = computed(() => {
  const roots = results.value.filter(row => !row.parent_span_id)
  const source = roots.length ? roots : results.value
  const grouped = new Map<string, RushEvent[]>()
  for (const row of source) {
    const key = `${row.service_name}\u0000${row.http_method}\u0000${row.http_path || '(unknown route)'}`
    const bucket = grouped.get(key) || []
    bucket.push(row); grouped.set(key, bucket)
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const [service, method, path] = key.split('\u0000')
    const durations = rows.map(r => r.duration_ns).sort((a, b) => a - b)
    const errors = rows.filter(r => r.status === 'ERROR' || r.http_status_code >= 500)
    const representative = errors[0] || [...rows].sort((a, b) => b.duration_ns - a.duration_ns)[0]!
    return {
      key, service: service!, method: method!, path: path!, count: rows.length,
      errorRate: rows.length ? errors.length / rows.length * 100 : 0,
      p95: durations[Math.min(durations.length - 1, Math.floor(durations.length * .95))] || 0,
      representative,
    }
  }).sort((a, b) => b.count - a.count)
})

function openTraceGroup(group: (typeof traceGroups.value)[number]) {
  const index = results.value.findIndex(row => row.span_id === group.representative.span_id)
  if (index >= 0) openDetailModal(index)
}

function durBarWidth(ns: number): string {
  return `${Math.max((ns / maxDuration.value) * 100, 2)}%`
}

function durBarColor(ns: number): string {
  if (ns >= 1_000_000_000) return 'var(--error)'
  if (ns >= 500_000_000) return '#e88a40'
  if (ns >= 100_000_000) return 'var(--warning)'
  return 'var(--ok)'
}

// ═══ Histogram ═══

// Fill in empty buckets so the histogram spans the full time range
const filledHistogram = computed(() => {
  if (!histogram.value.length) return []

  const intervalMinutes = selectedPreset.value <= 60 ? 1 : selectedPreset.value <= 360 ? 5 : 60
  const stepMs = intervalMinutes * 60 * 1000

  // Build lookup from existing buckets
  const lookup = new Map<string, CountBucket>()
  for (const b of histogram.value) {
    lookup.set(b.bucket, b)
  }

  // Align start time down to interval boundary (UTC)
  const fromMs = new Date(timeRange.value.from).getTime()
  const toMs = new Date(timeRange.value.to).getTime()
  const alignedFrom = Math.floor(fromMs / stepMs) * stepMs

  // Format a UTC ms timestamp to match ClickHouse toString() output
  function fmtBucket(ms: number): string {
    const d = new Date(ms)
    return d.getUTCFullYear()
      + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
      + '-' + String(d.getUTCDate()).padStart(2, '0')
      + ' ' + String(d.getUTCHours()).padStart(2, '0')
      + ':' + String(d.getUTCMinutes()).padStart(2, '0')
      + ':' + String(d.getUTCSeconds()).padStart(2, '0')
  }

  const filled: CountBucket[] = []
  let t = alignedFrom
  while (t <= toMs) {
    const key = fmtBucket(t)
    filled.push(lookup.get(key) ?? { bucket: key, count: 0, error_count: 0 })
    t += stepMs
  }
  return filled
})

const histogramMax = computed(() => Math.max(...filledHistogram.value.map((b) => b.count), 1))

// ═══ Latency over time ═══
const SCATTER_W = 1000
const SCATTER_H = 250
const SCATTER_PAD = { left: 64, right: 20, top: 18, bottom: 34 }
const scatterBrush = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
const scatterDragging = ref(false)
const scatterExpanded = ref(false)
const scatterMode = ref<'dots' | 'density'>('density')
const compareModeActive = ref(false)

type ScatterPoint = { row: RushEvent; x: number; y: number; error: boolean }
type ScatterSelection = {
  label: string
  rows: RushEvent[]
  startTime: string
  endTime: string
  minDurationNs?: number
  maxDurationNs?: number
  errorsOnly?: boolean
  queryWide?: boolean
}
const scatterPendingSelection = ref<ScatterSelection | null>(null)
const scatterHoverPoint = ref<ScatterPoint | null>(null)
const scatterHoverDensity = ref<{ x: number; y: number; count: number; errors: number; minNs: number; maxNs: number } | null>(null)

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0
}

const scatterSourceRows = computed(() => results.value.slice(0, 500))
const scatterStats = computed(() => {
  const durations = scatterSourceRows.value.map((row) => Math.max(1, row.duration_ns))
  return {
    count: durations.length,
    errors: scatterSourceRows.value.filter((row) => row.status === 'ERROR' || row.http_status_code >= 500).length,
    p50: percentile(durations, .5),
    p95: percentile(durations, .95),
    p99: percentile(durations, .99),
    min: durations.length ? Math.min(...durations) : 1,
    max: Math.max(...durations, 1),
  }
})

const scatterScale = computed(() => {
  const rows = scatterSourceRows.value
  const times = rows.map((row) => Number(row.timestamp) / 1_000_000)
  const minT = Math.min(...times, Date.now())
  const maxT = Math.max(...times, minT + 1)
  const rawMin = Math.max(1_000, scatterStats.value.min)
  const rawMax = Math.max(rawMin * 1.01, scatterStats.value.max)
  const minLog = Math.floor(Math.log10(rawMin))
  const maxLog = Math.ceil(Math.log10(rawMax))
  return { minT, maxT, minLog, maxLog: Math.max(minLog + 1, maxLog) }
})

function scatterX(timestamp: number): number {
  const t = Number(timestamp) / 1_000_000
  const s = scatterScale.value
  return SCATTER_PAD.left + ((t - s.minT) / Math.max(1, s.maxT - s.minT)) * (SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right)
}
function scatterY(durationNs: number): number {
  const s = scatterScale.value
  const frac = (Math.log10(Math.max(1, durationNs)) - s.minLog) / Math.max(1, s.maxLog - s.minLog)
  return SCATTER_PAD.top + (1 - frac) * (SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom)
}

const scatterPoints = computed<ScatterPoint[]>(() =>
  scatterSourceRows.value.map((row) => ({
    row,
    x: scatterX(row.timestamp),
    y: scatterY(row.duration_ns),
    error: row.status === 'ERROR' || row.http_status_code >= 500,
  }))
)

const scatterYTicks = computed(() => {
  const { minLog, maxLog } = scatterScale.value
  const span = maxLog - minLog
  const step = span > 6 ? Math.ceil(span / 6) : 1
  const ticks: { value: number; y: number; label: string }[] = []
  for (let exp = minLog; exp <= maxLog; exp += step) {
    const value = Math.pow(10, exp)
    ticks.push({ value, y: scatterY(value), label: formatDuration(value) })
  }
  return ticks
})

const scatterXTicks = computed(() => {
  const { minT, maxT } = scatterScale.value
  return Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4
    const value = minT + (maxT - minT) * frac
    return {
      x: SCATTER_PAD.left + frac * (SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right),
      label: new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }
  })
})

const scatterPercentiles = computed(() => [
  { label: 'P50', value: scatterStats.value.p50, y: scatterY(scatterStats.value.p50), cls: 'p50' },
  { label: 'P95', value: scatterStats.value.p95, y: scatterY(scatterStats.value.p95), cls: 'p95' },
  { label: 'P99', value: scatterStats.value.p99, y: scatterY(scatterStats.value.p99), cls: 'p99' },
])

const scatterSelectedIds = computed(() => new Set(scatterPendingSelection.value?.rows.map((row) => row.span_id) ?? []))

const scatterDensityBins = computed(() => {
  const bins = new Map<string, { x: number; y: number; count: number; errors: number; minNs: number; maxNs: number }>()
  const plotW = SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right
  const plotH = SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom
  for (const point of scatterPoints.value) {
    const bx = Math.max(0, Math.min(39, Math.floor(((point.x - SCATTER_PAD.left) / plotW) * 40)))
    const by = Math.max(0, Math.min(13, Math.floor(((point.y - SCATTER_PAD.top) / plotH) * 14)))
    const key = `${bx}:${by}`
    const current = bins.get(key)
    if (current) {
      current.count++
      if (point.error) current.errors++
      current.minNs = Math.min(current.minNs, point.row.duration_ns)
      current.maxNs = Math.max(current.maxNs, point.row.duration_ns)
    } else {
      bins.set(key, { x: point.x, y: point.y, count: 1, errors: point.error ? 1 : 0, minNs: point.row.duration_ns, maxNs: point.row.duration_ns })
    }
  }
  return [...bins.values()]
})

const scatterSelectionSummary = computed(() => {
  const selection = scatterPendingSelection.value
  if (!selection) return null
  const services = new Set(selection.rows.map((row) => row.service_name)).size
  const errors = selection.rows.filter((row) => row.status === 'ERROR' || row.http_status_code >= 500).length
  return {
    count: selection.rows.length,
    services,
    errors,
    time: `${new Date(selection.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}–${new Date(selection.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    duration: selection.minDurationNs !== undefined
      ? `${formatDuration(selection.minDurationNs)}${selection.maxDurationNs !== undefined ? `–${formatDuration(selection.maxDurationNs)}` : '+'}`
      : 'all durations',
  }
})

function scatterCoord(e: PointerEvent) {
  const el = e.currentTarget as SVGElement
  const rect = el.getBoundingClientRect()
  return { x: (e.clientX - rect.left) / rect.width * SCATTER_W, y: (e.clientY - rect.top) / rect.height * SCATTER_H }
}
function startScatterBrush(e: PointerEvent) {
  const p = scatterCoord(e); scatterDragging.value = true
  scatterBrush.value = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
}
function moveScatterBrush(e: PointerEvent) {
  if (!scatterDragging.value || !scatterBrush.value) return
  const p = scatterCoord(e); scatterBrush.value = { ...scatterBrush.value, x2: p.x, y2: p.y }
}
function finishScatterBrush() {
  if (!scatterBrush.value) return
  scatterDragging.value = false
  const b = scatterBrush.value
  const left = Math.min(b.x1, b.x2), right = Math.max(b.x1, b.x2)
  const top = Math.min(b.y1, b.y2), bottom = Math.max(b.y1, b.y2)
  const selected = scatterPoints.value.filter(p => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom)
  if (!selected.length) { clearScatterSelection(); return }
  const times = selected.map(p => Number(p.row.timestamp) / 1_000_000)
  const durations = selected.map(p => p.row.duration_ns)
  const from = new Date(Math.min(...times)).toISOString()
  const to = new Date(Math.max(...times) + 1).toISOString()
  scatterPendingSelection.value = {
    label: 'Selected spans',
    rows: selected.map((point) => point.row),
    startTime: from,
    endTime: to,
    minDurationNs: Math.min(...durations),
    maxDurationNs: Math.max(...durations),
    queryWide: true,
  }
}

function clearScatterSelection() {
  scatterBrush.value = null
  scatterPendingSelection.value = null
  scatterHoverPoint.value = null
  scatterHoverDensity.value = null
}

function toggleScatterExpanded() {
  scatterExpanded.value = !scatterExpanded.value
  if (!scatterExpanded.value) {
    scatterHoverPoint.value = null
    scatterHoverDensity.value = null
  }
}

function prepareScatterQuickAnalysis(kind: 'slow' | 'errors' | 'recent') {
  const rows = scatterSourceRows.value
  if (!rows.length) return
  if (kind === 'slow') {
    const threshold = percentile(rows.map((row) => row.duration_ns), .95)
    scatterPendingSelection.value = {
      label: 'Slowest 5%', rows: rows.filter((row) => row.duration_ns >= threshold),
      startTime: timeRange.value.from, endTime: timeRange.value.to, minDurationNs: threshold, queryWide: true,
    }
  } else if (kind === 'errors') {
    scatterPendingSelection.value = {
      label: 'All errors in this query', rows: rows.filter((row) => row.status === 'ERROR' || row.http_status_code >= 500),
      startTime: timeRange.value.from, endTime: timeRange.value.to, errorsOnly: true, queryWide: true,
    }
  } else {
    const fromMs = new Date(timeRange.value.from).getTime()
    const toMs = new Date(timeRange.value.to).getTime()
    const midpoint = fromMs + (toMs - fromMs) / 2
    scatterPendingSelection.value = {
      label: 'Recent half vs earlier half',
      rows: rows.filter((row) => Number(row.timestamp) / 1_000_000 >= midpoint),
      startTime: new Date(midpoint).toISOString(), endTime: timeRange.value.to, queryWide: true,
    }
  }
  scatterBrush.value = null
}

function analyzeScatterSelection() {
  const selection = scatterPendingSelection.value
  if (!selection) return
  compareModeActive.value = true
  bubbleUpSelection.value = {
    startIdx: 0, endIdx: 0, startTime: selection.startTime, endTime: selection.endTime,
    minDurationNs: selection.minDurationNs, maxDurationNs: selection.maxDurationNs,
    errorsOnly: selection.errorsOnly, excludeFromBaseline: true, label: selection.label,
  }
  void runBubbleUp()
}

function openCompareMode() {
  compareModeActive.value = true
  scatterExpanded.value = true
}

function runQuickCompare(kind: 'slow' | 'errors' | 'recent') {
  openCompareMode()
  prepareScatterQuickAnalysis(kind)
  analyzeScatterSelection()
}

function openScatterSpan(row: RushEvent) {
  const index = results.value.findIndex((candidate) => candidate.span_id === row.span_id)
  if (index >= 0) openDetailModal(index)
}

function scatterTooltipStyle(x: number, y: number) {
  return {
    left: `${(x / SCATTER_W) * 100}%`,
    top: `${(y / SCATTER_H) * 100}%`,
  }
}

function scatterPointLabel(point: ScatterPoint): string {
  const row = point.row
  const operation = `${row.service_name} ${row.http_method || ''} ${row.http_path || '(unknown operation)'}`.replace(/\s+/g, ' ').trim()
  return `${operation}, ${formatDuration(row.duration_ns)}, ${point.error ? 'error' : 'successful span'}`
}

// ═══ Logs match histogram: fetch + render + click-to-zoom ═══

// Fetch the adaptive match histogram in parallel with (and never blocking) the
// log rows. A late response from a superseded search is discarded via the seq.
async function fetchMatchHistogram(searchParam: string | undefined, logFilters: Filter[]) {
  const seq = ++matchHistoSeq
  matchHistoLoading.value = true
  try {
    const res = await api.getLogHistogram({
      time_range: timeRange.value,
      filters: logFilters,
      search: searchParam,
    })
    if (seq !== matchHistoSeq) return // superseded by a newer search
    matchHisto.value = res.buckets || []
    matchHistoInterval.value = res.interval_secs || 0
  } catch {
    if (seq !== matchHistoSeq) return
    matchHisto.value = []
    matchHistoInterval.value = 0
  } finally {
    if (seq === matchHistoSeq) matchHistoLoading.value = false
  }
}

const matchHistoMax = computed(() => Math.max(...matchHisto.value.map((b) => b.count), 1))
const matchHistoTotal = computed(() => matchHisto.value.reduce((s, b) => s + b.count, 0))

function fmtMatchHistoClock(unixSecs: number, withDate: boolean): string {
  const d = new Date(unixSecs * 1000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  const clock = matchHistoInterval.value < 60 ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`
  if (withDate) {
    const mon = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    return `${mon}/${day} ${clock}`
  }
  return clock
}

function fmtMatchHistoInterval(): string {
  const s = matchHistoInterval.value
  if (s <= 0) return ''
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// min/max time labels at the ends of the sparkline.
const matchHistoRange = computed(() => {
  if (!matchHisto.value.length) return { from: '', to: '' }
  const withDate = isMultiDayRange()
  const first = matchHisto.value[0]!.ts
  const last = matchHisto.value[matchHisto.value.length - 1]!.ts + matchHistoInterval.value
  return { from: fmtMatchHistoClock(first, withDate), to: fmtMatchHistoClock(last, withDate) }
})

// Per-bar tooltip text (bucket time + count) via the native title attr.
function matchBarTitle(b: { ts: number; count: number }): string {
  return `${fmtMatchHistoClock(b.ts, true)} · ${b.count.toLocaleString()} match${b.count === 1 ? '' : 'es'}`
}

// Clicking a bar zooms the active range to that bucket window and re-runs the
// search. Reuses the view's existing customRange + search() flow so the URL
// time params update exactly like a manual range change (shareable / back-button).
function onMatchBarClick(b: { ts: number; count: number }) {
  if (matchHistoInterval.value <= 0) return
  const fromMs = b.ts * 1000
  const toMs = (b.ts + matchHistoInterval.value) * 1000
  customRange.value = {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  }
  search()
}

const hoveredBucket = ref<number | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)

function onBarEnter(i: number, event: MouseEvent) {
  hoveredBucket.value = i
  updateTooltipPos(event)
}

function onBarMove(event: MouseEvent) {
  updateTooltipPos(event)
}

function onBarLeave() {
  hoveredBucket.value = null
}

function updateTooltipPos(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).closest('.histo-bars')?.getBoundingClientRect()
  if (!rect) return
  tooltipX.value = event.clientX - rect.left
  tooltipY.value = event.clientY - rect.top
}

function formatBucketTime(bucket: string, includeDate = false): string {
  // bucket is UTC from ClickHouse — convert to local time
  const d = new Date(parseBucketUtc(bucket))
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  if (includeDate) {
    const mon = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    return `${mon}/${day} ${hh}:${mm}`
  }
  return `${hh}:${mm}`
}

function isMultiDayRange(): boolean {
  if (customRange.value) {
    const diffMs = new Date(customRange.value.to).getTime() - new Date(customRange.value.from).getTime()
    return diffMs >= 24 * 60 * 60 * 1000
  }
  return selectedPreset.value >= 1440 // 1 day in minutes
}

const hoveredBucketData = computed(() => {
  if (hoveredBucket.value === null) return null
  const b = filledHistogram.value[hoveredBucket.value]
  if (!b) return null
  const okCount = b.count - (b.error_count || 0)
  const errRate = b.count > 0 ? ((b.error_count || 0) / b.count * 100).toFixed(1) : '0.0'
  return {
    time: formatBucketTime(b.bucket, isMultiDayRange()),
    total: b.count.toLocaleString(),
    ok: okCount.toLocaleString(),
    errors: (b.error_count || 0).toLocaleString(),
    errRate,
  }
})

// ═══ Histogram drag-to-select ═══
const dragActive = ref(false)
const dragStartIdx = ref(0)
const dragEndIdx = ref(0)

const dragRange = computed(() => {
  if (!dragActive.value) return { left: 0, right: 0, visible: false, fromLabel: '', toLabel: '' }
  const lo = Math.min(dragStartIdx.value, dragEndIdx.value)
  const hi = Math.max(dragStartIdx.value, dragEndIdx.value)
  const total = filledHistogram.value.length || 1

  const fromBucket = filledHistogram.value[lo]
  const toBucket = filledHistogram.value[hi]
  const showDate = isMultiDayRange()
  const fromLabel = fromBucket ? formatBucketTime(fromBucket.bucket, showDate) : ''
  const toLabel = toBucket ? formatBucketTime(toBucket.bucket, showDate) : ''

  return {
    left: (lo / total) * 100,
    right: 100 - ((hi + 1) / total) * 100,
    visible: true,
    fromLabel,
    toLabel,
  }
})

function getBarIndex(event: MouseEvent): number {
  const barsEl = (event.currentTarget as HTMLElement).closest('.histo-bars') as HTMLElement | null
  if (!barsEl) return 0
  const rect = barsEl.getBoundingClientRect()
  const x = event.clientX - rect.left
  const pct = x / rect.width
  return Math.max(0, Math.min(filledHistogram.value.length - 1, Math.floor(pct * filledHistogram.value.length)))
}

const histoBarsEl = ref<HTMLElement | null>(null)

function getBarIndexFromGlobal(event: MouseEvent): number {
  const el = histoBarsEl.value
  if (!el) return dragEndIdx.value
  const rect = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
  const pct = x / rect.width
  return Math.max(0, Math.min(filledHistogram.value.length - 1, Math.floor(pct * filledHistogram.value.length)))
}

function onGlobalDragMove(event: MouseEvent) {
  if (!dragActive.value) return
  dragEndIdx.value = getBarIndexFromGlobal(event)
}

const dragShiftHeld = ref(false)

function onHistoDragStart(event: MouseEvent) {
  const idx = getBarIndex(event)
  dragActive.value = true
  dragStartIdx.value = idx
  dragEndIdx.value = idx
  dragShiftHeld.value = event.shiftKey
  // Listen globally so drag works outside the histogram
  window.addEventListener('mousemove', onGlobalDragMove)
  window.addEventListener('mouseup', onGlobalDragEnd)
}

function onGlobalDragEnd() {
  window.removeEventListener('mousemove', onGlobalDragMove)
  window.removeEventListener('mouseup', onGlobalDragEnd)
  if (!dragActive.value) return
  dragActive.value = false
  const lo = Math.min(dragStartIdx.value, dragEndIdx.value)
  const hi = Math.max(dragStartIdx.value, dragEndIdx.value)
  if (lo === hi) return // single click, ignore

  // Shift+drag = BubbleUp selection, normal drag = zoom
  if (dragShiftHeld.value) {
    selectBubbleUpRange(lo, hi)
    runBubbleUp()
    return
  }

  const startBucket = filledHistogram.value[lo]
  const endBucket = filledHistogram.value[hi]
  if (!startBucket || !endBucket) return

  // Parse bucket timestamps (UTC format "2026-02-12 22:00:00")
  const fromDate = new Date(startBucket.bucket + 'Z')
  const toDate = new Date(endBucket.bucket + 'Z')
  // Add one interval to end bucket to cover its full range
  const intervalMs = filledHistogram.value.length > 1
    ? new Date(filledHistogram.value[1]!.bucket + 'Z').getTime() - new Date(filledHistogram.value[0]!.bucket + 'Z').getTime()
    : 60000
  toDate.setTime(toDate.getTime() + intervalMs)

  customRange.value = {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  }
  search()
}

// ═══ BubbleUp Analysis ═══
const bubbleUpSelection = ref<{
  startIdx: number
  endIdx: number
  startTime: string
  endTime: string
  minDurationNs?: number
  maxDurationNs?: number
  errorsOnly?: boolean
  excludeFromBaseline?: boolean
  label?: string
} | null>(null)
const bubbleUpResult = ref<BubbleUpResponse | null>(null)
const bubbleUpLoading = ref(false)
const bubbleUpError = ref<string | null>(null)

// Overlay computed: shows the amber selection highlight on the histogram while BubbleUp is active
const bubbleUpOverlay = computed(() => {
  if (!bubbleUpSelection.value) return { left: 0, right: 0, visible: false, fromLabel: '', toLabel: '' }
  const { startIdx, endIdx } = bubbleUpSelection.value
  const lo = Math.min(startIdx, endIdx)
  const hi = Math.max(startIdx, endIdx)
  const total = filledHistogram.value.length || 1
  const fromBucket = filledHistogram.value[lo]
  const toBucket = filledHistogram.value[hi]
  const showDate = isMultiDayRange()
  return {
    left: (lo / total) * 100,
    right: 100 - ((hi + 1) / total) * 100,
    visible: true,
    fromLabel: fromBucket ? formatBucketTime(fromBucket.bucket, showDate) : '',
    toLabel: toBucket ? formatBucketTime(toBucket.bucket, showDate) : '',
  }
})

function selectBubbleUpRange(lo: number, hi: number) {
  const startBucket = filledHistogram.value[lo]
  const endBucket = filledHistogram.value[hi]
  if (!startBucket || !endBucket) return

  const intervalMs = filledHistogram.value.length > 1
    ? new Date(filledHistogram.value[1]!.bucket + 'Z').getTime() - new Date(filledHistogram.value[0]!.bucket + 'Z').getTime()
    : 60000
  const fromDate = new Date(startBucket.bucket + 'Z')
  const toDate = new Date(endBucket.bucket + 'Z')
  toDate.setTime(toDate.getTime() + intervalMs)

  bubbleUpSelection.value = {
    startIdx: lo,
    endIdx: hi,
    startTime: fromDate.toISOString(),
    endTime: toDate.toISOString(),
    excludeFromBaseline: true,
    label: 'Selected time window',
  }
}

async function runBubbleUp() {
  if (!bubbleUpSelection.value) return
  compareModeActive.value = true
  bubbleUpLoading.value = true
  bubbleUpError.value = null
  bubbleUpResult.value = null

  const sel = bubbleUpSelection.value
  // Baseline is the full visible time range minus the selection
  const baseline = timeRange.value

  try {
    const result = await api.bubbleUp({
      selection: { from: sel.startTime, to: sel.endTime },
      baseline: { from: baseline.from, to: baseline.to },
      signal: viewMode.value === 'logs' ? 'logs' : 'spans',
      filters: getActiveFilters(),
      top_k: 10,
      selection_min_duration_ns: sel.minDurationNs,
      selection_max_duration_ns: sel.maxDurationNs,
      selection_errors_only: sel.errorsOnly,
      exclude_selection_from_baseline: sel.excludeFromBaseline,
    })
    if (result.selection_count === 0) {
      bubbleUpError.value = 'No spans matched this cohort. Drag a slightly larger area and analyze again.'
      return
    }
    bubbleUpResult.value = result
  } catch (e: any) {
    bubbleUpError.value = e.message || 'BubbleUp analysis failed'
  } finally {
    bubbleUpLoading.value = false
  }
}

function closeBubbleUp() {
  bubbleUpSelection.value = null
  bubbleUpResult.value = null
  bubbleUpLoading.value = false
  bubbleUpError.value = null
  scatterBrush.value = null
  scatterPendingSelection.value = null
  scatterHoverPoint.value = null
  scatterHoverDensity.value = null
}

function closeCompareMode() {
  compareModeActive.value = false
  closeBubbleUp()
}

const compareSelectionLabel = computed(() => bubbleUpSelection.value?.label || 'Selected cohort')

const compareFindings = computed(() => bubbleUpResult.value ? rankCompareFindings(bubbleUpResult.value) : [])

function filterToCompareFinding(dimension: string, value: string) {
  addFilterFromBubbleUp(dimension, value)
}

// Map friendly dimension names back to ClickHouse column names for filtering
const dimensionToField: Record<string, string> = {
  'Service': 'service_name',
  'Operation': 'span_name',
  'Method': 'http_method',
  'Path': 'http_path',
  'Status Code': 'http_status_code',
  'Span Status': 'status',
  'Span Kind': 'kind',
  'Severity': 'severity_text',
  'Scope': 'ScopeName',
  'K8s Namespace': 'mat_k8s_namespace',
  'K8s Deployment': 'mat_k8s_deployment',
}

function addFilterFromBubbleUp(dimension: string, value: string) {
  const field = dimensionToField[dimension] || dimension
  addFilter(field, value)
  closeBubbleUp()
}

function formatBubbleUpTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

// ═══ Interaction ═══

// Log word-wrap toggle (persisted in localStorage)
const logWordWrap = ref(localStorage.getItem('rush-log-word-wrap') === 'true')
function toggleLogWordWrap() {
  logWordWrap.value = !logWordWrap.value
  localStorage.setItem('rush-log-word-wrap', String(logWordWrap.value))
}

// Inline preview (click row to expand metadata below it)
const inlineExpandedLog = ref<number | null>(null)
// Modal state (separate from inline)
const modalOpen = ref(false)
const modalSource = ref<'span' | 'log'>('span')
const modalRowIndex = ref<number | null>(null)
const modalLogIndex = ref<number | null>(null)

// Context Stream state
const contextStreamOpen = ref(false)
const contextStreamLoading = ref(false)
const contextStreamLogs = ref<LogRecord[]>([])
const contextStreamSourceLog = ref<LogEntry | null>(null)
const contextStreamFilters = ref<{ field: string; label: string; value: string }[]>([])
const contextStreamSelectedAttrs = ref<Set<string>>(new Set())
const contextStreamExpandedIdx = ref<number | null>(null)
const contextStreamRadiusLabel = ref('±5 min')

function toggleRow(index: number) {
  // Spans go straight to full detail modal
  openDetailModal(index)
}

function openDetailModal(index: number) {
  expandedRow.value = index
  expandedTab.value = null
  expandedApm.value = null
  expandedTrace.value = null
  selectedSpanId.value = null
  timelineExpandedSpan.value = null
  modalOpen.value = true
  modalSource.value = 'span'
  modalRowIndex.value = index
  modalLogIndex.value = null
  const row = results.value[index]
  if (row) {
    loadApmData(row)
    if (row.trace_id) loadTraceData(row)
  }
  syncUrlState()
}

async function openLogDetailModal(logIdx: number) {
  let entry = logEntries.value[logIdx]
  if (!entry) return
  await hydrateOtelLog(entry)
  entry = logEntries.value[logIdx] || entry
  modalOpen.value = true
  modalSource.value = 'log'
  modalLogIndex.value = logIdx
  modalRowIndex.value = entry._sourceRowIndex >= 0 ? entry._sourceRowIndex : null
  expandedRow.value = entry._sourceRowIndex >= 0 ? entry._sourceRowIndex : null
  expandedTab.value = null
  expandedApm.value = null
  expandedTrace.value = null
  selectedSpanId.value = null
  expandedLogRow.value = logIdx
  // Load trace/APM only if linked to a span
  if (entry._sourceRowIndex >= 0) {
    const row = results.value[entry._sourceRowIndex]
    if (row) {
      loadApmData(row)
      if (row.trace_id) loadTraceData(row)
    }
  } else if (entry.trace_id) {
    // Standalone log with trace_id — try loading trace
    expandedTraceLoading.value = true
    api.getTrace(entry.trace_id).then(t => {
      expandedTrace.value = t
    }).catch(() => {
      expandedTrace.value = null
    }).finally(() => {
      expandedTraceLoading.value = false
    })
  }
}

// The active modal data for log-only entries
const modalLogEntry = computed(() => {
  if (modalLogIndex.value === null) return null
  return logEntries.value[modalLogIndex.value] || null
})

// @ts-ignore reserved for template use
const modalK8sMeta = computed(() => {
  if (modalSource.value === 'log' && !expandedRowData.value && modalLogEntry.value) {
    return getLogK8sMeta(modalLogEntry.value)
  }
  if (expandedRowData.value) {
    const attrsJson = activeSpanNode.value
      ? JSON.stringify(activeSpanNode.value.attributes || {})
      : expandedRowData.value.attributes
    return getSpanK8sMeta(attrsJson)
  }
  return []
})

function closeDetailPanel() {
  expandedRow.value = null
  expandedApm.value = null
  expandedTrace.value = null
  selectedSpanId.value = null
  expandedLogRow.value = null
  timelineExpandedSpan.value = null
  modalOpen.value = false
  modalSource.value = 'span'
  modalRowIndex.value = null
  modalLogIndex.value = null
  syncUrlState()
}


function investigateLogEntry(entry: LogEntry) {
  const ts = new Date(entry.timestamp / 1_000_000).toISOString()
  const ctx = [
    `Log entry from ${entry.service_name} at ${ts}`,
    `Severity: ${entry.level}`,
    `Message: ${entry.message.slice(0, 500)}`,
    entry.trace_id ? `Trace ID: ${entry.trace_id}` : '',
    entry.span_id ? `Span ID: ${entry.span_id}` : '',
  ].filter(Boolean).join('\n')

  router.push({
    path: '/investigate',
    query: {
      q: `Investigate this ${entry.level} log from ${entry.service_name}: "${entry.message.slice(0, 100)}"`,
      ctx,
    },
  })
}

function isJsonStr(s: string): boolean {
  const t = s.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function prettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

// Transient "copied" feedback: a global toast (for any copy action) plus an
// optional per-button key so the clicked button can show its own ✓ Copied state.
const copyToast = ref(false)
const copiedKey = ref<string | null>(null)
let copyToastTimer: ReturnType<typeof setTimeout> | null = null
let copiedKeyTimer: ReturnType<typeof setTimeout> | null = null

function copyText(text: string, key?: string) {
  const ok = () => {
    copyToast.value = true
    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToastTimer = setTimeout(() => { copyToast.value = false }, 1600)
    if (key) {
      copiedKey.value = key
      if (copiedKeyTimer) clearTimeout(copiedKeyTimer)
      copiedKeyTimer = setTimeout(() => { copiedKey.value = null }, 1600)
    }
  }
  try {
    const p = navigator.clipboard?.writeText(text)
    if (p && typeof p.then === 'function') p.then(ok).catch(() => { /* clipboard blocked */ })
    else ok()
  } catch { /* clipboard unavailable */ }
}

// K8s metadata keys in priority order
const K8S_META_KEYS = [
  'k8s.namespace.name',
  'k8s.pod.name',
  'k8s.container.name',
  'k8s.node.name',
  'k8s.deployment.name',
  'k8s.replicaset.name',
  'k8s.statefulset.name',
  'k8s.daemonset.name',
  'k8s.job.name',
  'k8s.cronjob.name',
  'k8s.pod.uid',
  'k8s.cluster.name',
  'container.id',
  'container.image.name',
  'container.image.tag',
  'cloud.provider',
  'cloud.region',
  'cloud.availability_zone',
  'host.name',
  'host.id',
  'host.arch',
]

// Short display labels for k8s keys
const K8S_LABELS: Record<string, string> = {
  'k8s.namespace.name': 'namespace',
  'k8s.pod.name': 'pod',
  'k8s.container.name': 'container',
  'k8s.node.name': 'node',
  'k8s.deployment.name': 'deployment',
  'k8s.replicaset.name': 'replicaset',
  'k8s.statefulset.name': 'statefulset',
  'k8s.daemonset.name': 'daemonset',
  'k8s.job.name': 'job',
  'k8s.cronjob.name': 'cronjob',
  'k8s.pod.uid': 'pod uid',
  'k8s.cluster.name': 'cluster',
  'container.id': 'container id',
  'container.image.name': 'image',
  'container.image.tag': 'image tag',
  'cloud.provider': 'cloud',
  'cloud.region': 'region',
  'cloud.availability_zone': 'az',
  'host.name': 'host',
  'host.id': 'host id',
  'host.arch': 'arch',
}

function getLogK8sMeta(entry: LogEntry): { key: string; value: string }[] {
  const meta: { key: string; value: string }[] = []
  // Check resource_attrs first (canonical source), then event_attrs as fallback
  const sources = [entry.resource_attrs, entry.event_attrs]
  const seen = new Set<string>()
  for (const key of K8S_META_KEYS) {
    if (seen.has(key)) continue
    for (const src of sources) {
      const val = src?.[key]
      if (val !== undefined && val !== '' && val !== null) {
        meta.push({ key: K8S_LABELS[key] || key.split('.').pop() || key, value: String(val) })
        seen.add(key)
        break
      }
    }
  }
  return meta
}

function getSpanK8sMeta(attrsJson: string): { key: string; value: string }[] {
  const meta: { key: string; value: string }[] = []
  try {
    const parsed = JSON.parse(attrsJson || '{}')
    for (const key of K8S_META_KEYS) {
      const val = parsed[key]
      if (val !== undefined && val !== '' && val !== null) {
        meta.push({ key: K8S_LABELS[key] || key.split('.').pop() || key, value: String(val) })
      }
    }
  } catch {}
  return meta
}

// ═══ Keyboard navigation handler (vim/k9s style) ═══

function getVisibleRowCount(): number {
  if (viewMode.value === 'logs') return logEntries.value.length
  return results.value.length
}

function scrollSelectedRowIntoView() {
  nextTick(() => {
    const rows = document.querySelectorAll('.et-row')
    if (selectedRowIndex.value >= 0 && selectedRowIndex.value < rows.length) {
      rows[selectedRowIndex.value]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

function onExploreKeydown(e: KeyboardEvent) {
  // Guard: skip if input/textarea/select is focused
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // Still allow Escape from inputs
    if (e.key === 'Escape') {
      (document.activeElement as HTMLElement)?.blur()
      e.preventDefault()
    }
    return
  }

  // Guard: skip if a modal or command palette is open (except Escape and ?)
  const hasOverlay = document.querySelector('.delete-modal-overlay, .command-palette-overlay')
  if (hasOverlay && e.key !== 'Escape' && e.key !== '?') return

  // Shortcut overlay toggle
  if (e.key === '?') {
    e.preventDefault()
    showShortcuts.value = !showShortcuts.value
    return
  }

  // Escape — cascading close
  if (e.key === 'Escape') {
    e.preventDefault()
    if (showShortcuts.value) {
      showShortcuts.value = false
    } else if (contextStreamOpen.value) {
      closeContextStream()
    } else if (modalOpen.value) {
      closeDetailPanel()
    } else if (inlineExpandedLog.value !== null) {
      inlineExpandedLog.value = null
    } else if (selectedRowIndex.value >= 0) {
      selectedRowIndex.value = -1
    }
    return
  }

  // If shortcuts overlay is showing, only Escape and ? should work
  if (showShortcuts.value) return
  // If modal is open, only Escape should work
  if (modalOpen.value) return

  const rowCount = getVisibleRowCount()

  // j / ArrowDown — next row
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault()
    if (rowCount === 0) return
    if (selectedRowIndex.value < rowCount - 1) {
      selectedRowIndex.value++
    } else {
      selectedRowIndex.value = rowCount - 1
    }
    scrollSelectedRowIntoView()
    return
  }

  // k / ArrowUp — previous row
  if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (rowCount === 0) return
    if (selectedRowIndex.value > 0) {
      selectedRowIndex.value--
    } else {
      selectedRowIndex.value = 0
    }
    scrollSelectedRowIntoView()
    return
  }

  // Enter — expand/collapse selected row
  if (e.key === 'Enter') {
    if (selectedRowIndex.value < 0 || selectedRowIndex.value >= rowCount) return
    e.preventDefault()
    if (viewMode.value === 'logs') {
      toggleLogRow(selectedRowIndex.value)
    } else {
      toggleRow(selectedRowIndex.value)
    }
    return
  }

  // g — double-tap gg to jump to first row
  if (e.key === 'g') {
    const now = Date.now()
    if (now - lastGPress < 500) {
      e.preventDefault()
      selectedRowIndex.value = 0
      scrollSelectedRowIntoView()
      lastGPress = 0
    } else {
      lastGPress = now
    }
    return
  }

  // G (Shift+g) — jump to last row
  if (e.key === 'G') {
    e.preventDefault()
    if (rowCount > 0) {
      selectedRowIndex.value = rowCount - 1
      scrollSelectedRowIntoView()
    }
    return
  }

  // / — focus search input
  if (e.key === '/') {
    e.preventDefault()
    searchInputEl.value?.focus()
    return
  }

  // l — switch to Logs mode
  if (e.key === 'l') {
    e.preventDefault()
    if (viewMode.value !== 'logs') {
      setViewMode('logs')
      tracesOnly.value = false
      selectedRowIndex.value = -1
    }
    return
  }

  // a — switch to APM/spans mode (no-op when APM is disabled for the tenant)
  if (e.key === 'a') {
    e.preventDefault()
    if (apmEnabled.value && (viewMode.value !== 'spans' || tracesOnly.value)) {
      tracesOnly.value = false
      if (viewMode.value !== 'spans') setViewMode('spans')
      selectedRowIndex.value = -1
    }
    return
  }

  // t — switch to Traces-only mode (no-op when APM is disabled for the tenant)
  if (e.key === 't') {
    e.preventDefault()
    if (!apmEnabled.value) return
    if (viewMode.value !== 'spans') setViewMode('spans')
    tracesOnly.value = true
    selectedRowIndex.value = -1
    return
  }

  // r — refresh / re-run search
  if (e.key === 'r') {
    e.preventDefault()
    search({ skipHistory: true })
    return
  }

  // w — toggle word-wrap (logs mode)
  if (e.key === 'w') {
    e.preventDefault()
    toggleLogWordWrap()
    return
  }
}

onMounted(() => document.addEventListener('keydown', onExploreKeydown))
onUnmounted(() => document.removeEventListener('keydown', onExploreKeydown))

// ═══ Context Stream ═══

interface ContextAttr {
  id: string
  label: string
  value: string
  filterField: string
}

const CONTEXT_SKIP_PREFIXES = ['exception.', 'log.message', 'log.level']

function getContextStreamAttrs(entry: LogEntry): ContextAttr[] {
  const attrs: ContextAttr[] = []

  // service_name is always first
  if (entry.service_name) {
    attrs.push({
      id: 'service_name',
      label: 'service_name',
      value: entry.service_name,
      filterField: 'service_name',
    })
  }

  // Resource attributes
  for (const [key, val] of Object.entries(entry.resource_attrs)) {
    if (val === undefined || val === null || val === '') continue
    attrs.push({
      id: `resource.${key}`,
      label: key,
      value: String(val),
      filterField: `resource.${key}`,
    })
  }

  // Event/log attributes
  for (const [key, val] of Object.entries(entry.event_attrs)) {
    if (val === undefined || val === null || val === '') continue
    if (CONTEXT_SKIP_PREFIXES.some(p => key.startsWith(p))) continue
    attrs.push({
      id: `log.${key}`,
      label: key,
      value: typeof val === 'object' ? JSON.stringify(val) : String(val),
      filterField: `log.${key}`,
    })
  }

  return attrs
}

function toggleContextAttr(attrId: string) {
  const s = new Set(contextStreamSelectedAttrs.value)
  if (s.has(attrId)) s.delete(attrId)
  else s.add(attrId)
  contextStreamSelectedAttrs.value = s
}

async function openContextStream(entry: LogEntry) {
  const allAttrs = getContextStreamAttrs(entry)
  const selected = allAttrs.filter(a => contextStreamSelectedAttrs.value.has(a.id))
  if (!selected.length) return

  contextStreamSourceLog.value = entry
  contextStreamFilters.value = selected.map(a => ({ field: a.filterField, label: a.label, value: a.value }))
  contextStreamLoading.value = true
  contextStreamOpen.value = true
  contextStreamExpandedIdx.value = null

  const tsMs = entry.timestamp / 1_000_000
  const filters: Filter[] = selected.map(a => ({
    field: a.filterField,
    op: '=',
    value: a.value,
  }))

  // Logs come back newest-first, capped at 500. A wide window centered on the
  // source therefore returns only the newest half in a high-volume stream and
  // excludes the source (which sits at the center). Narrow the window until the
  // source is actually captured — or the whole window fits under the cap.
  const radiiMs = [5 * 60_000, 60_000, 15_000, 4_000]
  let rows: LogRecord[] = []
  try {
    for (const r of radiiMs) {
      const from = new Date(tsMs - r).toISOString()
      const to = new Date(tsMs + r).toISOString()
      const res = await api.queryLogs({ slim: true, time_range: { from, to }, filters, limit: 500 })
      rows = res.rows
      contextStreamRadiusLabel.value = r >= 60_000 ? `±${r / 60_000} min` : `±${r / 1000}s`
      // Whole window fetched (under the cap) → the source is in it; or the
      // source is already present even though we hit the cap. Either way, stop.
      if (rows.length < 500 || rows.some(isSourceLog)) break
    }
  } catch {
    rows = []
  }
  contextStreamLogs.value = rows
  contextStreamLoading.value = false
  nextTick(() => scrollToSourceLog())
}

function closeContextStream() {
  contextStreamOpen.value = false
  contextStreamLoading.value = false
  contextStreamLogs.value = []
  contextStreamSourceLog.value = null
  contextStreamFilters.value = []
  contextStreamSelectedAttrs.value = new Set()
  contextStreamExpandedIdx.value = null
}

async function toggleContextStreamRow(index: number) {
  if (contextStreamExpandedIdx.value === index) {
    contextStreamExpandedIdx.value = null
    return
  }
  contextStreamExpandedIdx.value = index
  const row = contextStreamLogs.value[index]
  if (!row || (row.ResourceAttributes !== undefined && row.LogAttributes !== undefined)) return
  try {
    const detail = await api.getLogDetail(row)
    const next = [...contextStreamLogs.value]
    next[index] = { ...row, ...detail }
    contextStreamLogs.value = next
  } catch {
    // The slim row remains useful if its full detail was concurrently retained away.
  }
}

function isSourceLog(record: LogRecord): boolean {
  const src = contextStreamSourceLog.value
  if (!src) return false
  // Nanosecond timestamps round when parsed as JS numbers, so compare with a
  // small tolerance rather than exact equality, alongside service + body.
  return record.ServiceName === src.service_name
    && record.Body === src.message
    && Math.abs(record.Timestamp - src.timestamp) < 2_000_000
}

function scrollToSourceLog() {
  // requestAnimationFrame ensures the browser has painted the new rows
  // after the v-if swap from loading→content before we try to scroll.
  requestAnimationFrame(() => {
    const el = document.querySelector('.ctx-stream-row.ctx-source')
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  })
}

function formatCtxTimestamp(ns: number): string {
  try {
    const ms = ns / 1_000_000
    const d = new Date(ms)
    if (isNaN(d.getTime())) return String(ns)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)
  } catch { return String(ns) }
}

async function loadApmData(row: RushEvent) {
  if (expandedApm.value) return
  expandedApmLoading.value = true
  try {
    const eventTime = new Date(Number(row.timestamp) / 1_000_000)
    expandedApmEventMs.value = eventTime.getTime()
    const from = new Date(eventTime.getTime() - 15 * 60 * 1000).toISOString()
    const to = new Date(eventTime.getTime() + 15 * 60 * 1000).toISOString()
    const res = await api.queryTimeseries({
      time_range: { from, to },
      filters: [{ field: 'service_name', op: '=', value: row.service_name }],
      interval: '1m',
    })
    expandedApm.value = (res.buckets || []) as TimeseriesBucket[]
  } catch {
    expandedApm.value = []
  } finally {
    expandedApmLoading.value = false
  }
}

async function loadApmFromSpanNode(span: import('../types').SpanNode) {
  if (expandedApm.value) return
  expandedApmLoading.value = true
  try {
    const us = parseTraceTimestamp(span.timestamp)
    const eventMs = us / 1000
    expandedApmEventMs.value = eventMs
    const from = new Date(eventMs - 15 * 60 * 1000).toISOString()
    const to = new Date(eventMs + 15 * 60 * 1000).toISOString()
    const res = await api.queryTimeseries({
      time_range: { from, to },
      filters: [{ field: 'service_name', op: '=', value: span.service_name }],
      interval: '1m',
    })
    expandedApm.value = (res.buckets || []) as TimeseriesBucket[]
  } catch {
    expandedApm.value = []
  } finally {
    expandedApmLoading.value = false
  }
}

async function loadTraceData(row: RushEvent) {
  if (expandedTrace.value) return
  expandedTraceLoading.value = true
  try {
    expandedTrace.value = await api.getTrace(row.trace_id)
  } catch {
    expandedTrace.value = null
  } finally {
    expandedTraceLoading.value = false
  }
}

function selectDetailTab(tab: 'metrics' | 'attributes' | 'k8s') {
  expandedTab.value = expandedTab.value === tab ? null : tab
}

function openServiceContext() {
  const service = activeSpanNode.value?.service_name || expandedRowData.value?.service_name || modalLogEntry.value?.service_name
  if (service) router.push(`/services/${encodeURIComponent(service)}`)
}

function openInvestigationContext() {
  const traceId = expandedRowData.value?.trace_id || modalLogEntry.value?.trace_id || expandedTrace.value?.trace_id
  router.push({ path: '/investigate', query: traceId ? { trace_id: traceId } : {} })
}

function selectTraceSpan(spanId: string) {
  timelineExpandedSpan.value = timelineExpandedSpan.value === spanId ? null : spanId
}

// @ts-ignore reserved for template use
function getSpanLogs(span: import('../types').SpanNode): TraceLo[] {
  const logs: TraceLo[] = []
  if (!span.events?.length) return logs
  for (const evt of span.events) {
    const attrs = evt.attributes || {}
    const message = (attrs['log.message'] as string) || (attrs['exception.message'] as string) || evt.name || ''
    const level = ((attrs['log.level'] as string) || (attrs['log.severity'] as string) || '').toLowerCase()
    logs.push({
      timestamp: evt.timestamp,
      service_name: span.service_name,
      span_id: span.span_id,
      span_name: span.http_method ? `${span.http_method} ${span.http_path}` : span.span_id.slice(0, 8),
      level,
      message,
      event_name: evt.name,
      attrs,
      isCurrentSpan: true,
    })
  }
  logs.sort((a, b) => parseTraceTimestamp(a.timestamp) - parseTraceTimestamp(b.timestamp))
  return logs
}

function getSpanAttrs(span: import('../types').SpanNode): Record<string, unknown> {
  const attrs = (span.attributes && typeof span.attributes === 'object') ? span.attributes as Record<string, unknown> : {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!NOISE_KEYS.has(k) && v !== '' && v !== undefined) out[k] = v
  }
  return out
}

// ── Mocked metrics data ──
interface MockMetric {
  timestamp: string
  cpu: number
  memoryMb: number
}

function generateMockTimeseries(seedStr: string, baseCpu: number, baseMemMb: number, eventMs: number): MockMetric[] {
  let seed = 0
  for (const c of seedStr) seed += c.charCodeAt(0)
  const metrics: MockMetric[] = []
  for (let i = 0; i < 30; i++) {
    const t = new Date(eventMs - 15 * 60 * 1000 + i * 60 * 1000)
    const noise = Math.sin(seed + i * 0.7) * 15 + Math.cos(seed * 0.3 + i * 1.2) * 8
    const cpu = Math.max(2, Math.min(95, baseCpu + noise + (i > 12 && i < 20 ? 15 : 0)))
    const memNoise = Math.sin(seed * 0.5 + i * 0.4) * 40 + Math.cos(seed + i) * 20
    const memoryMb = Math.max(64, Math.min(baseMemMb * 2, baseMemMb + memNoise + (i > 10 && i < 25 ? 30 : 0)))
    metrics.push({
      timestamp: t.toISOString(),
      cpu: Math.round(cpu * 10) / 10,
      memoryMb: Math.round(memoryMb),
    })
  }
  return metrics
}

function mockMetricsMarkerX(timestamps: string[]): number {
  if (timestamps.length < 2) return dpChartPad.left + dpInnerW / 2
  const firstMs = new Date(timestamps[0]!).getTime()
  const lastMs = new Date(timestamps[timestamps.length - 1]!).getTime()
  const rangeMs = lastMs - firstMs
  if (rangeMs <= 0) return dpChartPad.left + dpInnerW / 2
  const ratio = Math.max(0, Math.min(1, (expandedApmEventMs.value - firstMs) / rangeMs))
  return dpChartPad.left + ratio * dpInnerW
}

const mockedPodMetrics = computed((): MockMetric[] => {
  const row = expandedRowData.value
  if (!row) return []
  const eventMs = Number(row.timestamp) / 1_000_000
  return generateMockTimeseries(row.service_name + (row.host_name || ''), 35, 220, eventMs)
})

const mockedNodeMetrics = computed(() => {
  const row = expandedRowData.value
  const hostSeed = row ? (row.host_name || 'node-default') : 'node-default'
  let seed = 0
  for (const c of hostSeed.toString()) seed += c.charCodeAt(0)
  const eventMs = row ? Number(row.timestamp) / 1_000_000 : Date.now()
  return {
    cpuCores: 4 + (seed % 4) * 2,
    memoryTotalGb: 8 + (seed % 3) * 8,
    loadAvg: [
      Math.round((0.5 + Math.sin(seed) * 1.5) * 100) / 100,
      Math.round((0.4 + Math.cos(seed) * 1.2) * 100) / 100,
      Math.round((0.3 + Math.sin(seed * 2) * 0.8) * 100) / 100,
    ],
    uptimeDays: 10 + (seed % 90),
    timeseries: generateMockTimeseries(hostSeed.toString() + '-node', 25, 3500, eventMs),
  }
})

// ── Service color palette (matches TraceView) ──
const dpServiceColors = [
  '#3b82f6', '#47b881', '#5b8dd9', '#9b7dd4',
  '#e5584f', '#06b6d4', '#84cc16', '#f97316',
]
function dpServiceColor(name: string): string {
  const services = expandedTrace.value?.services
  if (!services) return dpServiceColors[0]!
  const idx = services.indexOf(name)
  return dpServiceColors[(idx >= 0 ? idx : 0) % dpServiceColors.length]!
}

// Parse "YYYY-MM-DD HH:MM:SS.nnnnnnnnn" from trace timestamps into ms
function parseTraceTimestamp(ts: string): number {
  // Returns microseconds since epoch for sub-ms precision (safe in JS Number up to ~285 years from epoch)
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})\.?(\d*)/)
  if (!m) return 0
  const epochMs = new Date(`${m[1]}T${m[2]}Z`).getTime()
  const frac = (m[3] || '0').padEnd(6, '0').slice(0, 6) // microseconds
  return epochMs * 1000 + parseInt(frac, 10)
}

function flattenSpans(spans: SpanNode[]): SpanNode[] {
  const flat: SpanNode[] = []
  function walk(nodes: SpanNode[]) {
    for (const n of nodes) {
      flat.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(spans)
  return flat.sort((a, b) => parseTraceTimestamp(a.timestamp) - parseTraceTimestamp(b.timestamp))
}

function spanDepth(span: SpanNode, allSpans: SpanNode[]): number {
  let depth = 0
  let current = span
  for (let i = 0; i < 20; i++) {
    if (!current.parent_span_id) break
    const parent = allSpans.find(s => s.span_id === current.parent_span_id)
    if (!parent) break
    depth++
    current = parent
  }
  return depth
}

function traceBarOffset(span: SpanNode, allSpans: SpanNode[], traceDurNs: number): string {
  if (allSpans.length === 0 || traceDurNs <= 0) return '0%'
  const firstUs = parseTraceTimestamp(allSpans[0]!.timestamp)
  const spanUs = parseTraceTimestamp(span.timestamp)
  const diffNs = (spanUs - firstUs) * 1000 // μs → ns
  const pct = Math.max((diffNs / traceDurNs) * 100, 0)
  return `${Math.min(pct, 95)}%`
}

// ═══ APM chart helpers (mirrors ApmView patterns) ═══
/** Parse a ClickHouse timestamp string (no tz suffix) as UTC */
function parseBucketUtc(bucket: string): number {
  // ClickHouse returns "YYYY-MM-DD HH:MM:SS..." with no timezone → treat as UTC
  const iso = bucket.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z'
  return new Date(iso).getTime()
}

const dpChartW = 480
const dpChartH = 100
const dpChartPad = { top: 6, right: 6, bottom: 18, left: 40 }
const dpInnerW = dpChartW - dpChartPad.left - dpChartPad.right
const dpInnerH = dpChartH - dpChartPad.top - dpChartPad.bottom

function dpAreaPath(values: number[]): string {
  if (!values.length) return ''
  const maxVal = Math.max(...values, 1)
  const stepX = dpInnerW / Math.max(values.length - 1, 1)
  let d = `M${dpChartPad.left},${dpChartPad.top + dpInnerH}`
  for (let i = 0; i < values.length; i++) {
    const x = dpChartPad.left + i * stepX
    const y = dpChartPad.top + dpInnerH - ((values[i] ?? 0) / maxVal) * dpInnerH
    d += ` L${x},${y}`
  }
  d += ` L${dpChartPad.left + (values.length - 1) * stepX},${dpChartPad.top + dpInnerH} Z`
  return d
}

function dpLinePath(values: number[]): string {
  if (!values.length) return ''
  const maxVal = Math.max(...values, 1)
  const stepX = dpInnerW / Math.max(values.length - 1, 1)
  let d = ''
  for (let i = 0; i < values.length; i++) {
    const x = dpChartPad.left + i * stepX
    const y = dpChartPad.top + dpInnerH - ((values[i] ?? 0) / maxVal) * dpInnerH
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`
  }
  return d
}

function dpYTicks(values: number[]): Array<{ label: string; y: number }> {
  const maxVal = Math.max(...values, 1)
  return [0, 0.5, 1].map(s => ({
    label: dpFormatCompact(maxVal * s),
    y: dpChartPad.top + dpInnerH - s * dpInnerH,
  }))
}

function dpXLabels(buckets: TimeseriesBucket[]): Array<{ label: string; x: number }> {
  if (buckets.length < 2) return []
  const stepX = dpInnerW / Math.max(buckets.length - 1, 1)
  const skip = Math.max(1, Math.floor(buckets.length / 5))
  const labels: Array<{ label: string; x: number }> = []
  for (let i = 0; i < buckets.length; i += skip) {
    const d = new Date(parseBucketUtc(buckets[i]!.bucket))
    labels.push({
      label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      x: dpChartPad.left + i * stepX,
    })
  }
  return labels
}

function dpEventMarkerX(buckets: TimeseriesBucket[]): number {
  if (buckets.length < 2) return dpChartPad.left + dpInnerW / 2
  const firstMs = parseBucketUtc(buckets[0]!.bucket)
  const lastMs = parseBucketUtc(buckets[buckets.length - 1]!.bucket)
  const rangeMs = lastMs - firstMs
  if (rangeMs <= 0) return dpChartPad.left + dpInnerW / 2
  const eventMs = expandedApmEventMs.value
  const ratio = Math.max(0, Math.min(1, (eventMs - firstMs) / rangeMs))
  return dpChartPad.left + ratio * dpInnerW
}

function dpFormatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(0)
  if (n > 0) return n.toFixed(2)
  return '0'
}

function dpFormatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(1)}ms`
}

// ── Chart hover tooltip state ──
const chartHover = ref<{ bucketIdx: number; chartType: string } | null>(null)

function dpHoverBucketX(idx: number, total: number): number {
  const stepX = dpInnerW / Math.max(total - 1, 1)
  return dpChartPad.left + idx * stepX
}

function dpChartMouseMove(e: MouseEvent, chartType: string) {
  const svg = (e.currentTarget as SVGSVGElement)
  const rect = svg.getBoundingClientRect()
  const buckets = expandedApm.value
  if (!buckets?.length) return
  const mouseX = ((e.clientX - rect.left) / rect.width) * dpChartW
  const stepX = dpInnerW / Math.max(buckets.length - 1, 1)
  const relX = mouseX - dpChartPad.left
  const idx = Math.round(relX / stepX)
  if (idx >= 0 && idx < buckets.length) {
    chartHover.value = { bucketIdx: idx, chartType }
  }
}

function dpChartMouseLeave() {
  chartHover.value = null
}

function dpHoverTime(idx: number): string {
  const buckets = expandedApm.value
  if (!buckets?.[idx]) return ''
  const d = new Date(parseBucketUtc(buckets[idx].bucket))
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function dpHoverDate(idx: number): string {
  const buckets = expandedApm.value
  if (!buckets?.[idx]) return ''
  const d = new Date(parseBucketUtc(buckets[idx].bucket))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const apmSummary = computed(() => {
  const b = expandedApm.value
  if (!b || !b.length) return null
  const total = b.reduce((s, x) => s + x.count, 0)
  const errors = b.reduce((s, x) => s + x.error_count, 0)
  const avgDur = b.reduce((s, x) => s + x.avg_duration_ms * x.count, 0) / (total || 1)
  const p50 = b.reduce((s, x) => s + x.p50_ms * x.count, 0) / (total || 1)
  return {
    total,
    errors,
    errorRate: total ? (errors / total) * 100 : 0,
    avgDur,
    p50,
    p95: Math.max(...b.map(x => x.p95_ms)),
    p99: Math.max(...b.map(x => x.p99_ms)),
    rateValues: b.map(x => x.count),
    errorValues: b.map(x => x.error_count),
    p50Values: b.map(x => x.p50_ms),
    p95Values: b.map(x => x.p95_ms),
    p99Values: b.map(x => x.p99_ms),
  }
})

interface TraceLo {
  timestamp: string
  service_name: string
  span_id: string
  span_name: string
  level: string
  message: string
  event_name: string
  attrs: Record<string, unknown>
  isCurrentSpan: boolean
}

const traceLogs = computed((): TraceLo[] => {
  const row = expandedRowData.value
  const allSpans = expandedTraceSpans.value
  if (!row && allSpans.length === 0) return []
  const logs: TraceLo[] = []
  const seenKeys = new Set<string>()

  // 1) Extract from trace API spans (SpanNode.events)
  for (const span of allSpans) {
    if (!span.events?.length) continue
    for (const evt of span.events) {
      const attrs = evt.attributes || {}
      const message = (attrs['log.message'] as string) || (attrs['exception.message'] as string) || evt.name || ''
      const level = ((attrs['log.level'] as string) || (attrs['log.severity'] as string) || '').toLowerCase()
      const key = `${span.span_id}:${evt.timestamp}:${evt.name}`
      seenKeys.add(key)
      logs.push({
        timestamp: evt.timestamp,
        service_name: span.service_name,
        span_id: span.span_id,
        span_name: span.http_method ? `${span.http_method} ${span.http_path}` : span.span_id.slice(0, 8),
        level,
        message,
        event_name: evt.name,
        attrs,
        isCurrentSpan: span.span_id === activeSpanId.value,
      })
    }
  }

  // 2) Also extract from the original RushEvent inline events (event_names/event_attributes/event_timestamps)
  //    These may contain logs not present in the trace API response
  if (row && row.event_names?.length) {
    for (let i = 0; i < row.event_names.length; i++) {
      const evtAttrsRaw = row.event_attributes?.[i]
      let evtAttrs: Record<string, unknown> = {}
      if (evtAttrsRaw) {
        try { evtAttrs = JSON.parse(evtAttrsRaw) } catch {}
      }
      const message = (evtAttrs['log.message'] as string) || (evtAttrs['exception.message'] as string) || row.event_names[i] || ''
      const level = ((evtAttrs['log.level'] as string) || (evtAttrs['log.severity'] as string) || '').toLowerCase()
      // Derive timestamp: event_timestamps are in nanoseconds
      const tsNs = row.event_timestamps?.[i]
      let tsStr = ''
      if (tsNs) {
        const d = new Date(Number(tsNs) / 1_000_000)
        tsStr = d.toISOString().replace('T', ' ').replace('Z', '').replace(/(\.\d{3})\d*$/, '$1') + '000000'
      }
      // Deduplicate against trace API events
      const key = `${row.span_id}:${tsStr}:${row.event_names[i]}`
      if (seenKeys.has(key)) continue
      logs.push({
        timestamp: tsStr || new Date(Number(row.timestamp) / 1_000_000).toISOString().replace('T', ' '),
        service_name: row.service_name,
        span_id: row.span_id,
        span_name: row.http_method ? `${row.http_method} ${row.http_path}` : row.span_id.slice(0, 8),
        level,
        message,
        event_name: row.event_names[i] ?? '',
        attrs: evtAttrs,
        isCurrentSpan: row.span_id === activeSpanId.value,
      })
    }
  }

  logs.sort((a, b) => parseTraceTimestamp(a.timestamp) - parseTraceTimestamp(b.timestamp))
  return logs
})

function formatLogTs(ts: string): string {
  try {
    const us = parseTraceTimestamp(ts)
    if (isNaN(us)) return ts
    const d = new Date(us / 1000) // μs → ms
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any)
  } catch { return ts }
}

function addFilter(field: string, value: string | number) {
  if (showQueryBuilder.value) {
    builderFilters.value = [
      ...builderFilters.value,
      { id: crypto.randomUUID(), field, op: '=', value: String(value) },
    ]
  } else {
    searchInput.value += ` ${field}=${value}`
  }
  search()
}

function addExcludeFilter(field: string, value: string | number) {
  if (showQueryBuilder.value) {
    builderFilters.value = [
      ...builderFilters.value,
      { id: crypto.randomUUID(), field, op: '!=', value: String(value) },
    ]
  } else {
    searchInput.value += ` ${field}!=${value}`
  }
  search()
}

// Adapt the active (text-parsed) filters into QueryFilter shape for SavedQueries.
const savedQueryFilters = computed<QueryFilter[]>(() =>
  filters.value.map((f, i) => ({
    id: `f-${i}`,
    field: f.field,
    op: f.op,
    value: String(f.value),
  }))
)

// ═══ Active filter chips ═══
const activeFilterChips = computed(() => {
  if (showQueryBuilder.value) {
    return builderFilters.value
      .filter(f => f.field && f.value)
      .map(f => ({
        id: f.id,
        label: `${f.field} ${f.op} ${f.value}`,
        field: f.field,
        op: f.op,
        value: f.value,
      }))
  }
  return filters.value.map((f, i) => ({
    id: `filter-${i}`,
    label: `${f.field} ${f.op} ${f.value}`,
    field: f.field,
    op: f.op,
    value: String(f.value),
  }))
})

function removeFilterChip(chip: { field: string; op: string; value: string; id: string }) {
  if (showQueryBuilder.value) {
    builderFilters.value = builderFilters.value.filter(f => f.id !== chip.id)
  } else {
    const expr = `${chip.field}${chip.op}${chip.value}`
    searchInput.value = searchInput.value
      .replace(expr, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  search()
}

// ═══ Context Menu ═══
const ctxMenu = ref<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

function openContextMenu(
  e: MouseEvent,
  field: string,
  value: string | number,
  opts?: { traceId?: string; source?: 'span' | 'log' }
) {
  e.preventDefault()
  e.stopPropagation()

  const items: ContextMenuEntry[] = [
    {
      label: `Filter to this value`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
      action: () => addFilter(field, value),
    },
    {
      label: `Exclude this value`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
      action: () => addExcludeFilter(field, value),
    },
    {
      label: `Copy value`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      action: () => navigator.clipboard.writeText(String(value)),
    },
    { separator: true },
  ]

  if (opts?.source === 'span') {
    items.push({
      label: 'Show in Logs',
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      action: () => {
        if (field === 'service_name') addFilter('service_name', value)
        setViewMode('logs')
      },
    })
  }
  if (opts?.source === 'log') {
    items.push({
      label: 'Show in APM',
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
      action: () => {
        if (field === 'service_name') addFilter('service_name', value)
        setViewMode('spans')
      },
    })
  }
  if (opts?.traceId) {
    items.push({
      label: 'View Trace',
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      action: () => router.push(`/trace/${opts.traceId}`),
    })
  }

  ctxMenu.value = { x: e.clientX, y: e.clientY, items }
}

function closeContextMenu() {
  ctxMenu.value = null
}

// ═══ Inline Trace Preview ═══
const inlineTraceRow = ref<number | null>(null)
const inlineTraceData = ref<TraceResponse | null>(null)
const inlineTraceLoading = ref(false)

async function toggleInlineTrace(rowIndex: number, traceId: string) {
  if (inlineTraceRow.value === rowIndex) {
    inlineTraceRow.value = null
    inlineTraceData.value = null
    return
  }
  inlineTraceRow.value = rowIndex
  inlineTraceData.value = null
  inlineTraceLoading.value = true
  try {
    inlineTraceData.value = await api.getTrace(traceId)
  } catch {
    inlineTraceData.value = null
  } finally {
    inlineTraceLoading.value = false
  }
}

async function toggleInlineTraceForLog(logIndex: number, traceId: string) {
  const key = -(logIndex + 1)
  if (inlineTraceRow.value === key) {
    inlineTraceRow.value = null
    inlineTraceData.value = null
    return
  }
  inlineTraceRow.value = key
  inlineTraceData.value = null
  inlineTraceLoading.value = true
  try {
    inlineTraceData.value = await api.getTrace(traceId)
  } catch {
    inlineTraceData.value = null
  } finally {
    inlineTraceLoading.value = false
  }
}

function inlineSpanLeft(span: SpanNode, trace: TraceResponse): string {
  if (!trace.duration_ns || trace.duration_ns <= 0) return '0%'
  const allSpans = flattenSpans(trace.spans)
  const traceStartUs = allSpans.length
    ? Math.min(...allSpans.map(s => parseTraceTimestamp(s.timestamp)))
    : 0
  const spanStartUs = parseTraceTimestamp(span.timestamp)
  const offsetNs = (spanStartUs - traceStartUs) * 1000
  return Math.max(0, Math.min(100, (offsetNs / trace.duration_ns) * 100)) + '%'
}

function inlineSpanWidth(span: SpanNode, trace: TraceResponse): string {
  if (!trace.duration_ns || trace.duration_ns <= 0) return '1%'
  return Math.max(0.5, (span.duration_ns / trace.duration_ns) * 100) + '%'
}

// ═══ Autocomplete ═══

const KNOWN_FIELDS = [
  'service_name', 'service_version', 'environment', 'host_name',
  'http_method', 'http_path', 'http_status_code', 'status', 'duration_ns',
  'trace_id', 'span_id',
  'attributes.user.id', 'attributes.user.email', 'attributes.user.subscription.plan',
  'attributes.db.system', 'attributes.db.operation', 'attributes.db.table',
  'attributes.cache.system', 'attributes.cache.operation', 'attributes.cache.hit',
  'attributes.gateway.route', 'attributes.email.status', 'attributes.email.provider',
]

const OPERATORS = ['=', '!=', '>=', '<=', '>', '<']

const acItems = ref<{ label: string; insert: string; kind: 'field' | 'op' | 'value' }[]>([])
const acIndex = ref(0)
const acVisible = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)
let acDebounce: ReturnType<typeof setTimeout> | null = null

function getCurrentToken(): { token: string; start: number; end: number } {
  const el = searchInputEl.value
  if (!el) return { token: '', start: 0, end: 0 }
  const pos = el.selectionStart ?? searchInput.value.length
  const text = searchInput.value
  // Walk backward to find token start (stop at space)
  let start = pos
  while (start > 0 && text[start - 1] !== ' ') start--
  return { token: text.slice(start, pos), start, end: pos }
}

function onSearchInput() {
  if (acDebounce) clearTimeout(acDebounce)
  acDebounce = setTimeout(() => updateAutocomplete(), 120)
}

async function updateAutocomplete() {
  const { token } = getCurrentToken()
  if (!token) {
    acVisible.value = false
    return
  }

  // Check if token has an operator — means we're completing a value
  const opMatch = token.match(/^([^=!<>]+)(=|!=|>=|<=|>|<)(.*)$/)
  if (opMatch) {
    const field = opMatch[1]
    const prefix = opMatch[3] || ''
    // Fetch value suggestions from API
    try {
      const vals = await api.suggestValues(field!, prefix)
      if (!vals.length) { acVisible.value = false; return }
      acItems.value = vals.slice(0, 12).map(v => ({
        label: v,
        insert: `${field}${opMatch[2]}${v}`,
        kind: 'value' as const,
      }))
      acIndex.value = 0
      acVisible.value = true
    } catch {
      // Field not suggestable (e.g. duration_ns) — hide
      acVisible.value = false
    }
    return
  }

  // Check if token ends with a field name followed by nothing (suggest operators)
  const exactField = KNOWN_FIELDS.find(f => f === token)
  if (exactField) {
    acItems.value = OPERATORS.map(op => ({
      label: `${exactField}${op}`,
      insert: `${exactField}${op}`,
      kind: 'op' as const,
    }))
    acIndex.value = 0
    acVisible.value = true
    return
  }

  // Suggest matching field names
  const lower = token.toLowerCase()
  const matches = KNOWN_FIELDS.filter(f => f.toLowerCase().includes(lower))
  if (matches.length) {
    acItems.value = matches.slice(0, 12).map(f => ({
      label: f,
      insert: f,
      kind: 'field' as const,
    }))
    acIndex.value = 0
    acVisible.value = true
  } else {
    acVisible.value = false
  }
}

function acSelect(item: typeof acItems.value[0]) {
  const { start } = getCurrentToken()
  const before = searchInput.value.slice(0, start)
  const afterPos = searchInputEl.value?.selectionStart ?? searchInput.value.length
  const after = searchInput.value.slice(afterPos)
  const needsSpace = item.kind === 'value'
  searchInput.value = before + item.insert + (needsSpace ? ' ' : '') + after
  acVisible.value = false
  nextTick(() => {
    const newPos = before.length + item.insert.length + (needsSpace ? 1 : 0)
    searchInputEl.value?.setSelectionRange(newPos, newPos)
    searchInputEl.value?.focus()
  })
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!acVisible.value) {
    if (e.key === 'Enter') search()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    acIndex.value = Math.max(acIndex.value - 1, 0)
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    if (acItems.value[acIndex.value]) acSelect(acItems.value[acIndex.value]!)
  } else if (e.key === 'Escape') {
    acVisible.value = false
  }
}

function onSearchBlur() {
  // Delay so click on suggestion can fire first
  setTimeout(() => { acVisible.value = false }, 150)
}

// ═══ Natural language query mode ═══
function enterNlMode() {
  nlMode.value = true
  acVisible.value = false
  nextTick(() => nlInputEl.value?.focus())
}

function exitNlMode() {
  nlMode.value = false
  nlInput.value = ''
  nlChips.value = []
  nlSearch.value = ''
  nlConfidence.value = 0
}

function parseNaturalQuery(input: string): { chips: NlChip[]; search: string; confidence: number } {
  const text = input.toLowerCase().trim()
  if (!text) return { chips: [], search: '', confidence: 0 }

  const chips: NlChip[] = []
  let remaining = text
  let confidence = 0.3

  // Extract service name: "from X service", "for X", "X service" at start
  const STOPWORDS = new Set(['the', 'a', 'an', 'this', 'all', 'my', 'logs', 'log', 'errors', 'error',
    'warn', 'info', 'debug', 'that', 'which', 'with', 'have', 'show', 'me', 'i',
    'want', 'need', 'find', 'get', 'give', 'where', 'there', 'are', 'is', 'recent', 'latest'])
  const servicePatterns: RegExp[] = [
    /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]*)\s+service\b/,
    /^([a-z0-9][a-z0-9_-]+)\s+service\b/,
    /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]{2,})\b(?!\s*service)/,
  ]
  for (const pat of servicePatterns) {
    const m = remaining.match(pat)
    if (m?.[1] && !STOPWORDS.has(m[1])) {
      chips.push({ field: 'service_name', op: '=', value: m[1] })
      remaining = remaining.replace(pat, ' ')
      confidence += 0.3
      break
    }
  }

  // Extract log level
  if (/\berrors?\b/.test(remaining)) {
    chips.push({ field: 'level', op: '=', value: 'error' })
    remaining = remaining.replace(/\berrors?\b/g, ' ')
    confidence += 0.2
  } else if (/\bwarn(?:ing)?s?\b/.test(remaining)) {
    chips.push({ field: 'level', op: '=', value: 'warn' })
    remaining = remaining.replace(/\bwarn(?:ing)?s?\b/g, ' ')
    confidence += 0.2
  } else if (/\bdebugs?\b/.test(remaining)) {
    chips.push({ field: 'level', op: '=', value: 'debug' })
    remaining = remaining.replace(/\bdebugs?\b/g, ' ')
    confidence += 0.2
  }

  // Extract status codes
  if (/\b(?:5xx|server\s+error)\b/.test(remaining)) {
    chips.push({ field: 'status_code', op: '>=', value: 500 })
    remaining = remaining.replace(/\b(?:5xx|server\s+error)\b/g, ' ')
    confidence += 0.15
  } else if (/\b(?:4xx|client\s+error)\b/.test(remaining)) {
    chips.push({ field: 'status_code', op: '>=', value: 400 })
    remaining = remaining.replace(/\b(?:4xx|client\s+error)\b/g, ' ')
    confidence += 0.15
  } else {
    const sCode = remaining.match(/\b([1-5]\d{2})\b/)
    if (sCode?.[1]) {
      chips.push({ field: 'status_code', op: '=', value: parseInt(sCode[1]) })
      remaining = remaining.replace(sCode[0], ' ')
      confidence += 0.15
    }
  }

  // Extract environment
  const envMatch = remaining.match(/\b(production|prod|staging|stage|dev|development)\b/)
  if (envMatch?.[1]) {
    const raw = envMatch[1]
    const envVal = raw === 'prod' ? 'production' : (raw === 'stage' ? 'staging' : (raw === 'dev' ? 'development' : raw))
    chips.push({ field: 'environment', op: '=', value: envVal })
    remaining = remaining.replace(envMatch[0], ' ')
    confidence += 0.1
  }

  // Strip filler words and clean up remaining
  const fillerRe = /\b(?:i\s+want|show\s+me|give\s+me|find|look\s+for|search\s+for|that|which|have|having|with|containing|contain|the|a\b|an\b|in|on|at|of|and|or|where|there|are|is|from|for|logs?|events?|spans?|traces?)\b/g
  const searchText = remaining.replace(fillerRe, ' ').replace(/\s+/g, ' ').trim()

  return { chips, search: searchText, confidence: Math.min(confidence, 1.0) }
}

function onNlInput() {
  const { chips, search, confidence } = parseNaturalQuery(nlInput.value)
  nlChips.value = chips
  nlSearch.value = search
  nlConfidence.value = confidence
}

function onNlKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    exitNlMode()
  } else if (e.key === 'Enter') {
    if (nlChips.value.length || nlSearch.value) applyNlQuery()
  } else if (e.key === 'Tab' && (nlChips.value.length || nlSearch.value)) {
    e.preventDefault()
    applyNlQuery()
  }
}

function removeNlChip(chip: NlChip) {
  nlChips.value = nlChips.value.filter(c => c !== chip)
}

async function callLlmParse() {
  if (!nlInput.value.trim() || nlLoading.value) return
  nlLoading.value = true
  try {
    const res = await fetch('/api/v1/parse-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: nlInput.value }),
    })
    if (res.ok) {
      const data = await res.json()
      nlChips.value = (data.filters ?? []).map((f: { field: string; op: string; value: string | number }) => ({
        field: f.field, op: f.op, value: f.value,
      }))
      nlSearch.value = data.search ?? ''
      nlConfidence.value = data.confidence ?? 0.9
    }
  } catch {
    // Silently fall back to rule-based result already displayed
  } finally {
    nlLoading.value = false
  }
}

function applyNlQuery() {
  const parts = nlChips.value.map(c => {
    const v = typeof c.value === 'string' && c.value.includes(' ') ? `"${c.value}"` : String(c.value)
    return `${c.field}${c.op}${v}`
  })
  if (nlSearch.value) parts.push(nlSearch.value)
  searchInput.value = parts.join(' ')
  exitNlMode()
  nextTick(() => search())
}

// ═══ Share link ═══
const shareCopied = ref(false)
const pendingDeepLink = ref<{ trace: string; span: string } | null>(null)
// Deep-link to a specific log line: target timestamp (ns) parsed from the URL,
// and a transient highlight index applied after we scroll to it.
const pendingLogDeepLink = ref<number | null>(null)
const highlightLogIdx = ref<number | null>(null)

function buildQueryParams(): Record<string, string> {
  const p: Record<string, string> = {}
  if (searchInput.value) p.q = searchInput.value
  if (tracesOnly.value) p.mode = 'traces'
  else if (viewMode.value !== 'spans') p.mode = viewMode.value
  if (customRange.value) {
    p.from = customRange.value.from
    p.to = customRange.value.to
  } else if (selectedPreset.value !== 60) {
    p.t = String(selectedPreset.value)
  }
  if (quickService.value) p.service = quickService.value
  if (quickMethod.value) p.method = quickMethod.value
  if (quickStatusRange.value) p.status = quickStatusRange.value
  if (quickErrorOnly.value) p.errors = '1'
  if (quickDuration.value) p.dur = quickDuration.value
  if (groupByField.value) p.group = groupByField.value
  // Encode QueryBuilder filters as JSON when builder mode is active
  if (showQueryBuilder.value && builderFilters.value.length > 0) {
    const validFilters = builderFilters.value.filter(f => f.field && f.value)
    if (validFilters.length > 0) {
      p.filters = JSON.stringify(validFilters.map(f => ({
        field: f.field, op: f.op, value: f.value,
      })))
    }
  }
  // Deep-link to open span
  if (modalOpen.value && expandedRowData.value) {
    const row = expandedRowData.value
    if (row.trace_id) p.trace = row.trace_id
    if (row.span_id) p.span = row.span_id
  }
  // Deep-link to a specific log line (logs mode, inline-expanded row).
  // Encodes the log's timestamp (ns) so the link scrolls to and highlights it.
  if (viewMode.value === 'logs' && inlineExpandedLog.value !== null) {
    const e = logEntries.value[inlineExpandedLog.value]
    if (e) p.log = String(e.timestamp)
  }
  return p
}

function buildShareUrl(): string {
  const params = new URLSearchParams(buildQueryParams())
  const qs = params.toString()
  return `${window.location.origin}/${qs ? '?' + qs : ''}`
}

let skipNextUrlSync = false

function syncUrlState() {
  if (skipNextUrlSync) { skipNextUrlSync = false; return }
  const query = buildQueryParams()
  router.replace({ query })
}

async function shareLink() {
  const url = buildShareUrl()
  try {
    await navigator.clipboard.writeText(url)
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch {}
}

function restoreFromUrl() {
  const q = route.query
  if (!q || Object.keys(q).length === 0) return
  skipNextUrlSync = true
  if (q.q) searchInput.value = String(q.q)
  if (q.mode === 'logs') viewMode.value = 'logs'
  else if (q.mode === 'traces') { viewMode.value = 'spans'; tracesOnly.value = true }
  if (q.from && q.to) {
    customRange.value = { from: String(q.from), to: String(q.to) }
  } else if (q.t) {
    selectedPreset.value = Number(q.t) || 60
  }
  if (q.service) quickService.value = String(q.service)
  if (q.method) quickMethod.value = String(q.method)
  if (q.status) quickStatusRange.value = String(q.status)
  if (q.errors === '1') quickErrorOnly.value = true
  if (q.dur) quickDuration.value = String(q.dur)
  if (q.group) groupByField.value = String(q.group)
  // Back-compat: older shared links encoded filters as JSON — fold them into the
  // search bar's text filter syntax (field=value) since the builder box is gone.
  if (q.filters) {
    try {
      const parsed = JSON.parse(String(q.filters)) as { field: string; op: string; value: string }[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const expr = parsed.map(f => `${f.field}${f.op}${f.value}`).join(' ')
        searchInput.value = searchInput.value ? `${searchInput.value} ${expr}` : expr
      }
    } catch { /* ignore malformed */ }
  }
  // Deep-link: remember trace+span to open after search completes
  if (q.trace && q.span) {
    pendingDeepLink.value = { trace: String(q.trace), span: String(q.span) }
  }
  // Deep-link: remember target log timestamp (ns) to scroll to after logs load
  if (q.log) {
    const ts = Number(q.log)
    if (Number.isFinite(ts)) pendingLogDeepLink.value = ts
  }
}

// ── Export (current query + results) ──
const showExportDialog = ref(false)
const exportFormat = ref<'csv' | 'json'>('csv')
const exportRowCount = ref(1000)
const exportMaxRows = ref(1000)
const exporting = ref(false)
const exportError = ref<string | null>(null)

function currentQueryText(): string {
  const fs = getActiveFilters().map(f => `${f.field}${f.op}${f.value}`).join(' ')
  const s = searchText.value ? `${fs ? ' ' : ''}${searchText.value}` : ''
  return `${fs}${s}`.trim()
}

function openExport() {
  exportError.value = null
  const cap = exportMaxRows.value || 1000
  exportRowCount.value = Math.min(Math.max(total.value || cap, 1), cap)
  showExportDialog.value = true
}

async function doExport() {
  exportError.value = null
  exporting.value = true
  try {
    const isLogs = viewMode.value === 'logs'
    const all = getActiveFilters()
    const filters = isLogs ? all.filter(f => !SPAN_ONLY_FIELDS.includes(f.field)) : all
    const cap = exportMaxRows.value || 1000
    const limit = Math.max(1, Math.min(exportRowCount.value || cap, cap))
    const { blob, filename } = await api.exportExplore({
      signal: isLogs ? 'logs' : 'spans',
      time_range: timeRange.value,
      filters,
      limit,
      search: searchText.value || undefined,
      format: exportFormat.value,
      query_text: currentQueryText() || undefined,
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showExportDialog.value = false
  } catch (e: any) {
    exportError.value = e.message || 'Export failed'
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  restoreFromUrl()
  loadServices()
  api.getFeatures().then(f => { exportMaxRows.value = f.export_max_rows || 1000 }).catch(() => { /* keep default */ })
  await search()
  if (viewMode.value === 'logs') await fetchOtelLogs()

  // Deep-link: scroll to + highlight a specific log line once logs are loaded.
  if (pendingLogDeepLink.value !== null) {
    const target = pendingLogDeepLink.value
    pendingLogDeepLink.value = null
    await scrollToLogByTimestamp(target)
  }

  // BubbleUp deep-link: ?bubbleup=1&bu_from=<iso>&bu_to=<iso>
  if (route.query.bubbleup === '1') {
    const buFrom = route.query.bu_from as string | undefined
    const buTo   = route.query.bu_to   as string | undefined
    if (buFrom && buTo) {
      bubbleUpSelection.value = { startIdx: 0, endIdx: 0, startTime: buFrom, endTime: buTo, excludeFromBaseline: true }
      await runBubbleUp()
    }
  }

  // Deep-link: auto-open span modal if trace+span in URL
  if (pendingDeepLink.value) {
    const { trace, span } = pendingDeepLink.value
    pendingDeepLink.value = null
    // Try to find the span in current results
    const idx = results.value.findIndex(r => r.trace_id === trace && r.span_id === span)
    if (idx >= 0) {
      openDetailModal(idx)
    } else {
      // Span not in results — load trace directly and show modal
      modalOpen.value = true
      modalSource.value = 'span'
      expandedTraceLoading.value = true
      try {
        const traceData = await api.getTrace(trace)
        expandedTrace.value = traceData
        // Select the specific span in the trace
        selectedSpanId.value = span
        // Load APM data using the span from the trace
        const allSpans = flattenSpans(traceData.spans)
        const targetSpan = allSpans.find(s => s.span_id === span) || allSpans[0]
        if (targetSpan) {
          loadApmFromSpanNode(targetSpan)
        }
      } catch {
        expandedTrace.value = null
      } finally {
        expandedTraceLoading.value = false
      }
    }
  }
})
</script>

<template>
  <div class="explore">

    <!-- ═══ Copy-to-clipboard toast ═══ -->
    <Transition name="copy-toast">
      <div v-if="copyToast" class="copy-toast" role="status" aria-live="polite">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Copied to clipboard
      </div>
    </Transition>

    <!-- ═══ Context Menu ═══ -->
    <ContextMenu
      v-if="ctxMenu"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @close="closeContextMenu"
    />

    <!-- ═══ Slide-down Detail Panel (Modal) ═══ -->
    <Teleport to="body">
    <Transition name="slide-down">
      <div v-if="modalOpen" class="detail-overlay" @click.self="closeDetailPanel()">
      <div class="detail-panel" @click.stop>
        <div class="detail-panel-inner">
          <!-- Header: Log-only vs Span -->
          <div class="dp-header">
            <div class="dp-header-left" v-if="modalSource === 'log' && !expandedRowData && modalLogEntry">
              <span class="dp-svc">{{ modalLogEntry.service_name }}</span>
              <span class="log-level-badge" :class="logLevelClass(modalLogEntry.level)">{{ modalLogEntry.level || 'log' }}</span>
              <span class="dp-path mono">{{ modalLogEntry.message.slice(0, 80) }}{{ modalLogEntry.message.length > 80 ? '...' : '' }}</span>
            </div>
            <div class="dp-header-left" v-else-if="expandedRowData || activeSpanNode">
              <span class="dp-svc">{{ activeSpanNode?.service_name || expandedRowData?.service_name }}</span>
              <span class="method-badge" :class="activeSpanNode?.http_method || expandedRowData?.http_method">{{ activeSpanNode?.http_method || expandedRowData?.http_method }}</span>
              <span class="dp-path mono">{{ activeSpanNode?.http_path || expandedRowData?.http_path }}</span>
              <span class="mono" :class="statusClass(activeSpanNode?.status || expandedRowData?.status || '', activeSpanNode?.http_status_code ?? expandedRowData?.http_status_code ?? 0)">{{ (activeSpanNode?.http_status_code ?? expandedRowData?.http_status_code) || '\u2014' }}</span>
              <span class="mono" :class="durationClass(activeSpanNode?.duration_ns ?? expandedRowData?.duration_ns ?? 0)">{{ formatDuration(activeSpanNode?.duration_ns ?? expandedRowData?.duration_ns ?? 0) }}</span>
              <span v-if="selectedSpanId && expandedRowData && selectedSpanId !== expandedRowData.span_id" class="dp-back-link" @click.stop="selectedSpanId = null">&larr; back to original</span>
            </div>
            <div class="dp-header-right">
              <router-link v-if="expandedRowData?.trace_id || (activeSpanNode as any)?.trace_id || modalLogEntry?.trace_id" :to="`/trace/${expandedRowData?.trace_id || (activeSpanNode as any)?.trace_id || modalLogEntry?.trace_id}`" class="trace-link" @click.stop>Full trace &rarr;</router-link>
              <button class="dp-close" @click="closeDetailPanel()" title="Close (Esc)">&times;</button>
            </div>
          </div>

          <!-- Tab bar + full-width content area -->
          <div class="dp-tabs">
            <button class="dp-tab" :class="{ active: expandedTab === null }" @click.stop="expandedTab = null">Details</button>
            <button v-if="expandedRowData || activeSpanNode" class="dp-tab" :class="{ active: expandedTab === 'metrics' }" @click.stop="selectDetailTab('metrics')">Metrics</button>
            <button class="dp-tab" :class="{ active: expandedTab === 'attributes' }" @click.stop="selectDetailTab('attributes')">Attributes</button>
            <button class="dp-tab" :class="{ active: expandedTab === 'context' }" @click.stop="expandedTab = 'context'">Context</button>
          </div>

          <div class="dp-body">
            <!-- ═══ DEFAULT VIEW: Details (metadata, logs, APM) ═══ -->
            <template v-if="expandedTab === null">

              <!-- Log-only detail view (no linked span) -->
              <template v-if="modalSource === 'log' && !expandedRowData && modalLogEntry">
                <!-- Fields table -->
                <div class="dp-log-fields">
                  <div class="dp-log-field-row">
                    <span class="dp-log-field-k">service</span>
                    <span class="dp-log-field-v mono">{{ modalLogEntry.service_name }}</span>
                  </div>
                  <div class="dp-log-field-row">
                    <span class="dp-log-field-k">level</span>
                    <span class="dp-log-field-v"><span class="log-level-badge" :class="logLevelClass(modalLogEntry.level)">{{ modalLogEntry.level || 'log' }}</span></span>
                  </div>
                  <div class="dp-log-field-row">
                    <span class="dp-log-field-k">timestamp</span>
                    <span class="dp-log-field-v mono">{{ formatLogTimestamp(modalLogEntry.timestamp) }}</span>
                  </div>
                  <div v-if="modalLogEntry.trace_id" class="dp-log-field-row">
                    <span class="dp-log-field-k">trace_id</span>
                    <router-link :to="`/trace/${modalLogEntry.trace_id}`" class="dp-log-field-v mono dp-log-link" @click.stop>{{ modalLogEntry.trace_id }}</router-link>
                  </div>
                  <div v-if="modalLogEntry.span_id" class="dp-log-field-row">
                    <span class="dp-log-field-k">span_id</span>
                    <span class="dp-log-field-v mono">{{ modalLogEntry.span_id }}</span>
                  </div>
                  <div v-if="modalLogEntry.event_name" class="dp-log-field-row">
                    <span class="dp-log-field-k">event</span>
                    <span class="dp-log-field-v mono">{{ modalLogEntry.event_name }}</span>
                  </div>
                  <div class="dp-log-field-row">
                    <span class="dp-log-field-k">source</span>
                    <span class="dp-log-field-v mono">{{ modalLogEntry._source === 'otel' ? 'collected log' : 'span event' }}</span>
                  </div>
                </div>

                <!-- Log message body -->
                <div class="dp-log-body">
                  <div class="dp-log-body-header">
                    <span class="dp-log-section-label">Message</span>
                    <button class="dp-log-copy-btn" @click.stop="copyText(modalLogEntry.message)" title="Copy message">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                  <pre class="dp-log-message mono">{{ isJsonStr(modalLogEntry.message) ? prettyJson(modalLogEntry.message) : modalLogEntry.message }}</pre>
                </div>

                <!-- Resource attributes -->
                <div v-if="Object.keys(modalLogEntry.resource_attrs).length" class="dp-log-attr-section">
                  <div class="dp-log-section-label">Resource Attributes</div>
                  <div class="dp-log-attr-table">
                    <div v-for="(val, key) in modalLogEntry.resource_attrs" :key="String(key)" class="dp-log-field-row dp-log-field-clickable" @click.stop="addFilter(`resource.${String(key)}`, String(val))">
                      <span class="dp-log-field-k">{{ key }}</span>
                      <span class="dp-log-field-v mono">{{ val }}</span>
                      <span class="dp-log-field-action">&#xBB;</span>
                    </div>
                  </div>
                </div>

                <!-- Log attributes -->
                <div v-if="Object.keys(modalLogEntry.event_attrs).length" class="dp-log-attr-section">
                  <div class="dp-log-section-label">Log Attributes</div>
                  <div class="dp-log-attr-table">
                    <div v-for="(val, key) in modalLogEntry.event_attrs" :key="String(key)" class="dp-log-field-row dp-log-field-clickable" @click.stop="addFilter(`log.${String(key)}`, String(val))">
                      <span class="dp-log-field-k">{{ key }}</span>
                      <span class="dp-log-field-v mono">{{ val }}</span>
                      <span class="dp-log-field-action">&#xBB;</span>
                    </div>
                  </div>
                </div>
              </template>

              <!-- Span detail view (original behavior) -->
              <template v-else-if="expandedRowData || activeSpanNode">

              <!-- Trace Details (shown first) -->
              <template v-if="expandedTrace && expandedTrace.spans.length">
                <div class="dp-section-header">
                  <span class="dp-section-title">Trace Details</span>
                </div>
                <div class="dp-meta-row">
                  <span class="dp-meta-item"><span class="text-muted">trace</span> <span class="mono">{{ expandedTrace.trace_id.slice(0, 16) }}</span></span>
                  <span class="dp-meta-item">
                    <span class="text-muted">entry</span>
                    <span class="mono">{{ expandedTrace.spans[0]!.service_name }}</span>
                    <span v-if="expandedTrace.spans[0]!.http_method" class="method-badge" :class="expandedTrace.spans[0]!.http_method" style="margin-left: 4px;">{{ expandedTrace.spans[0]!.http_method }}</span>
                    <span class="mono" style="margin-left: 4px;">{{ expandedTrace.spans[0]!.http_path || expandedTrace.spans[0]!.span_id.slice(0, 8) }}</span>
                  </span>
                  <span class="dp-meta-item"><span class="text-muted">total</span> <span class="mono">{{ formatDuration(expandedTrace.duration_ns) }}</span></span>
                  <span class="dp-meta-item"><span class="text-muted">spans</span> <span class="mono">{{ expandedTrace.span_count }}</span></span>
                  <span class="dp-meta-item"><span class="text-muted">services</span> <span class="mono">{{ expandedTrace.services.join(', ') }}</span></span>
                </div>
              </template>

              <!-- Span Details -->
              <div class="dp-section-header" style="margin-top: var(--sp-1);">
                <span class="dp-section-title">Span Details</span>
              </div>
              <div class="dp-meta-row">
                <span class="dp-meta-item"><span class="text-muted">span</span> <span class="mono">{{ activeSpanNode?.span_id || expandedRowData?.span_id }}</span></span>
                <span class="dp-meta-item"><span class="text-muted">parent</span> <span class="mono">{{ (activeSpanNode?.parent_span_id || expandedRowData?.parent_span_id) || '\u2014' }}</span></span>
                <span class="dp-meta-item"><span class="text-muted">time</span> <span class="mono">{{ activeSpanNode ? activeSpanNode.timestamp : expandedRowData ? formatTimestamp(expandedRowData.timestamp) : '\u2014' }}</span></span>
                <span class="dp-meta-item"><span class="text-muted">host</span> <span class="mono">{{ expandedRowData?.host_name || '\u2014' }}</span></span>
                <span class="dp-meta-item"><span class="text-muted">env</span> <span class="mono">{{ expandedRowData?.environment || '\u2014' }}</span></span>
              </div>

              <!-- Context chips (from active span's attributes or original row) -->
              <div v-if="getContextAttrs(activeSpanNode ? JSON.stringify(activeSpanNode.attributes || {}) : (expandedRowData?.attributes || '{}')).length" class="et-detail-chips">
                <span
                  v-for="ctx in getContextAttrs(activeSpanNode ? JSON.stringify(activeSpanNode.attributes || {}) : (expandedRowData?.attributes || '{}')).slice(0, 12)"
                  :key="ctx.key"
                  class="chip"
                  :class="{ 'chip-true': ctx.value === 'true', 'chip-false': ctx.value === 'false' }"
                  @click.stop="addFilter(`attributes.${ctx.key}`, ctx.value)"
                >
                  <span class="chip-k">{{ ctx.key.split('.').pop() }}</span>
                  <span class="chip-v">{{ ctx.value }}</span>
                </span>
              </div>

              <!-- Trace Timeline (waterfall) -->
              <div v-if="expandedTrace && expandedTraceSpans.length" class="dp-section">
                <div class="dp-section-header">
                  <span class="dp-section-title">Trace Timeline</span>
                  <span class="dp-section-meta mono">{{ expandedTrace.span_count }} spans &middot; {{ formatDuration(expandedTrace.duration_ns) }}</span>
                </div>
                <div class="wf-container">
                  <!-- Header row -->
                  <div class="wf-header">
                    <div class="wf-col-service">Service / Operation</div>
                    <div class="wf-col-bar">
                      <span class="wf-time-label mono">0ms</span>
                      <span class="wf-time-label mono" style="position:absolute;left:50%;transform:translateX(-50%)">{{ formatDuration(Math.round(expandedTrace.duration_ns / 2)) }}</span>
                      <span class="wf-time-label mono" style="position:absolute;right:0">{{ formatDuration(expandedTrace.duration_ns) }}</span>
                    </div>
                    <div class="wf-col-dur">Duration</div>
                  </div>
                  <!-- Span rows -->
                  <template v-for="span in expandedTraceSpans" :key="'wf-'+span.span_id">
                    <div
                      class="wf-row"
                      :class="{
                        'wf-row-active': span.span_id === timelineExpandedSpan,
                        'wf-row-error': span.status === 'error' || span.http_status_code >= 400,
                        'wf-row-current': span.span_id === (activeSpanId)
                      }"
                      @click.stop="selectTraceSpan(span.span_id)"
                    >
                      <div class="wf-col-service" :style="{ paddingLeft: (12 + spanDepth(span, expandedTraceSpans) * 16) + 'px' }">
                        <span v-if="spanDepth(span, expandedTraceSpans) > 0" class="wf-indent-guide" :style="{ width: (spanDepth(span, expandedTraceSpans) * 16) + 'px' }">
                          <span class="wf-indent-line"></span>
                        </span>
                        <span class="wf-svc" :style="{ color: dpServiceColor(span.service_name) }">{{ span.service_name }}</span>
                        <span class="wf-op mono">{{ span.http_method ? `${span.http_method} ${span.http_path || ''}`.trim() : (span.attributes?.['name'] || span.span_id.slice(0, 8)) }}</span>
                      </div>
                      <div class="wf-col-bar">
                        <div class="wf-bar-track">
                          <div
                            class="wf-bar"
                            :style="{
                              width: expandedTrace.duration_ns > 0 ? Math.max(0.5, (span.duration_ns / expandedTrace.duration_ns) * 100) + '%' : '1%',
                              left: traceBarOffset(span, expandedTraceSpans, expandedTrace.duration_ns),
                              backgroundColor: (span.status === 'error' || span.http_status_code >= 400) ? 'var(--error)' : dpServiceColor(span.service_name),
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="wf-col-dur">
                        <span class="mono" :class="durationClass(span.duration_ns)">{{ formatDuration(span.duration_ns) }}</span>
                        <span v-if="span.http_status_code" class="wf-status mono" :class="statusClass(span.status, span.http_status_code)">{{ span.http_status_code }}</span>
                      </div>
                    </div>
                    <!-- Inline detail when clicked -->
                    <div v-if="timelineExpandedSpan === span.span_id" class="wf-detail" @click.stop>
                      <div class="wf-detail-meta">
                        <span class="wf-detail-item"><span class="text-muted">span</span> <span class="mono">{{ span.span_id }}</span></span>
                        <span class="wf-detail-item"><span class="text-muted">parent</span> <span class="mono">{{ span.parent_span_id || '\u2014' }}</span></span>
                        <span class="wf-detail-item"><span class="text-muted">started</span> <span class="mono">{{ span.timestamp }}</span></span>
                        <span class="wf-detail-item"><span class="text-muted">duration</span> <span class="mono" :class="durationClass(span.duration_ns)">{{ formatDuration(span.duration_ns) }}</span></span>
                        <span v-if="span.http_status_code" class="wf-detail-item"><span class="text-muted">status</span> <span class="mono" :class="statusClass(span.status, span.http_status_code)">{{ span.http_status_code }}</span></span>
                      </div>
                      <div v-if="Object.keys(getSpanAttrs(span)).length" class="wf-detail-section">
                        <div class="wf-detail-title">Attributes</div>
                        <div class="wf-detail-attrs">
                          <template v-for="(value, key) in getSpanAttrs(span)" :key="key">
                            <div class="wf-attr-row">
                              <span class="wf-attr-key mono">{{ key }}</span>
                              <span class="wf-attr-val mono">{{ typeof value === 'object' ? JSON.stringify(value) : value }}</span>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
              <div v-else-if="expandedTraceLoading" class="dp-section">
                <div class="dp-section-header">
                  <span class="dp-section-title">Trace Timeline</span>
                </div>
                <div class="apm-loading"><span class="spinner-dot"></span> Loading trace&hellip;</div>
              </div>

              <!-- Trace-wide log stream -->
              <div class="dp-section">
                <div class="dp-section-header">
                  <span class="dp-section-title">Log Stream</span>
                  <span v-if="traceLogs.length" class="dp-section-meta mono">{{ traceLogs.length }} events</span>
                </div>
                <div v-if="expandedTraceLoading" class="apm-loading">
                  <span class="spinner-dot"></span> Loading trace logs&hellip;
                </div>
                <template v-else-if="traceLogs.length">
                  <div class="tl-list">
                    <div
                      v-for="(tl, li) in traceLogs"
                      :key="li"
                      class="tl-row"
                      :class="{ 'tl-row-current': tl.isCurrentSpan }"
                    >
                      <span class="tl-time mono">{{ formatLogTs(tl.timestamp) }}</span>
                      <span v-if="tl.level" class="log-lv" :class="'lv-' + tl.level">{{ tl.level }}</span>
                      <span class="tl-svc" :style="{ color: dpServiceColor(tl.service_name) }">{{ tl.service_name }}</span>
                      <span class="tl-span mono">{{ tl.span_name }}</span>
                      <span class="tl-msg mono">{{ tl.message }}</span>
                    </div>
                  </div>
                </template>
                <div v-else class="text-muted" style="font-size: 11px; padding: 8px 0">No log events found in this trace. Auto-instrumented spans (dns, net, fs) may not produce log events.</div>
              </div>

              <!-- APM ±15m -->
              <div class="dp-section">
                <div class="dp-section-header">
                  <span class="dp-section-title">APM &plusmn;15m</span>
                  <span v-if="apmSummary" class="dp-section-meta mono">
                    {{ apmSummary.total.toLocaleString() }} req &middot; {{ apmSummary.errorRate.toFixed(1) }}% err &middot; p95 {{ dpFormatMs(apmSummary.p95) }}
                  </span>
                </div>
                <div v-if="expandedApmLoading" class="apm-loading">
                  <span class="spinner-dot"></span> Loading APM data&hellip;
                </div>
                <template v-else-if="apmSummary">
                  <div class="apm-summary">
                    <div class="apm-stat">
                      <div class="apm-stat-label">Requests</div>
                      <div class="apm-stat-value">{{ apmSummary.total.toLocaleString() }}</div>
                    </div>
                    <div class="apm-stat">
                      <div class="apm-stat-label">Error Rate</div>
                      <div class="apm-stat-value" :class="{ 'apm-stat-error': apmSummary.errors > 0 }">{{ apmSummary.errorRate.toFixed(1) }}%</div>
                    </div>
                    <div class="apm-stat">
                      <div class="apm-stat-label">Avg</div>
                      <div class="apm-stat-value">{{ dpFormatMs(apmSummary.avgDur) }}</div>
                    </div>
                    <div class="apm-stat">
                      <div class="apm-stat-label">p50</div>
                      <div class="apm-stat-value">{{ dpFormatMs(apmSummary.p50) }}</div>
                    </div>
                    <div class="apm-stat">
                      <div class="apm-stat-label">p95</div>
                      <div class="apm-stat-value">{{ dpFormatMs(apmSummary.p95) }}</div>
                    </div>
                    <div class="apm-stat">
                      <div class="apm-stat-label">p99</div>
                      <div class="apm-stat-value">{{ dpFormatMs(apmSummary.p99) }}</div>
                    </div>
                  </div>
                  <div class="dp-charts-row">
                    <div class="dp-chart-panel">
                      <div class="dp-chart-title">Request Rate</div>
                      <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg" @mousemove="dpChartMouseMove($event, 'rate')" @mouseleave="dpChartMouseLeave">
                        <template v-for="tick in dpYTicks(apmSummary.rateValues)" :key="'ry'+tick.label">
                          <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                          <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                        </template>
                        <template v-for="lbl in dpXLabels(expandedApm!)" :key="'rx'+lbl.label">
                          <text :x="lbl.x" :y="dpChartH - 2" class="dp-axis-label" text-anchor="middle">{{ lbl.label }}</text>
                        </template>
                        <path :d="dpAreaPath(apmSummary.rateValues)" class="dp-area dp-rate" />
                        <path :d="dpLinePath(apmSummary.rateValues)" class="dp-line dp-rate" />
                        <line :x1="dpEventMarkerX(expandedApm!)" y1="0" :x2="dpEventMarkerX(expandedApm!)" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                        <text :x="dpEventMarkerX(expandedApm!) + 3" :y="10" class="dp-marker-label">{{ new Date(expandedApmEventMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</text>
                        <template v-if="chartHover?.chartType === 'rate'">
                          <line :x1="dpHoverBucketX(chartHover.bucketIdx, apmSummary.rateValues.length)" :y1="dpChartPad.top" :x2="dpHoverBucketX(chartHover.bucketIdx, apmSummary.rateValues.length)" :y2="dpChartH - dpChartPad.bottom" class="dp-hover-line" />
                          <circle :cx="dpHoverBucketX(chartHover.bucketIdx, apmSummary.rateValues.length)" :cy="dpChartPad.top + dpInnerH - ((apmSummary.rateValues[chartHover.bucketIdx] ?? 0) / Math.max(...apmSummary.rateValues, 1)) * dpInnerH" r="3" class="dp-hover-dot dp-rate" />
                        </template>
                        <rect :x="dpChartPad.left" :y="dpChartPad.top" :width="dpInnerW" :height="dpInnerH" fill="transparent" style="cursor: crosshair" />
                      </svg>
                      <div v-if="chartHover?.chartType === 'rate'" class="dp-tooltip" :style="{ left: (dpHoverBucketX(chartHover.bucketIdx, apmSummary.rateValues.length) / dpChartW * 100) + '%' }">
                        <div class="dp-tooltip-time">{{ dpHoverDate(chartHover.bucketIdx) }} {{ dpHoverTime(chartHover.bucketIdx) }}</div>
                        <div class="dp-tooltip-val">{{ apmSummary.rateValues[chartHover.bucketIdx] }} req</div>
                      </div>
                    </div>
                    <div class="dp-chart-panel">
                      <div class="dp-chart-title">Error Rate</div>
                      <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg" @mousemove="dpChartMouseMove($event, 'error')" @mouseleave="dpChartMouseLeave">
                        <template v-for="tick in dpYTicks(apmSummary.errorValues)" :key="'ey'+tick.label">
                          <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                          <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                        </template>
                        <template v-for="lbl in dpXLabels(expandedApm!)" :key="'ex'+lbl.label">
                          <text :x="lbl.x" :y="dpChartH - 2" class="dp-axis-label" text-anchor="middle">{{ lbl.label }}</text>
                        </template>
                        <path :d="dpAreaPath(apmSummary.errorValues)" class="dp-area dp-error" />
                        <path :d="dpLinePath(apmSummary.errorValues)" class="dp-line dp-error" />
                        <line :x1="dpEventMarkerX(expandedApm!)" y1="0" :x2="dpEventMarkerX(expandedApm!)" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                        <text :x="dpEventMarkerX(expandedApm!) + 3" :y="10" class="dp-marker-label">{{ new Date(expandedApmEventMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</text>
                        <template v-if="chartHover?.chartType === 'error'">
                          <line :x1="dpHoverBucketX(chartHover.bucketIdx, apmSummary.errorValues.length)" :y1="dpChartPad.top" :x2="dpHoverBucketX(chartHover.bucketIdx, apmSummary.errorValues.length)" :y2="dpChartH - dpChartPad.bottom" class="dp-hover-line" />
                          <circle :cx="dpHoverBucketX(chartHover.bucketIdx, apmSummary.errorValues.length)" :cy="dpChartPad.top + dpInnerH - ((apmSummary.errorValues[chartHover.bucketIdx] ?? 0) / Math.max(...apmSummary.errorValues, 1)) * dpInnerH" r="3" class="dp-hover-dot dp-error" />
                        </template>
                        <rect :x="dpChartPad.left" :y="dpChartPad.top" :width="dpInnerW" :height="dpInnerH" fill="transparent" style="cursor: crosshair" />
                      </svg>
                      <div v-if="chartHover?.chartType === 'error'" class="dp-tooltip" :style="{ left: (dpHoverBucketX(chartHover.bucketIdx, apmSummary.errorValues.length) / dpChartW * 100) + '%' }">
                        <div class="dp-tooltip-time">{{ dpHoverDate(chartHover.bucketIdx) }} {{ dpHoverTime(chartHover.bucketIdx) }}</div>
                        <div class="dp-tooltip-val">{{ apmSummary.errorValues[chartHover.bucketIdx] }} errors</div>
                      </div>
                    </div>
                    <div class="dp-chart-panel">
                      <div class="dp-chart-title">
                        Latency
                        <span class="dp-chart-legend">
                          <span class="dp-legend-dot dp-c-p50"></span>p50
                          <span class="dp-legend-dot dp-c-p95"></span>p95
                          <span class="dp-legend-dot dp-c-p99"></span>p99
                        </span>
                      </div>
                      <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg" @mousemove="dpChartMouseMove($event, 'latency')" @mouseleave="dpChartMouseLeave">
                        <template v-for="tick in dpYTicks(apmSummary.p99Values)" :key="'dy'+tick.label">
                          <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                          <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                        </template>
                        <template v-for="lbl in dpXLabels(expandedApm!)" :key="'dx'+lbl.label">
                          <text :x="lbl.x" :y="dpChartH - 2" class="dp-axis-label" text-anchor="middle">{{ lbl.label }}</text>
                        </template>
                        <path :d="dpAreaPath(apmSummary.p99Values)" class="dp-area dp-p99" />
                        <path :d="dpLinePath(apmSummary.p99Values)" class="dp-line dp-p99" />
                        <path :d="dpLinePath(apmSummary.p95Values)" class="dp-line dp-p95" />
                        <path :d="dpLinePath(apmSummary.p50Values)" class="dp-line dp-p50" />
                        <line :x1="dpEventMarkerX(expandedApm!)" y1="0" :x2="dpEventMarkerX(expandedApm!)" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                        <text :x="dpEventMarkerX(expandedApm!) + 3" :y="10" class="dp-marker-label">{{ new Date(expandedApmEventMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</text>
                        <template v-if="chartHover?.chartType === 'latency'">
                          <line :x1="dpHoverBucketX(chartHover.bucketIdx, apmSummary.p50Values.length)" :y1="dpChartPad.top" :x2="dpHoverBucketX(chartHover.bucketIdx, apmSummary.p50Values.length)" :y2="dpChartH - dpChartPad.bottom" class="dp-hover-line" />
                          <circle :cx="dpHoverBucketX(chartHover.bucketIdx, apmSummary.p50Values.length)" :cy="dpChartPad.top + dpInnerH - ((apmSummary.p50Values[chartHover.bucketIdx] ?? 0) / Math.max(...apmSummary.p99Values, 1)) * dpInnerH" r="3" class="dp-hover-dot dp-p50" />
                          <circle :cx="dpHoverBucketX(chartHover.bucketIdx, apmSummary.p95Values.length)" :cy="dpChartPad.top + dpInnerH - ((apmSummary.p95Values[chartHover.bucketIdx] ?? 0) / Math.max(...apmSummary.p99Values, 1)) * dpInnerH" r="3" class="dp-hover-dot dp-p95" />
                          <circle :cx="dpHoverBucketX(chartHover.bucketIdx, apmSummary.p99Values.length)" :cy="dpChartPad.top + dpInnerH - ((apmSummary.p99Values[chartHover.bucketIdx] ?? 0) / Math.max(...apmSummary.p99Values, 1)) * dpInnerH" r="3" class="dp-hover-dot dp-p99" />
                        </template>
                        <rect :x="dpChartPad.left" :y="dpChartPad.top" :width="dpInnerW" :height="dpInnerH" fill="transparent" style="cursor: crosshair" />
                      </svg>
                      <div v-if="chartHover?.chartType === 'latency'" class="dp-tooltip" :style="{ left: (dpHoverBucketX(chartHover.bucketIdx, apmSummary.p50Values.length) / dpChartW * 100) + '%' }">
                        <div class="dp-tooltip-time">{{ dpHoverDate(chartHover.bucketIdx) }} {{ dpHoverTime(chartHover.bucketIdx) }}</div>
                        <div class="dp-tooltip-val"><span class="dp-c-p50">p50</span> {{ dpFormatMs(apmSummary.p50Values[chartHover.bucketIdx] ?? 0) }}</div>
                        <div class="dp-tooltip-val"><span class="dp-c-p95">p95</span> {{ dpFormatMs(apmSummary.p95Values[chartHover.bucketIdx] ?? 0) }}</div>
                        <div class="dp-tooltip-val"><span class="dp-c-p99">p99</span> {{ dpFormatMs(apmSummary.p99Values[chartHover.bucketIdx] ?? 0) }}</div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
              </template><!-- /v-else-if expandedRowData -->
            </template><!-- /expandedTab === null (Details) -->

            <!-- ═══ METRICS TAB (full width) ═══ -->
            <template v-if="expandedTab === 'metrics'">
              <div class="metrics-section">
                <!-- ── Pod Metrics ── -->
                <div class="metrics-pod-header">
                  <span class="dp-section-title">Pod Metrics</span>
                  <span class="dp-section-meta mono">{{ expandedRowData?.host_name || 'unknown-pod' }} &middot; {{ expandedRowData?.service_name }}</span>
                </div>

                <div class="metrics-charts">
                  <div class="metrics-chart-panel">
                    <div class="dp-chart-title">CPU Usage (%)</div>
                    <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg">
                      <template v-for="tick in dpYTicks(mockedPodMetrics.map(m => m.cpu))" :key="'pc'+tick.label">
                        <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                        <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                      </template>
                      <path :d="dpAreaPath(mockedPodMetrics.map(m => m.cpu))" class="dp-area dp-cpu" />
                      <path :d="dpLinePath(mockedPodMetrics.map(m => m.cpu))" class="dp-line dp-cpu" />
                      <line :x1="mockMetricsMarkerX(mockedPodMetrics.map(m => m.timestamp))" y1="0" :x2="mockMetricsMarkerX(mockedPodMetrics.map(m => m.timestamp))" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                    </svg>
                  </div>
                  <div class="metrics-chart-panel">
                    <div class="dp-chart-title">Memory (MB)</div>
                    <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg">
                      <template v-for="tick in dpYTicks(mockedPodMetrics.map(m => m.memoryMb))" :key="'pm'+tick.label">
                        <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                        <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                      </template>
                      <path :d="dpAreaPath(mockedPodMetrics.map(m => m.memoryMb))" class="dp-area dp-mem" />
                      <path :d="dpLinePath(mockedPodMetrics.map(m => m.memoryMb))" class="dp-line dp-mem" />
                      <line :x1="mockMetricsMarkerX(mockedPodMetrics.map(m => m.timestamp))" y1="0" :x2="mockMetricsMarkerX(mockedPodMetrics.map(m => m.timestamp))" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                    </svg>
                  </div>
                </div>

                <div class="apm-summary" style="margin-top: 8px">
                  <div class="apm-stat">
                    <div class="apm-stat-label">Avg CPU</div>
                    <div class="apm-stat-value">{{ (mockedPodMetrics.reduce((s, m) => s + m.cpu, 0) / Math.max(mockedPodMetrics.length, 1)).toFixed(1) }}%</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Peak CPU</div>
                    <div class="apm-stat-value" :class="{ 'apm-stat-error': Math.max(...mockedPodMetrics.map(m => m.cpu)) > 80 }">{{ Math.max(...mockedPodMetrics.map(m => m.cpu)).toFixed(1) }}%</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Avg Memory</div>
                    <div class="apm-stat-value">{{ Math.round(mockedPodMetrics.reduce((s, m) => s + m.memoryMb, 0) / Math.max(mockedPodMetrics.length, 1)) }} MB</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Peak Memory</div>
                    <div class="apm-stat-value">{{ Math.max(...mockedPodMetrics.map(m => m.memoryMb)) }} MB</div>
                  </div>
                </div>

                <!-- ── Node Metrics ── -->
                <div class="metrics-node-header">
                  <span class="dp-section-title">Node Metrics</span>
                  <span class="dp-section-meta mono">{{ expandedRowData?.host_name || 'node-unknown' }} &middot; {{ mockedNodeMetrics.cpuCores }} cores &middot; {{ mockedNodeMetrics.memoryTotalGb }} GB</span>
                </div>

                <div class="metrics-charts">
                  <div class="metrics-chart-panel">
                    <div class="dp-chart-title">Node CPU (%)</div>
                    <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg">
                      <template v-for="tick in dpYTicks(mockedNodeMetrics.timeseries.map(m => m.cpu))" :key="'nc'+tick.label">
                        <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                        <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                      </template>
                      <path :d="dpAreaPath(mockedNodeMetrics.timeseries.map(m => m.cpu))" class="dp-area dp-node-cpu" />
                      <path :d="dpLinePath(mockedNodeMetrics.timeseries.map(m => m.cpu))" class="dp-line dp-node-cpu" />
                      <line :x1="mockMetricsMarkerX(mockedNodeMetrics.timeseries.map(m => m.timestamp))" y1="0" :x2="mockMetricsMarkerX(mockedNodeMetrics.timeseries.map(m => m.timestamp))" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                    </svg>
                  </div>
                  <div class="metrics-chart-panel">
                    <div class="dp-chart-title">Node Memory (MB)</div>
                    <svg :viewBox="`0 0 ${dpChartW} ${dpChartH}`" preserveAspectRatio="none" class="dp-chart-svg">
                      <template v-for="tick in dpYTicks(mockedNodeMetrics.timeseries.map(m => m.memoryMb))" :key="'nm'+tick.label">
                        <line :x1="dpChartPad.left" :y1="tick.y" :x2="dpChartW - dpChartPad.right" :y2="tick.y" class="dp-grid-line" />
                        <text :x="dpChartPad.left - 4" :y="tick.y + 3" class="dp-axis-label" text-anchor="end">{{ tick.label }}</text>
                      </template>
                      <path :d="dpAreaPath(mockedNodeMetrics.timeseries.map(m => m.memoryMb))" class="dp-area dp-node-mem" />
                      <path :d="dpLinePath(mockedNodeMetrics.timeseries.map(m => m.memoryMb))" class="dp-line dp-node-mem" />
                      <line :x1="mockMetricsMarkerX(mockedNodeMetrics.timeseries.map(m => m.timestamp))" y1="0" :x2="mockMetricsMarkerX(mockedNodeMetrics.timeseries.map(m => m.timestamp))" :y2="dpChartH - dpChartPad.bottom" class="apm-marker" />
                    </svg>
                  </div>
                </div>

                <div class="apm-summary" style="margin-top: 8px">
                  <div class="apm-stat">
                    <div class="apm-stat-label">CPU Cores</div>
                    <div class="apm-stat-value">{{ mockedNodeMetrics.cpuCores }}</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Load Avg</div>
                    <div class="apm-stat-value mono">{{ mockedNodeMetrics.loadAvg.join(' / ') }}</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Total RAM</div>
                    <div class="apm-stat-value">{{ mockedNodeMetrics.memoryTotalGb }} GB</div>
                  </div>
                  <div class="apm-stat">
                    <div class="apm-stat-label">Uptime</div>
                    <div class="apm-stat-value">{{ mockedNodeMetrics.uptimeDays }}d</div>
                  </div>
                </div>

                <div class="metrics-mock-note text-muted">Metrics are mocked for demo purposes</div>
              </div>
            </template>

            <!-- ═══ ATTRIBUTES TAB (full width) ═══ -->
            <template v-if="expandedTab === 'attributes'">
              <!-- Log-only attributes -->
              <template v-if="modalSource === 'log' && !expandedRowData && modalLogEntry">
                <div v-if="Object.keys(modalLogEntry.resource_attrs).length" class="attr-tab-section">
                  <div class="attr-tab-header">Resource Attributes</div>
                  <div class="attr-tab-table">
                    <div v-for="(val, key) in modalLogEntry.resource_attrs" :key="String(key)" class="attr-tab-row" @click.stop="addFilter(`resource.${String(key)}`, String(val))">
                      <span class="attr-tab-k mono">{{ key }}</span>
                      <span class="attr-tab-v mono">{{ val }}</span>
                      <span class="attr-tab-action">&#xBB;</span>
                    </div>
                  </div>
                </div>
                <div v-if="Object.keys(modalLogEntry.event_attrs).length" class="attr-tab-section">
                  <div class="attr-tab-header">Log Attributes</div>
                  <div class="attr-tab-table">
                    <div v-for="(val, key) in modalLogEntry.event_attrs" :key="String(key)" class="attr-tab-row" @click.stop="addFilter(`log.${String(key)}`, String(val))">
                      <span class="attr-tab-k mono">{{ key }}</span>
                      <span class="attr-tab-v mono">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
                      <span class="attr-tab-action">&#xBB;</span>
                    </div>
                  </div>
                </div>
                <div v-if="!Object.keys(modalLogEntry.event_attrs).length && !Object.keys(modalLogEntry.resource_attrs).length" class="attr-tab-empty">No attributes found.</div>
              </template>
              <!-- Span attributes -->
              <template v-else-if="expandedRowData || activeSpanNode">
                <div class="attr-tab-section">
                  <div class="attr-tab-header">Span Attributes</div>
                  <div class="attr-tab-table">
                    <div v-for="(value, key) in getFilteredAttrs(activeSpanNode ? JSON.stringify(activeSpanNode.attributes || {}) : (expandedRowData?.attributes || '{}'))" :key="key" class="attr-tab-row" @click.stop="addFilter(`attributes.${key}`, String(value))">
                      <span class="attr-tab-k mono">{{ key }}</span>
                      <span class="attr-tab-v mono">{{ typeof value === 'object' ? JSON.stringify(value) : value }}</span>
                      <span class="attr-tab-action">&#xBB;</span>
                    </div>
                  </div>
                </div>
                <div v-if="Object.keys(getFilteredAttrs(activeSpanNode ? JSON.stringify(activeSpanNode.attributes || {}) : (expandedRowData?.attributes || '{}'))).length === 0" class="attr-tab-empty">No attributes found.</div>
              </template>
            </template>

            <template v-if="expandedTab === 'context'">
              <aside class="investigation-rail">
                <div class="ir-eyebrow">Investigation context</div>
                <h3>{{ activeSpanNode?.service_name || expandedRowData?.service_name || modalLogEntry?.service_name || 'Selected event' }}</h3>
                <div class="ir-summary">
                  <span v-if="expandedTrace"><b>{{ expandedTrace.span_count }}</b> spans</span>
                  <span v-if="expandedTrace"><b>{{ expandedTrace.services.length }}</b> services</span>
                  <span v-if="traceLogs.length"><b>{{ traceLogs.length }}</b> trace events</span>
                </div>
                <div class="ir-actions">
                  <router-link v-if="expandedRowData?.trace_id || modalLogEntry?.trace_id" :to="`/trace/${expandedRowData?.trace_id || modalLogEntry?.trace_id}`" class="ir-primary">Open full trace</router-link>
                  <button class="ir-action" @click="openServiceContext">Open service health</button>
                  <button class="ir-action" @click="openInvestigationContext">Investigate with AI</button>
                </div>
                <section class="ir-section">
                  <div class="ir-section-title">Correlated signals</div>
                  <button v-if="modalLogEntry" class="ir-link" @click="openContextStream(modalLogEntry)">Show surrounding logs {{ contextStreamRadiusLabel }}</button>
                  <button v-else-if="traceLogs.length" class="ir-link" @click="expandedTab = null">Review {{ traceLogs.length }} trace log events</button>
                  <p v-else class="ir-empty">No correlated log events were collected for this selection.</p>
                </section>
                <section v-if="expandedTrace?.services.length" class="ir-section">
                  <div class="ir-section-title">Request path</div>
                  <div class="ir-service-list"><span v-for="service in expandedTrace.services" :key="service">{{ service }}</span></div>
                </section>
              </aside>
            </template>

          </div>
        </div>
      </div>
      </div>
    </Transition>
    </Teleport>

    <!-- ═══ Context Stream Panel ═══ -->
    <Teleport to="body">
    <Transition name="slide-down">
      <div v-if="contextStreamOpen" class="detail-overlay ctx-overlay" @click.self="closeContextStream()">
      <div class="detail-panel ctx-stream-panel" @click.stop>
        <div class="detail-panel-inner">
          <!-- Header -->
          <div class="dp-header">
            <div class="dp-header-left">
              <span class="dp-svc">Log Context</span>
              <span class="ctx-time-badge">{{ contextStreamRadiusLabel }}</span>
            </div>
            <div class="dp-header-right">
              <button class="dp-close" @click="closeContextStream()" title="Close (Esc)">&times;</button>
            </div>
          </div>

          <!-- Filter chips -->
          <div class="ctx-filter-bar">
            <span
              v-for="f in contextStreamFilters"
              :key="f.field"
              class="ctx-chip ctx-chip-selected"
              style="cursor: default;"
            >
              <span class="ctx-chip-k">{{ f.label }}</span>
              <span class="ctx-chip-v">{{ f.value }}</span>
            </span>
          </div>

          <!-- Column headers -->
          <div class="ctx-stream-head">
            <div>Time</div>
            <div>Level</div>
            <div>Service</div>
            <div>Message</div>
          </div>

          <!-- Log rows -->
          <div class="dp-body" style="padding: 0;">
            <div v-if="contextStreamLoading" class="loading-more" style="padding: 24px; text-align: center;">
              <span class="loading-more-spinner">&#9676;</span> Loading context…
            </div>
            <div v-else-if="!contextStreamLogs.length" class="loading-more text-muted" style="padding: 24px; text-align: center;">
              No logs found in this time window
            </div>
            <template v-else>
              <template v-for="(rec, ri) in contextStreamLogs" :key="ri">
                <div
                  class="ctx-stream-row"
                  :class="{ 'ctx-source': isSourceLog(rec) }"
                  @click.stop="toggleContextStreamRow(ri)"
                >
                  <div class="mono">{{ formatCtxTimestamp(rec.Timestamp) }}</div>
                  <div><span class="log-level-badge" :class="logLevelClass(rec.SeverityText)">{{ rec.SeverityText || 'log' }}</span></div>
                  <div class="mono">{{ rec.ServiceName }}</div>
                  <div class="mono ctx-msg">{{ rec.Body }}</div>
                  <div v-if="isSourceLog(rec)" class="ctx-source-marker" title="Source log">&#9670;</div>
                </div>
                <!-- Inline expansion -->
                <div v-if="contextStreamExpandedIdx === ri" class="ctx-stream-detail" @click.stop>
                  <div class="log-detail-meta">
                    <span class="log-detail-item"><span class="text-muted">service</span> <span class="mono">{{ rec.ServiceName }}</span></span>
                    <span class="log-detail-item"><span class="log-level-badge" :class="logLevelClass(rec.SeverityText)">{{ rec.SeverityText || 'log' }}</span></span>
                    <span class="log-detail-item"><span class="text-muted">time</span> <span class="mono">{{ formatCtxTimestamp(rec.Timestamp) }}</span></span>
                    <span v-if="rec.TraceId" class="log-detail-item"><span class="text-muted">trace</span> <router-link :to="`/trace/${rec.TraceId}`" class="et-trace-link mono" @click.stop>{{ rec.TraceId.slice(0, 16) }}</router-link></span>
                    <span v-if="rec.SpanId" class="log-detail-item"><span class="text-muted">span</span> <span class="mono">{{ rec.SpanId.slice(0, 12) }}</span></span>
                  </div>
                  <div v-if="rec.Body" class="log-detail-message mono">{{ rec.Body }}</div>
                  <div v-if="Object.keys(rec.LogAttributes || {}).length" class="log-detail-attrs">
                    <div class="log-detail-attrs-header">Log Attributes</div>
                    <div class="log-detail-attrs-grid">
                      <template v-for="(val, key) in rec.LogAttributes" :key="String(key)">
                        <div class="log-detail-attr-k mono">{{ key }}</div>
                        <div class="log-detail-attr-v mono">{{ val }}</div>
                      </template>
                    </div>
                  </div>
                  <div v-if="Object.keys(rec.ResourceAttributes || {}).length" class="log-detail-attrs">
                    <div class="log-detail-attrs-header">Resource Attributes</div>
                    <div class="log-detail-attrs-grid">
                      <template v-for="(val, key) in rec.ResourceAttributes" :key="String(key)">
                        <div class="log-detail-attr-k mono">{{ key }}</div>
                        <div class="log-detail-attr-v mono">{{ val }}</div>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </template>
          </div>
        </div>
      </div>
      </div>
    </Transition>
    </Teleport>

    <!-- ═══ Stats Bar ═══ -->
    <div v-if="viewMode === 'spans' && stats" class="stats-bar fade-in">
      <div class="stat">
        <div class="stat-value mono">{{ stats.total.toLocaleString() }}</div>
        <div class="stat-label">events</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono" :class="{ 'stat-err': parseFloat(stats.errorRate) > 0 }">{{ stats.errorRate }}%</div>
        <div class="stat-label">error rate</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono">{{ stats.p50 }}</div>
        <div class="stat-label">p50</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono">{{ stats.p99 }}</div>
        <div class="stat-label">p99</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono">{{ stats.services }}</div>
        <div class="stat-label">services</div>
      </div>
    </div>
    <div v-else-if="viewMode === 'logs' && logStats" class="stats-bar fade-in">
      <div class="stat">
        <div class="stat-value mono">{{ logStats.total.toLocaleString() }}</div>
        <div class="stat-label">logs</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono" :class="{ 'stat-err': logStats.errors > 0 }">{{ logStats.errors.toLocaleString() }}</div>
        <div class="stat-label">errors</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono" :class="{ 'stat-warn': logStats.warnings > 0 }">{{ logStats.warnings.toLocaleString() }}</div>
        <div class="stat-label">warnings</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono" :class="{ 'stat-err': parseFloat(logStats.errorRate) > 0 }">{{ logStats.errorRate }}%</div>
        <div class="stat-label">error %</div>
      </div>
      <div class="stat-divider" />
      <div class="stat">
        <div class="stat-value mono">{{ logStats.services }}</div>
        <div class="stat-label">services</div>
      </div>
    </div>

    <!-- ═══ Search ═══ -->
    <div class="search-section">
      <!-- Mode toggle toolbar -->
      <div class="search-toolbar">
        <div class="toolbar-left">
          <!-- Hide the APM/Logs toggle entirely when APM is disabled for this
               tenant — only logs are available, so there's nothing to switch. -->
          <div v-if="apmEnabled" class="view-toggle">
            <button
              class="mode-btn"
              :class="{ active: viewMode === 'spans' }"
              @click="setViewMode('spans')"
            >APM</button>
            <button
              class="mode-btn"
              :class="{ active: viewMode === 'logs' }"
              @click="setViewMode('logs'); tracesOnly = false"
            >Logs</button>
          </div>
        </div>
        <div class="toolbar-right">
          <TimePicker v-model="selectedPreset" v-model:custom-range="customRange" />
          <button class="live-btn" :class="{ active: liveMode }" @click="toggleLive()">
            <span class="live-dot"></span> Live
          </button>
          <button class="export-btn" @click="openExport" title="Export current query and results">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
          <SavedQueries
            :current-filters="savedQueryFilters"
            :current-group-by="groupByField"
            :current-time-preset="selectedPreset"
            @load="loadSavedQuery"
          />
          <button class="share-btn" @click="shareLink" :title="shareCopied ? 'Copied!' : 'Copy shareable link'">
            {{ shareCopied ? '&#10003; Copied' : '&#128279; Share' }}
          </button>
          <QueryHistory
            :entries="exploreHistory ?? []"
            @load="loadHistoryEntry"
            @remove="removeHistory"
            @clear="clearHistory"
          >
            <template #summary="{ entry }">
              <span class="mono">
                <template v-if="entry.query.filters.length">{{ entry.query.filters.map((f: Filter) => `${f.field}${f.op}${f.value}`).join(' ') }}</template>
                <template v-if="entry.query.search">{{ entry.query.filters.length ? ' ' : '' }}{{ entry.query.search }}</template>
                <template v-if="entry.query.groupBy"> &middot; group by {{ entry.query.groupBy }}</template>
                <template v-if="entry.query.viewMode === 'logs'"> &middot; logs</template>
              </span>
            </template>
          </QueryHistory>
          <button class="kbd-hint-btn" @click="showShortcuts = true" title="Keyboard shortcuts (?)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/>
              <path d="M6 12h.01"/><path d="M10 12h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/>
              <path d="M8 16h8"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Search bar -->
      <div class="search-bar" :class="{ 'nl-mode': nlMode }">
        <span class="search-prompt mono">{{ nlMode ? '✦' : '$' }}</span>
        <input
          v-if="!nlMode"
          ref="searchInputEl"
          v-model="searchInput"
          class="search-input"
          placeholder="service_name=notifications event — filters + free text search"
          @input="onSearchInput"
          @keydown="onSearchKeydown"
          @blur="onSearchBlur"
          @focus="onSearchInput"
        />
        <input
          v-else
          ref="nlInputEl"
          v-model="nlInput"
          class="search-input nl-search-input"
          placeholder="logs from payment service with errors in production…"
          @input="onNlInput"
          @keydown="onNlKeydown"
        />
        <button
          v-if="nlMode && !nlLoading && nlInput.trim() && nlConfidence < 0.65"
          class="nl-ai-btn"
          @click="callLlmParse"
          title="Let AI parse this query"
        >✦ AI</button>
        <span v-if="nlMode && nlLoading" class="nl-spinner mono">···</span>
        <button v-if="nlMode" class="search-btn" @click="applyNlQuery" :disabled="!nlChips.length && !nlSearch">Apply</button>
        <button v-if="!nlMode" class="nl-toggle-btn" @click="enterNlMode" title="Natural language search (✦)">✦</button>
        <button v-if="!nlMode" class="search-btn" @click="() => search()">Run</button>
        <!-- Autocomplete dropdown (normal mode only) -->
        <div v-if="!nlMode && acVisible && acItems.length" class="ac-dropdown">
          <div
            v-for="(item, i) in acItems"
            :key="i"
            class="ac-item"
            :class="{ 'ac-active': acIndex === i, ['ac-kind-' + item.kind]: true }"
            @mousedown.prevent="acSelect(item)"
            @mouseenter="acIndex = i"
          >
            <span class="ac-kind-badge mono">{{ item.kind === 'field' ? 'field' : item.kind === 'op' ? 'op' : 'val' }}</span>
            <span class="ac-label mono">{{ item.label }}</span>
          </div>
        </div>
      </div>

      <!-- NL mode: chip preview below search bar -->
      <div v-if="nlMode && (nlChips.length || nlSearch)" class="nl-preview">
        <span class="nl-preview-arrow">→</span>
        <span
          v-for="chip in nlChips"
          :key="chip.field + chip.op + chip.value"
          class="nl-chip"
        >
          <span class="nl-chip-field mono">{{ chip.field }}</span><span class="nl-chip-op mono">{{ chip.op }}</span><span class="nl-chip-val mono">{{ chip.value }}</span>
          <button class="nl-chip-remove" @click="removeNlChip(chip)" title="Remove">&times;</button>
        </span>
        <span v-if="nlSearch" class="nl-chip nl-chip-search mono">"{{ nlSearch }}"</span>
        <button class="nl-cancel-btn" @click="exitNlMode">✕</button>
      </div>

      <!-- ═══ Active Filter Chips ═══ -->
      <div v-if="activeFilterChips.length" class="filter-chips">
        <span
          v-for="chip in activeFilterChips"
          :key="chip.id"
          class="filter-chip"
        >
          <span class="filter-chip-label mono">{{ chip.label }}</span>
          <button class="filter-chip-remove" @click="removeFilterChip(chip)" title="Remove filter">&times;</button>
        </span>
      </div>

    </div>

    <!-- ═══ Main layout: Sidebar + Content ═══ -->
    <div class="explore-body" :class="{ 'compare-active': compareModeActive && viewMode === 'spans' }">

      <!-- ═══ Facets Sidebar ═══ -->
      <aside class="facet-sidebar">
        <div class="facet-top">
          <span class="facet-showing mono">{{ viewMode === 'logs' ? logEntries.length.toLocaleString() + ' logs' : results.length.toLocaleString() + ' of ' + total.toLocaleString() + (tracesOnly ? ' traces' : ' spans') }}<template v-if="queryDurationMs !== null"> &middot; {{ queryDurationMs >= 1000 ? (queryDurationMs / 1000).toFixed(1) + 's' : queryDurationMs + 'ms' }}</template></span>
          <button
            v-if="hasQuickFilters"
            class="facet-clear"
            @click="clearQuickFilters"
          >&times; Clear all</button>
        </div>

        <!-- ── Traces-only toggle (APM mode only) ── -->
        <div v-if="viewMode === 'spans'" class="facet-section facet-traces-toggle">
          <label class="facet-toggle-row" @click.prevent="tracesOnly = !tracesOnly">
            <span class="facet-toggle-label">Traces only</span>
            <span class="facet-toggle-switch" :class="{ on: tracesOnly }">
              <span class="facet-toggle-knob" />
            </span>
          </label>
        </div>

        <!-- ── CORE section ── -->
        <div class="facet-category">CORE</div>

        <!-- Duration facet -->
        <div class="facet-section">
          <div class="facet-header" @click="toggleFacet('duration')">
            <span class="facet-chevron" :class="{ collapsed: facetCollapsed['duration'] }">&#9662;</span>
            <span class="facet-name">Duration</span>
          </div>
          <div v-if="!facetCollapsed['duration']" class="facet-body">
            <!-- Duration range slider -->
            <div class="duration-slider-wrap">
              <div class="duration-slider-labels">
                <span class="duration-slider-val mono">{{ durationSliderMin > 0 ? formatDuration(durationSliderMin) : '0' }}</span>
                <span v-if="durationSliderMin > 0 || durationSliderMax > 0" class="duration-slider-clear" @click="clearDurationSlider">clear</span>
                <span class="duration-slider-val mono">{{ durationSliderMax > 0 ? formatDuration(durationSliderMax) : '\u221E' }}</span>
              </div>
              <div class="duration-slider-track">
                <input
                  type="range"
                  class="duration-range duration-range-min"
                  :min="0"
                  :max="SLIDER_STOPS.length - 1"
                  :value="nsToSliderPos(durationSliderMin)"
                  @input="onSliderMinChange"
                />
                <input
                  type="range"
                  class="duration-range duration-range-max"
                  :min="0"
                  :max="SLIDER_STOPS.length - 1"
                  :value="nsToSliderPos(durationSliderMax)"
                  @input="onSliderMaxChange"
                />
                <div
                  class="duration-slider-fill"
                  :style="{
                    left: `${(nsToSliderPos(durationSliderMin) / (SLIDER_STOPS.length - 1)) * 100}%`,
                    right: durationSliderMax > 0
                      ? `${100 - (nsToSliderPos(durationSliderMax) / (SLIDER_STOPS.length - 1)) * 100}%`
                      : '0%',
                  }"
                />
              </div>
              <div class="duration-slider-ticks mono">
                <span>0</span>
                <span>100ms</span>
                <span>1s</span>
                <span>30s</span>
              </div>
            </div>

            <div class="facet-duration-presets">
              <button
                class="facet-item"
                :class="{ active: quickDuration === 'fast' }"
                @click="toggleQuickDuration('fast')"
              >
                <span class="facet-check" :class="{ checked: quickDuration === 'fast' }" />
                <span class="facet-item-label">&lt; 100ms</span>
              </button>
              <button
                class="facet-item"
                :class="{ active: quickDuration === 'med' }"
                @click="toggleQuickDuration('med')"
              >
                <span class="facet-check" :class="{ checked: quickDuration === 'med' }" />
                <span class="facet-item-label">100ms - 500ms</span>
              </button>
              <button
                class="facet-item"
                :class="{ active: quickDuration === 'slow' }"
                @click="toggleQuickDuration('slow')"
              >
                <span class="facet-check" :class="{ checked: quickDuration === 'slow' }" />
                <span class="facet-item-label">&gt; 500ms</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Status facet -->
        <div class="facet-section">
          <div class="facet-header" @click="toggleFacet('status')">
            <span class="facet-chevron" :class="{ collapsed: facetCollapsed['status'] }">&#9662;</span>
            <span class="facet-name">Status</span>
          </div>
          <div v-if="!facetCollapsed['status']" class="facet-body">
            <button
              v-for="sf in statusFacets"
              :key="sf.name"
              class="facet-item"
              :class="{ active: quickStatusRange === sf.name }"
              @click="toggleQuickStatus(sf.name)"
            >
              <span class="facet-check" :class="{ checked: quickStatusRange === sf.name }" />
              <span class="facet-dot" :style="{ background: sf.color }" />
              <span class="facet-item-label">{{ sf.label }}</span>
              <span class="facet-item-count mono">{{ formatCount(sf.count) }}</span>
            </button>
            <button
              class="facet-item"
              :class="{ active: quickErrorOnly }"
              @click="quickErrorOnly = !quickErrorOnly; search()"
            >
              <span class="facet-check" :class="{ checked: quickErrorOnly }" />
              <span class="facet-dot" style="background: var(--error)" />
              <span class="facet-item-label">Errors only</span>
            </button>
          </div>
        </div>

        <!-- Service facet -->
        <div class="facet-section">
          <div class="facet-header" @click="toggleFacet('service')">
            <span class="facet-chevron" :class="{ collapsed: facetCollapsed['service'] }">&#9662;</span>
            <span class="facet-name">Service</span>
          </div>
          <div v-if="!facetCollapsed['service']" class="facet-body">
            <button
              v-for="sf in serviceFacets"
              :key="sf.name"
              class="facet-item"
              :class="{ active: quickService === sf.name }"
              @click="toggleQuickService(sf.name)"
            >
              <span class="facet-check" :class="{ checked: quickService === sf.name }" />
              <span class="facet-item-label">{{ sf.name }}</span>
              <span class="facet-item-count mono">{{ formatCount(sf.count) }}</span>
            </button>
          </div>
        </div>

        <!-- Method facet (spans only) -->
        <div v-if="viewMode === 'spans'" class="facet-section">
          <div class="facet-header" @click="toggleFacet('method')">
            <span class="facet-chevron" :class="{ collapsed: facetCollapsed['method'] }">&#9662;</span>
            <span class="facet-name">Method</span>
          </div>
          <div v-if="!facetCollapsed['method']" class="facet-body">
            <button
              v-for="mf in methodFacets"
              :key="mf.name"
              class="facet-item"
              :class="{ active: quickMethod === mf.name }"
              @click="toggleQuickMethod(mf.name)"
            >
              <span class="facet-check" :class="{ checked: quickMethod === mf.name }" />
              <span class="facet-item-label">{{ mf.name }}</span>
              <span class="facet-item-count mono">{{ formatCount(mf.count) }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- ═══ Main Content ═══ -->
      <div class="explore-main">

        <div v-if="viewMode === 'spans'" class="apm-result-toolbar">
          <div class="apm-result-toggle" role="group" aria-label="APM result organization">
            <button :class="{ active: apmResultMode === 'individual' }" @click="apmResultMode = 'individual'">Individual spans</button>
            <button :class="{ active: apmResultMode === 'groups' }" @click="apmResultMode = 'groups'">Trace groups <span>{{ traceGroups.length }}</span></button>
          </div>
          <div class="apm-result-actions">
            <span v-if="apmResultMode === 'groups'" class="apm-result-note">Grouped by root service, method, and route</span>
            <button
              class="compare-mode-button"
              :class="{ active: compareModeActive }"
              :aria-pressed="compareModeActive"
              @click="compareModeActive ? closeCompareMode() : openCompareMode()"
            >
              <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4.5h5M10 4.5h5M6 2l2 2.5L6 7M12 11l-2 2.5 2 2.5M3 13.5h5M10 13.5h5"/></svg>
              Compare cohorts
              <span v-if="bubbleUpResult" class="compare-mode-count">{{ compareFindings.length }}</span>
            </button>
          </div>
        </div>

        <!-- Latency over time: inspect spans, select a cohort, then run BubbleUp. -->
        <div v-if="viewMode === 'spans' && apmResultMode === 'individual' && scatterStats.count" class="scatter-card card fade-in" :class="{ collapsed: !scatterExpanded }">
          <button
            class="scatter-disclosure"
            type="button"
            :aria-expanded="scatterExpanded"
            aria-controls="latency-over-time-chart"
            @click="toggleScatterExpanded"
          >
            <span class="scatter-disclosure-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 17l4.5-5 3.5 3 4.5-8 5.5 4"/><circle cx="7.5" cy="12" r="1.5"/><circle cx="15.5" cy="7" r="1.5"/></svg>
            </span>
            <span class="scatter-heading">
              <span class="scatter-title">Latency over time</span>
              <span class="scatter-subtitle">Inspect individual spans and compare slow cohorts.</span>
            </span>
            <span class="scatter-summary" aria-label="Loaded latency percentiles">
              <span><small>P50</small><strong class="mono">{{ formatDuration(scatterStats.p50) }}</strong></span>
              <span><small>P95</small><strong class="mono">{{ formatDuration(scatterStats.p95) }}</strong></span>
              <span><small>P99</small><strong class="mono">{{ formatDuration(scatterStats.p99) }}</strong></span>
              <span v-if="scatterStats.errors" class="scatter-error-count"><small>Errors</small><strong class="mono">{{ scatterStats.errors }}</strong></span>
            </span>
            <span class="scatter-disclosure-action">
              {{ scatterExpanded ? 'Hide chart' : 'Show chart' }}
              <svg :class="{ expanded: scatterExpanded }" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5L6 6.5 11 1.5"/></svg>
            </span>
          </button>

          <div v-if="scatterExpanded" id="latency-over-time-chart" class="scatter-content">
            <div class="scatter-actions">
              <div class="scatter-chart-controls">
                <span class="scatter-instruction">Each dot is a span. Higher dots took longer. Drag to select a cohort.</span>
                <div class="scatter-mode-toggle" role="group" aria-label="Latency chart display">
                  <button :class="{ active: scatterMode === 'dots' }" @click="scatterMode = 'dots'">Dots</button>
                  <button :class="{ active: scatterMode === 'density' }" @click="scatterMode = 'density'">Density</button>
                </div>
              </div>
            <div class="scatter-quick-actions" aria-label="Quick latency analyses">
              <button @click="prepareScatterQuickAnalysis('slow')">Analyze slowest 5%</button>
              <button @click="prepareScatterQuickAnalysis('errors')">Analyze all errors</button>
              <button @click="prepareScatterQuickAnalysis('recent')">Compare before / after</button>
            </div>
            </div>

          <div class="scatter-plot-wrap">
            <svg
              class="scatter-svg"
              :viewBox="`0 0 ${SCATTER_W} ${SCATTER_H}`"
              preserveAspectRatio="none"
              role="img"
              aria-label="Span latency over time. Use pointer drag to select a cohort, or tab to individual dots and press Enter to inspect a span."
              @pointerdown="startScatterBrush"
              @pointermove="moveScatterBrush"
              @pointerup="finishScatterBrush"
              @pointercancel="scatterDragging = false"
            >
              <!-- Slow-tail region above P95. -->
              <rect
                :x="SCATTER_PAD.left" :y="SCATTER_PAD.top"
                :width="SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right"
                :height="Math.max(0, scatterY(scatterStats.p95) - SCATTER_PAD.top)"
                class="scatter-slow-zone"
              />

              <!-- Real axes and logarithmic duration ticks. -->
              <g v-for="tick in scatterYTicks" :key="`y-${tick.value}`">
                <line :x1="SCATTER_PAD.left" :x2="SCATTER_W - SCATTER_PAD.right" :y1="tick.y" :y2="tick.y" class="scatter-grid" />
                <text :x="SCATTER_PAD.left - 10" :y="tick.y + 3" text-anchor="end" class="scatter-axis-label">{{ tick.label }}</text>
              </g>
              <g v-for="tick in scatterXTicks" :key="`x-${tick.x}`">
                <line :x1="tick.x" :x2="tick.x" :y1="SCATTER_PAD.top" :y2="SCATTER_H - SCATTER_PAD.bottom" class="scatter-grid scatter-grid-x" />
                <text :x="tick.x" :y="SCATTER_H - 10" text-anchor="middle" class="scatter-axis-label">{{ tick.label }}</text>
              </g>
              <text x="13" :y="SCATTER_H / 2" text-anchor="middle" class="scatter-axis-title" :transform="`rotate(-90 13 ${SCATTER_H / 2})`">Duration · logarithmic</text>

              <!-- P50/P95/P99 establish the service's current latency context. -->
              <g v-for="line in scatterPercentiles" :key="line.label" :class="`scatter-percentile ${line.cls}`">
                <line :x1="SCATTER_PAD.left" :x2="SCATTER_W - SCATTER_PAD.right" :y1="line.y" :y2="line.y" />
              </g>
              <text :x="SCATTER_PAD.left + 8" :y="SCATTER_PAD.top + 12" class="scatter-slow-label">Slow tail · above P95</text>

              <template v-if="scatterMode === 'dots'">
                <circle
                  v-for="point in scatterPoints"
                  :key="point.row.span_id"
                  :cx="point.x" :cy="point.y" :r="point.error ? 4.4 : 3.2"
                  class="scatter-point"
                  :class="{ error: point.error, selected: scatterSelectedIds.has(point.row.span_id) }"
                  role="button"
                  tabindex="0"
                  :aria-label="scatterPointLabel(point)"
                  @pointerdown.stop
                  @mouseenter="scatterHoverPoint = point"
                  @mouseleave="scatterHoverPoint = null"
                  @focus="scatterHoverPoint = point"
                  @blur="scatterHoverPoint = null"
                  @click.stop="openScatterSpan(point.row)"
                  @keydown.enter.prevent="openScatterSpan(point.row)"
                  @keydown.space.prevent="openScatterSpan(point.row)"
                />
              </template>
              <template v-else>
                <circle
                  v-for="(bin, i) in scatterDensityBins"
                  :key="`density-${i}`"
                  :cx="bin.x" :cy="bin.y" :r="Math.min(15, 3 + Math.sqrt(bin.count) * 2.2)"
                  class="scatter-density"
                  :class="{ error: bin.errors / bin.count >= .5 }"
                  :style="{ opacity: Math.min(.9, .28 + bin.count / 12) }"
                  @pointerdown.stop
                  @mouseenter="scatterHoverDensity = bin"
                  @mouseleave="scatterHoverDensity = null"
                />
              </template>

              <rect
                v-if="scatterBrush"
                :x="Math.min(scatterBrush.x1, scatterBrush.x2)"
                :y="Math.min(scatterBrush.y1, scatterBrush.y2)"
                :width="Math.abs(scatterBrush.x2 - scatterBrush.x1)"
                :height="Math.abs(scatterBrush.y2 - scatterBrush.y1)"
                class="scatter-selection"
              />
            </svg>

            <div v-if="scatterHoverPoint" class="scatter-tooltip" :style="scatterTooltipStyle(scatterHoverPoint.x, scatterHoverPoint.y)">
              <strong>{{ scatterHoverPoint.row.service_name }} · {{ scatterHoverPoint.row.http_method || 'SPAN' }} {{ scatterHoverPoint.row.http_path || '(unknown operation)' }}</strong>
              <span><b>{{ formatDuration(scatterHoverPoint.row.duration_ns) }}</b> duration · {{ scatterHoverPoint.error ? 'error' : `HTTP ${scatterHoverPoint.row.http_status_code || 'ok'}` }}</span>
              <span>{{ formatTimestamp(scatterHoverPoint.row.timestamp) }}</span>
              <em>Click to inspect span</em>
            </div>
            <div v-else-if="scatterHoverDensity" class="scatter-tooltip" :style="scatterTooltipStyle(scatterHoverDensity.x, scatterHoverDensity.y)">
              <strong>{{ scatterHoverDensity.count }} spans in this area</strong>
              <span>{{ formatDuration(scatterHoverDensity.minNs) }}–{{ formatDuration(scatterHoverDensity.maxNs) }}</span>
              <span>{{ scatterHoverDensity.errors }} errors</span>
            </div>
          </div>

          <div class="scatter-footer">
            <div class="scatter-legends">
              <div class="scatter-percentile-legend" aria-label="Latency percentile reference lines">
                <span v-for="line in scatterPercentiles" :key="`legend-${line.label}`">
                  <i :class="`percentile-swatch ${line.cls}`" />
                  <strong>{{ line.label }}</strong>
                  <b class="mono">{{ formatDuration(line.value) }}</b>
                </span>
              </div>
              <div class="scatter-legend">
                <span><i class="legend-dot normal" /> normal span</span>
                <span><i class="legend-dot error" /> error / HTTP 5xx</span>
                <span><i class="legend-dot selected" /> selected</span>
              </div>
            </div>
            <span>Chart uses loaded results; scroll the table to load up to 500 spans.</span>
          </div>

            <div v-if="scatterPendingSelection && scatterSelectionSummary" class="scatter-review" aria-live="polite">
            <div class="scatter-review-copy">
              <span class="scatter-review-kicker">Ready to compare</span>
              <strong>{{ scatterPendingSelection.label }}</strong>
              <p>
                All matching spans in the full query · {{ scatterSelectionSummary.time }} · {{ scatterSelectionSummary.duration }}
                <template v-if="scatterSelectionSummary.count">
                  · loaded preview: {{ scatterSelectionSummary.count }} spans
                  <template v-if="scatterSelectionSummary.errors">, {{ scatterSelectionSummary.errors }} errors</template>
                  across {{ scatterSelectionSummary.services }} service{{ scatterSelectionSummary.services === 1 ? '' : 's' }}
                </template>
              </p>
            </div>
            <div class="scatter-review-actions">
              <button class="scatter-clear" @click="clearScatterSelection">Clear selection</button>
              <button class="scatter-analyze" :disabled="!scatterSelectionSummary.count && !scatterPendingSelection.queryWide" @click="analyzeScatterSelection">Compare with baseline</button>
            </div>
            </div>
          </div>
        </div>

        <!-- ═══ Histogram: waiting / loading / ready ═══ -->
        <div v-if="histogramPhase === 'waiting'" class="histo card" style="min-height:90px;display:flex;align-items:center;justify-content:center">
          <div style="display:flex;align-items:center;gap:10px">
            <svg width="20" height="20" viewBox="0 0 20 20" style="flex-shrink:0"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" stroke-width="2"/><circle cx="10" cy="10" r="8" fill="none" stroke="var(--amber)" stroke-width="2" stroke-dasharray="20 32" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.7s" repeatCount="indefinite"/></circle></svg>
            <span class="text-muted" style="font-size:12px">Graph loads once results are returned&hellip;</span>
          </div>
        </div>
        <div v-else-if="histogramPhase === 'loading'" class="histo card" style="min-height:90px;display:flex;align-items:center;justify-content:center">
          <div style="display:flex;align-items:center;gap:10px">
            <svg width="20" height="20" viewBox="0 0 20 20" style="flex-shrink:0"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" stroke-width="2"/><circle cx="10" cy="10" r="8" fill="none" stroke="var(--amber)" stroke-width="2" stroke-dasharray="20 32" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.7s" repeatCount="indefinite"/></circle></svg>
            <span class="text-muted" style="font-size:12px">Loading graph&hellip;</span>
          </div>
        </div>

        <!-- ═══ Histogram (stacked: ok + errors) ═══ -->
        <div v-else-if="filledHistogram.length" class="histo card fade-in">
          <div class="histo-header">
            <span class="histo-count mono">{{ (viewMode === 'logs' ? logEntries.length : total).toLocaleString() }} events</span>
            <div class="histo-legend">
              <span class="histo-legend-item"><span class="histo-legend-dot histo-dot-ok" /> ok</span>
              <span class="histo-legend-item"><span class="histo-legend-dot histo-dot-err" /> 5xx / error</span>
            </div>
            <span class="histo-range mono text-muted">
              {{ isMultiDayRange() ? timeRange.from.slice(5, 16).replace('T', ' ') : timeRange.from.slice(11, 19) }} &#8212; {{ isMultiDayRange() ? timeRange.to.slice(5, 16).replace('T', ' ') : timeRange.to.slice(11, 19) }}
              <button v-if="customRange" class="histo-reset-btn" @click="customRange = null; search()" title="Reset to preset">&#10005;</button>
            </span>
          </div>
          <div
            ref="histoBarsEl"
            class="histo-bars"
            @mousedown.prevent="onHistoDragStart"
            @mouseleave="onBarLeave"
          >
            <!-- Drag selection overlay -->
            <div
              v-if="dragRange.visible"
              class="histo-drag-overlay"
              :class="{ 'histo-drag-overlay-bubbleup': dragShiftHeld }"
              :style="{ left: dragRange.left + '%', right: dragRange.right + '%' }"
            >
              <span class="drag-label drag-label-start mono">{{ dragRange.fromLabel }}</span>
              <span class="drag-label drag-label-end mono">{{ dragRange.toLabel }}</span>
            </div>
            <!-- BubbleUp persistent selection overlay -->
            <div
              v-if="bubbleUpOverlay.visible && !dragRange.visible"
              class="histo-drag-overlay histo-bubbleup-overlay"
              :style="{ left: bubbleUpOverlay.left + '%', right: bubbleUpOverlay.right + '%' }"
            >
              <span class="drag-label drag-label-start mono">{{ bubbleUpOverlay.fromLabel }}</span>
              <span class="drag-label drag-label-end mono">{{ bubbleUpOverlay.toLabel }}</span>
            </div>
            <div
              v-for="(bucket, i) in filledHistogram"
              :key="i"
              class="histo-col"
              :class="{ 'histo-col-active': hoveredBucket === i }"
              @mouseenter="onBarEnter(i, $event)"
              @mousemove="onBarMove"
              @mouseleave="onBarLeave"
            >
              <div class="histo-stack" :style="{ height: `${(bucket.count / histogramMax) * 100}%` }">
                <div
                  class="histo-bar histo-bar-ok"
                  :style="{ flexBasis: `${((bucket.count - (bucket.error_count || 0)) / bucket.count) * 100}%` }"
                />
                <div
                  v-if="bucket.error_count"
                  class="histo-bar histo-bar-err"
                  :style="{ flexBasis: `${(bucket.error_count / bucket.count) * 100}%` }"
                />
              </div>
            </div>
            <!-- Tooltip -->
            <div
              v-if="hoveredBucketData && !dragActive"
              class="histo-tooltip"
              :style="{ left: `${tooltipX}px`, top: `${tooltipY - 8}px` }"
            >
              <div class="htt-time mono">{{ hoveredBucketData.time }}</div>
              <div class="htt-row">
                <span class="htt-label">Total</span>
                <span class="htt-val mono">{{ hoveredBucketData.total }}</span>
              </div>
              <div class="htt-row">
                <span class="histo-legend-dot histo-dot-ok" />
                <span class="htt-label">OK</span>
                <span class="htt-val mono">{{ hoveredBucketData.ok }}</span>
              </div>
              <div class="htt-row">
                <span class="histo-legend-dot histo-dot-err" />
                <span class="htt-label">Errors</span>
                <span class="htt-val mono htt-err">{{ hoveredBucketData.errors }}</span>
              </div>
              <div class="htt-row htt-rate">
                <span class="htt-label">Error rate</span>
                <span class="htt-val mono" :class="{ 'htt-err': parseFloat(hoveredBucketData.errRate) > 0 }">{{ hoveredBucketData.errRate }}%</span>
              </div>
            </div>
          </div>
          <!-- Shift+drag hint -->
          <div v-if="!bubbleUpSelection && !bubbleUpResult" class="bubbleup-hint text-muted">
            <span class="mono" style="font-size:9px">Shift+drag to analyze dimensions (BubbleUp)</span>
          </div>
        </div>

        <!-- ═══ Logs match histogram (adaptive, click-to-zoom) ═══ -->
        <PanelCard
          v-if="viewMode === 'logs' && (matchHisto.length || matchHistoLoading)"
          class="match-histo fade-in"
          title="Matches over time"
          description="Count of matching log lines per time bucket — click a bar to zoom the range to that window."
        >
          <template #actions>
            <span v-if="matchHistoLoading" class="match-histo-loading text-muted mono">
              <svg width="11" height="11" viewBox="0 0 20 20" style="vertical-align:-1px"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" stroke-width="2"/><circle cx="10" cy="10" r="8" fill="none" stroke="var(--amber)" stroke-width="2" stroke-dasharray="20 32" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.7s" repeatCount="indefinite"/></circle></svg>
              loading&hellip;
            </span>
            <span v-else-if="matchHistoInterval" class="match-histo-meta mono text-muted">
              {{ matchHistoTotal.toLocaleString() }} matches &middot; {{ fmtMatchHistoInterval() }}/bar
            </span>
          </template>
          <div v-if="matchHisto.length" class="match-histo-bars">
            <div
              v-for="(b, i) in matchHisto"
              :key="i"
              class="match-histo-col"
              :title="matchBarTitle(b)"
              @click="onMatchBarClick(b)"
            >
              <div class="match-histo-bar" :style="{ height: `${Math.max((b.count / matchHistoMax) * 100, b.count > 0 ? 6 : 0)}%` }" />
            </div>
          </div>
          <div v-else-if="!matchHistoLoading" class="match-histo-empty text-muted mono">No matches in range</div>
          <div v-if="matchHisto.length" class="match-histo-axis mono text-muted">
            <span>{{ matchHistoRange.from }}</span>
            <span class="match-histo-hint">click a bar to zoom</span>
            <span>{{ matchHistoRange.to }}</span>
          </div>
        </PanelCard>

        <!-- ═══ Loading State (all modes) ═══ -->
        <div v-if="searching" class="empty-state card">
          <svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="none" stroke="var(--border)" stroke-width="2.5"/><circle cx="14" cy="14" r="11" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-dasharray="28 42" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 14 14" to="360 14 14" dur="0.7s" repeatCount="indefinite"/></circle></svg>
          <div>Searching logs...</div>
        </div>

        <!-- ═══ Error / Empty States (spans mode) ═══ -->
        <div v-else-if="api.error.value && viewMode !== 'logs'" class="empty-state card">
          <div class="empty-state-icon status-error">&#10005;</div>
          <div class="mono" style="font-size: 11px">{{ api.error.value }}</div>
        </div>
        <div v-else-if="!results.length && !api.loading.value && viewMode !== 'logs'" class="empty-state card">
          <div class="empty-state-icon">&#9671;</div>
          <div>No events found</div>
          <div class="text-muted" style="font-size: 11px">Try: service_name=gateway http_status_code>=400</div>
        </div>

        <!-- ═══ Trace Groups (root request shapes) ═══ -->
        <div v-else-if="viewMode === 'spans' && apmResultMode === 'groups'" class="trace-groups card fade-in">
          <div class="tg-head"><span>Request shape</span><span>Volume</span><span>Error rate</span><span>p95</span><span>Representative</span></div>
          <button v-for="group in traceGroups" :key="group.key" class="tg-row" @click="openTraceGroup(group)">
            <span class="tg-operation"><b>{{ group.service }}</b><span><i :class="group.method">{{ group.method || 'SPAN' }}</i><code>{{ group.path }}</code></span></span>
            <span class="tg-volume mono">{{ group.count.toLocaleString() }}</span>
            <span class="tg-error mono" :class="{ hot: group.errorRate > 0 }">{{ group.errorRate.toFixed(1) }}%</span>
            <span class="tg-p95 mono" :class="durationClass(group.p95)">{{ formatDuration(group.p95) }}</span>
            <span class="tg-representative mono">{{ group.representative.trace_id.slice(0, 8) }} &rarr;</span>
          </button>
          <div v-if="!traceGroups.length" class="tg-empty">No multi-span traces found in this result set.</div>
        </div>

        <!-- ═══ Event Table (Spans mode) ═══ -->
        <div v-else-if="viewMode === 'spans' && apmResultMode === 'individual'" class="event-table card">
          <!-- Table header -->
          <div class="et-head">
            <div class="et-col et-col-time">Time</div>
            <div class="et-col et-col-svc">Service</div>
            <div class="et-col et-col-method">Method</div>
            <div class="et-col et-col-path">Resource</div>
            <div class="et-col et-col-status">Status</div>
            <div class="et-col et-col-dur">Duration</div>
            <div class="et-col et-col-trace">Trace</div>
          </div>

          <!-- Table rows -->
          <template v-for="(row, i) in results" :key="row.span_id || i">
            <div
              class="et-row"
              :class="{
                'et-selected': modalOpen && modalRowIndex === i,
                'et-kbd-selected': selectedRowIndex === i && !(modalOpen && modalRowIndex === i),
                'et-error': row.status === 'ERROR' || row.http_status_code >= 500,
                'et-live-new': liveNewIds.has(row.span_id),
              }"
              @click="toggleRow(i); selectedRowIndex = i"
            >
              <div class="et-col et-col-time mono" :title="spanTimestampTooltip(row.timestamp)">{{ formatTimestamp(row.timestamp) }}</div>
              <div class="et-col et-col-svc">
                <span
                  class="et-svc-name pivot-value"
                  @click.stop="addFilter('service_name', row.service_name)"
                  @contextmenu="openContextMenu($event, 'service_name', row.service_name, { traceId: row.trace_id, source: 'span' })"
                >{{ row.service_name }}</span>
              </div>
              <div class="et-col et-col-method">
                <span
                  class="method-badge pivot-value"
                  :class="row.http_method"
                  @click.stop="addFilter('http_method', row.http_method)"
                  @contextmenu="openContextMenu($event, 'http_method', row.http_method, { traceId: row.trace_id, source: 'span' })"
                >{{ row.http_method }}</span>
              </div>
              <div class="et-col et-col-path">
                <!-- No click-to-filter on the wide Resource cell: it's what users
                     hit when they mean "open this row", so left-click falls
                     through to the row (trace detail modal). Filtering stays
                     available via the right-click context menu. -->
                <span
                  class="mono"
                  @contextmenu="openContextMenu($event, 'http_path', row.http_path, { traceId: row.trace_id, source: 'span' })"
                >{{ row.http_path }}</span>
              </div>
              <div class="et-col et-col-status">
                <span
                  class="mono pivot-value"
                  :class="statusClass(row.status, row.http_status_code)"
                  @click.stop="row.http_status_code ? addFilter('http_status_code', row.http_status_code) : undefined"
                  @contextmenu="row.http_status_code ? openContextMenu($event, 'http_status_code', row.http_status_code, { traceId: row.trace_id, source: 'span' }) : undefined"
                >{{ row.http_status_code || '\u2014' }}</span>
              </div>
              <div class="et-col et-col-dur">
                <div class="et-dur-bar">
                  <div class="et-dur-fill" :style="{ width: durBarWidth(row.duration_ns), background: durBarColor(row.duration_ns) }" />
                </div>
                <span class="mono" :class="durationClass(row.duration_ns)">{{ formatDuration(row.duration_ns) }}</span>
              </div>
              <div class="et-col et-col-trace">
                <span
                  class="et-trace-link mono"
                  @click.stop="toggleInlineTrace(i, row.trace_id)"
                  @contextmenu="openContextMenu($event, 'trace_id', row.trace_id, { traceId: row.trace_id, source: 'span' })"
                  title="Preview trace inline"
                >{{ row.trace_id.slice(0, 8) }}</span>
              </div>
            </div>
            <!-- Inline Trace Preview -->
            <div v-if="inlineTraceRow === i" class="inline-trace-preview" @click.stop>
              <div v-if="inlineTraceLoading" class="inline-trace-loading">
                <span class="loading-more-spinner">&#9676;</span> Loading trace...
              </div>
              <template v-else-if="inlineTraceData">
                <div class="inline-trace-header">
                  <span class="mono text-muted">{{ inlineTraceData.trace_id.slice(0, 16) }}</span>
                  <span class="mono">{{ inlineTraceData.span_count }} spans</span>
                  <span class="mono">{{ formatDuration(inlineTraceData.duration_ns) }}</span>
                  <span class="mono text-muted">{{ inlineTraceData.services.join(', ') }}</span>
                </div>
                <div class="inline-trace-waterfall">
                  <div
                    v-for="span in flattenSpans(inlineTraceData.spans).slice(0, 20)"
                    :key="span.span_id"
                    class="inline-wf-row"
                    :class="{ 'inline-wf-error': span.status === 'error' || span.http_status_code >= 400 }"
                  >
                    <span class="inline-wf-svc">{{ span.service_name }}</span>
                    <div class="inline-wf-bar-track">
                      <div
                        class="inline-wf-bar"
                        :style="{
                          left: inlineSpanLeft(span, inlineTraceData!),
                          width: inlineSpanWidth(span, inlineTraceData!),
                          background: span.status === 'error' || span.http_status_code >= 400 ? 'var(--error)' : dpServiceColor(span.service_name),
                        }"
                      />
                    </div>
                    <span class="inline-wf-dur mono">{{ formatDuration(span.duration_ns) }}</span>
                  </div>
                </div>
                <router-link :to="`/trace/${inlineTraceData.trace_id}`" class="inline-trace-full-link" @click.stop>
                  View Full Trace &rarr;
                </router-link>
              </template>
              <div v-else class="inline-trace-loading text-muted">Failed to load trace</div>
            </div>
          </template>

          <!-- Infinite scroll sentinel -->
          <div class="scroll-sentinel">
            <div v-if="loadingMore" class="loading-more">
              <span class="loading-more-spinner">&#9676;</span> Loading more…
            </div>
            <div v-else-if="hasMore" class="loading-more text-muted">
              Showing {{ results.length.toLocaleString() }} of {{ total.toLocaleString() }}
            </div>
            <div v-else-if="results.length && !hasMore" class="loading-more text-muted">
              All {{ total.toLocaleString() }} spans loaded
            </div>
          </div>
        </div><!-- /event-table (spans) -->

        <!-- ═══ Log Table (Logs mode) ═══ -->
        <div v-else-if="viewMode === 'logs'" class="event-table card" :class="{ 'log-wrap-mode': logWordWrap }">
          <div v-if="!logEntries.length" class="empty-state" style="padding: var(--sp-6)">
            <div class="empty-state-icon">&#9671;</div>
            <div>No log events found</div>
            <div class="text-muted" style="font-size: 11px">Includes span event logs and collected logs. Try a broader time range or different filters.</div>
          </div>
          <template v-else>
            <!-- Log table header -->
            <div class="et-head">
              <div class="et-col log-col-time">Time</div>
              <div class="et-col log-col-level">Level</div>
              <div class="et-col log-col-svc">Service</div>
              <div class="et-col log-col-msg">
                Message
                <button
                  class="log-wrap-toggle"
                  :class="{ active: logWordWrap }"
                  @click.stop="toggleLogWordWrap"
                  :title="logWordWrap ? 'Disable word wrap' : 'Enable word wrap'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="13 16 11 18 13 20"/><path d="M3 18h7"/>
                  </svg>
                </button>
              </div>
              <div class="et-col log-col-trace">Trace</div>
            </div>
            <!-- Log rows -->
            <template v-for="(entry, i) in logEntries" :key="i">
              <div
                class="et-row"
                :data-log-i="i"
                :class="{
                  'et-selected': inlineExpandedLog === i,
                  'et-kbd-selected': selectedRowIndex === i && inlineExpandedLog !== i,
                  'et-error': entry.level === 'error' || entry.level === 'fatal',
                  'et-deeplink': highlightLogIdx === i,
                }"
                @click="toggleLogRow(i); selectedRowIndex = i"
              >
                <div class="et-col log-col-time mono" :title="timestampTooltip(entry.timestamp)">{{ formatLogTimestamp(entry.timestamp) }}</div>
                <div class="et-col log-col-level">
                  <span
                    class="log-level-badge pivot-value"
                    :class="logLevelClass(entry.level)"
                    @click.stop="addFilter('severity_text', entry.level.toUpperCase())"
                    @contextmenu="openContextMenu($event, 'severity_text', entry.level.toUpperCase(), { traceId: entry.trace_id, source: 'log' })"
                  >{{ entry.level || 'log' }}</span>
                </div>
                <div class="et-col log-col-svc">
                  <span
                    class="et-svc-name pivot-value"
                    @click.stop="addFilter('service_name', entry.service_name)"
                    @contextmenu="openContextMenu($event, 'service_name', entry.service_name, { traceId: entry.trace_id, source: 'log' })"
                  >{{ entry.service_name }}</span>
                </div>
                <div class="et-col log-col-msg mono">{{ entry.message }}</div>
                <div class="et-col log-col-trace">
                  <span
                    v-if="entry.trace_id"
                    class="et-trace-link mono"
                    @click.stop="toggleInlineTraceForLog(i, entry.trace_id)"
                    @contextmenu="openContextMenu($event, 'trace_id', entry.trace_id, { traceId: entry.trace_id, source: 'log' })"
                    title="Preview trace inline"
                  >{{ entry.trace_id.slice(0, 8) }}</span>
                  <span v-else class="text-muted">&mdash;</span>
                </div>
              </div>
              <!-- Inline preview expansion -->
              <div v-if="inlineExpandedLog === i" class="log-inline-detail" @click.stop>
                <div v-if="logDetailLoading.has(entry._sourceLogIndex)" class="loading-more" style="padding: 10px 12px;">
                  <span class="loading-more-spinner">&#9676;</span> Loading full attributes…
                </div>
                <div v-else-if="logDetailErrors.has(entry._sourceLogIndex)" class="loading-more" style="padding: 10px 12px;">
                  Full attributes could not be loaded.
                  <button class="lid-action" @click.stop="hydrateOtelLog(entry)">Retry</button>
                </div>
                <!-- Toolbar -->
                <div class="lid-toolbar">
                  <div class="lid-toolbar-left">
                    <span class="log-level-badge" :class="logLevelClass(entry.level)">{{ entry.level || 'log' }}</span>
                    <span class="lid-svc" @click.stop="addFilter('service_name', entry.service_name)">{{ entry.service_name }}</span>
                    <span class="lid-ts mono">{{ formatLogTimestamp(entry.timestamp) }}</span>
                    <span v-if="entry._source === 'otel'" class="lid-source-tag">collected</span>
                    <span v-else class="lid-source-tag">span event</span>
                  </div>
                  <div class="lid-toolbar-right">
                    <router-link v-if="entry.trace_id" :to="`/trace/${entry.trace_id}`" class="lid-action" @click.stop title="View trace">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      Trace
                    </router-link>
                    <button class="lid-action" :class="{ copied: copiedKey === `json-${i}` }" @click.stop="copyText(JSON.stringify({ service: entry.service_name, level: entry.level, timestamp: entry.timestamp, message: entry.message, trace_id: entry.trace_id, event_attrs: entry.event_attrs, resource_attrs: entry.resource_attrs }, null, 2), `json-${i}`)" :title="copiedKey === `json-${i}` ? 'Copied!' : 'Copy as JSON'">
                      <template v-if="copiedKey === `json-${i}`">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        Copied
                      </template>
                      <template v-else>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        JSON
                      </template>
                    </button>
                    <button v-if="features.sre_agent" class="lid-investigate" @click.stop="investigateLogEntry(entry)" title="Investigate with AI">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                      </svg>
                      Investigate
                    </button>
                  </div>
                </div>

                <!-- Message body -->
                <div v-if="entry.message" class="lid-message">
                  <div class="lid-message-header">
                    <span class="lid-section-label">Message</span>
                    <button class="lid-copy-btn" @click.stop="copyText(entry.message)" title="Copy message">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                  <pre class="lid-body mono">{{ isJsonStr(entry.message) ? prettyJson(entry.message) : entry.message }}</pre>
                </div>

                <!-- Fields + Attributes side by side -->
                <div class="lid-columns">
                  <!-- Core fields -->
                  <div class="lid-col">
                    <div class="lid-section-label">Fields</div>
                    <div class="lid-field-table">
                      <div class="lid-field-row lid-field-clickable" @click.stop="addFilter('service_name', entry.service_name)" @contextmenu="openContextMenu($event, 'service_name', entry.service_name, { traceId: entry.trace_id, source: 'log' })">
                        <span class="lid-field-k">service_name</span>
                        <span class="lid-field-v mono">{{ entry.service_name }}</span>
                        <span class="lid-field-filter-icon" title="Add as filter">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        </span>
                      </div>
                      <div v-if="entry.trace_id" class="lid-field-row">
                        <span class="lid-field-k">trace_id</span>
                        <router-link :to="`/trace/${entry.trace_id}`" class="lid-field-v mono lid-link" @click.stop>{{ entry.trace_id }}</router-link>
                      </div>
                      <div v-if="entry.span_id" class="lid-field-row">
                        <span class="lid-field-k">span_id</span>
                        <span class="lid-field-v mono">{{ entry.span_id }}</span>
                      </div>
                      <div v-if="entry.event_name" class="lid-field-row lid-field-clickable" @click.stop="addFilter('event_name', entry.event_name)">
                        <span class="lid-field-k">event</span>
                        <span class="lid-field-v mono">{{ entry.event_name }}</span>
                        <span class="lid-field-filter-icon" title="Add as filter">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Log attributes -->
                  <div v-if="Object.keys(entry.event_attrs).length" class="lid-col">
                    <div class="lid-section-label">Attributes</div>
                    <div class="lid-field-table">
                      <div v-for="(val, key) in entry.event_attrs" :key="String(key)" class="lid-field-row lid-field-clickable" @click.stop="addFilter(`log.${String(key)}`, String(val))" @contextmenu="openContextMenu($event, `log.${String(key)}`, String(val), { traceId: entry.trace_id, source: 'log' })">
                        <span class="lid-field-k">{{ key }}</span>
                        <span class="lid-field-v mono">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
                        <span class="lid-field-filter-icon" title="Add as filter">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Resource attributes -->
                  <div v-if="Object.keys(entry.resource_attrs).length" class="lid-col">
                    <div class="lid-section-label">Resource</div>
                    <div class="lid-field-table">
                      <div v-for="(val, key) in entry.resource_attrs" :key="String(key)" class="lid-field-row lid-field-clickable" @click.stop="addFilter(`resource.${String(key)}`, String(val))" @contextmenu="openContextMenu($event, `resource.${String(key)}`, String(val), { traceId: entry.trace_id, source: 'log' })">
                        <span class="lid-field-k">{{ key }}</span>
                        <span class="lid-field-v mono">{{ val }}</span>
                        <span class="lid-field-filter-icon" title="Add as filter">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Context + Actions -->
                <div class="lid-footer">
                  <div class="lid-context">
                    <div class="lid-section-label">Context</div>
                    <div class="lid-context-hint">Select attributes to view surrounding logs</div>
                    <div class="lid-context-chips">
                      <button
                        v-for="attr in getContextStreamAttrs(entry)"
                        :key="attr.id"
                        class="lid-ctx-chip"
                        :class="{ 'lid-ctx-chip-on': contextStreamSelectedAttrs.has(attr.id) }"
                        @click.stop="toggleContextAttr(attr.id)"
                      >
                        <span class="lid-ctx-k">{{ attr.label }}</span>
                        <span class="lid-ctx-v">{{ attr.value }}</span>
                      </button>
                    </div>
                    <button
                      v-if="contextStreamSelectedAttrs.size > 0"
                      class="lid-stream-btn"
                      @click.stop="openContextStream(entry)"
                    >View Context Stream &rarr;</button>
                  </div>
                  <div class="lid-actions-row">
                    <button v-if="entry._sourceRowIndex >= 0 || entry.trace_id" class="lid-modal-btn" @click.stop="openLogDetailModal(i)">Open in Modal &rarr;</button>
                  </div>
                </div>
              </div>
              <!-- Inline Trace Preview (log row) -->
              <div v-if="inlineTraceRow === -(i + 1)" class="inline-trace-preview" @click.stop>
                <div v-if="inlineTraceLoading" class="inline-trace-loading">
                  <span class="loading-more-spinner">&#9676;</span> Loading trace...
                </div>
                <template v-else-if="inlineTraceData">
                  <div class="inline-trace-header">
                    <span class="mono text-muted">{{ inlineTraceData.trace_id.slice(0, 16) }}</span>
                    <span class="mono">{{ inlineTraceData.span_count }} spans</span>
                    <span class="mono">{{ formatDuration(inlineTraceData.duration_ns) }}</span>
                    <span class="mono text-muted">{{ inlineTraceData.services.join(', ') }}</span>
                  </div>
                  <div class="inline-trace-waterfall">
                    <div
                      v-for="span in flattenSpans(inlineTraceData.spans).slice(0, 20)"
                      :key="span.span_id"
                      class="inline-wf-row"
                      :class="{ 'inline-wf-error': span.status === 'error' || span.http_status_code >= 400 }"
                    >
                      <span class="inline-wf-svc">{{ span.service_name }}</span>
                      <div class="inline-wf-bar-track">
                        <div
                          class="inline-wf-bar"
                          :style="{
                            left: inlineSpanLeft(span, inlineTraceData!),
                            width: inlineSpanWidth(span, inlineTraceData!),
                            background: span.status === 'error' || span.http_status_code >= 400 ? 'var(--error)' : dpServiceColor(span.service_name),
                          }"
                        />
                      </div>
                      <span class="inline-wf-dur mono">{{ formatDuration(span.duration_ns) }}</span>
                    </div>
                  </div>
                  <router-link :to="`/trace/${inlineTraceData.trace_id}`" class="inline-trace-full-link" @click.stop>
                    View Full Trace &rarr;
                  </router-link>
                </template>
                <div v-else class="inline-trace-loading text-muted">Failed to load trace</div>
              </div>
            </template>

            <!-- Infinite scroll sentinel (logs share the same underlying results) -->
            <div class="scroll-sentinel scroll-sentinel-logs">
              <div v-if="loadingMore" class="loading-more">
                <span class="loading-more-spinner">&#9676;</span> Loading more…
              </div>
              <div v-else-if="hasMore" class="loading-more text-muted">
                {{ logEntries.length.toLocaleString() }} log entries ({{ otelLogs.length.toLocaleString() }} collected + span events)
              </div>
              <div v-else-if="logEntries.length" class="loading-more text-muted">
                {{ logEntries.length.toLocaleString() }} log entries total
              </div>
            </div>
          </template>
        </div><!-- /event-table (logs) -->

      </div><!-- /explore-main -->

      <aside
        v-if="compareModeActive && viewMode === 'spans'"
        class="compare-findings-rail fade-in"
        aria-label="Cohort comparison findings"
      >
        <header class="compare-rail-header">
          <div>
            <span class="compare-rail-kicker">Investigation lens</span>
            <h2>Compare cohorts</h2>
          </div>
          <button class="compare-rail-close" title="Close comparison" aria-label="Close comparison" @click="closeCompareMode">&#10005;</button>
        </header>

        <div v-if="bubbleUpSelection" class="compare-cohort-summary">
          <div class="compare-cohort-row cohort-a">
            <i aria-hidden="true" />
            <div>
              <span>Cohort A</span>
              <strong>{{ compareSelectionLabel }}</strong>
              <small>{{ formatBubbleUpTime(bubbleUpSelection.startTime) }}–{{ formatBubbleUpTime(bubbleUpSelection.endTime) }}</small>
            </div>
            <b v-if="bubbleUpResult" class="mono">{{ bubbleUpResult.selection_count.toLocaleString() }}</b>
          </div>
          <div class="compare-cohort-row cohort-b">
            <i aria-hidden="true" />
            <div>
              <span>Baseline B</span>
              <strong>Everything else</strong>
              <small>Same query and visible time range</small>
            </div>
            <b v-if="bubbleUpResult" class="mono">{{ bubbleUpResult.baseline_count.toLocaleString() }}</b>
          </div>
        </div>

        <div v-if="bubbleUpLoading" class="compare-rail-loading" aria-live="polite">
          <span class="compare-loading-mark" aria-hidden="true" />
          <strong>Comparing dimensions</strong>
          <p>Testing services, operations, routes, status, and infrastructure attributes.</p>
          <div v-for="n in 4" :key="n" class="compare-loading-row"><i /><span /></div>
        </div>

        <div v-else-if="bubbleUpError" class="compare-rail-error" role="alert">
          <strong>Comparison could not run</strong>
          <p>{{ bubbleUpError }}</p>
          <button @click="runBubbleUp">Try again</button>
        </div>

        <template v-else-if="bubbleUpResult">
          <div class="compare-findings-heading">
            <div>
              <span>Ranked evidence</span>
              <strong>{{ compareFindings.length }} meaningful difference{{ compareFindings.length === 1 ? '' : 's' }}</strong>
            </div>
            <small>Selection vs baseline</small>
          </div>

          <div v-if="compareFindings.length" class="compare-findings-list">
            <article v-for="(finding, index) in compareFindings" :key="`${finding.dimension}:${finding.rawValue}`" class="compare-finding">
              <div class="compare-finding-topline">
                <span class="compare-finding-rank mono">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="compare-finding-dimension">{{ finding.dimension }}</span>
                <span class="compare-finding-strength" :class="compareFindingStrength(finding.lift, finding.selectionCount)">
                  {{ compareFindingStrength(finding.lift, finding.selectionCount) }}
                </span>
              </div>
              <strong class="compare-finding-value">{{ finding.value }}</strong>
              <p>{{ compareFindingSummary(finding) }}</p>
              <div class="compare-finding-bars" aria-label="Cohort and baseline prevalence">
                <div><span>A</span><i><b :style="{ width: `${Math.max(2, finding.selectionPct)}%` }" /></i><em>{{ finding.selectionPct.toFixed(0) }}%</em></div>
                <div><span>B</span><i><b :style="{ width: `${Math.max(2, finding.baselinePct)}%` }" /></i><em>{{ finding.baselinePct.toFixed(0) }}%</em></div>
              </div>
              <button class="compare-finding-action" @click="filterToCompareFinding(finding.dimension, finding.rawValue)">
                Filter to this evidence <span aria-hidden="true">&rarr;</span>
              </button>
            </article>
          </div>
          <div v-else class="compare-rail-empty compact">
            <strong>No meaningful dimensional differences</strong>
            <p>The selected cohort resembles the baseline across the dimensions Rush tested.</p>
          </div>

          <footer class="compare-trust-footer">
            <span>Evidence scope</span>
            <p><b>{{ bubbleUpResult.selection_count.toLocaleString() }}</b> selected and <b>{{ bubbleUpResult.baseline_count.toLocaleString() }}</b> baseline events. Rankings combine prevalence difference and supporting event count.</p>
          </footer>
        </template>

        <div v-else class="compare-rail-empty">
          <span class="compare-empty-glyph" aria-hidden="true">A/B</span>
          <strong>Choose the behavior to explain</strong>
          <p>Select an area in Latency over time, or begin with a common incident comparison.</p>
          <div class="compare-starters">
            <button :disabled="!scatterStats.count" @click="runQuickCompare('slow')"><b>Slowest 5%</b><span>vs all faster spans</span></button>
            <button :disabled="!scatterStats.errors" @click="runQuickCompare('errors')"><b>Errors</b><span>vs successful spans</span></button>
            <button :disabled="!scatterStats.count" @click="runQuickCompare('recent')"><b>Recent half</b><span>vs earlier traffic</span></button>
          </div>
          <small>Rush compares the full query, not only the rows currently loaded in the table.</small>
        </div>
      </aside>
    </div><!-- /explore-body -->

    <!-- ═══ Keyboard Shortcuts Overlay ═══ -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showShortcuts" class="kbd-overlay" @click.self="showShortcuts = false">
          <div class="kbd-modal" @click.stop>
            <div class="kbd-header">
              <div class="kbd-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/>
                  <path d="M6 12h.01"/><path d="M10 12h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/>
                  <path d="M8 16h8"/>
                </svg>
                Keyboard Shortcuts
              </div>
              <button class="kbd-close" @click="showShortcuts = false">&times;</button>
            </div>
            <div class="kbd-body">
              <div class="kbd-section">
                <div class="kbd-section-title">Navigation</div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>j</kbd> / <kbd>&darr;</kbd></span><span class="kbd-desc">Next row</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>k</kbd> / <kbd>&uarr;</kbd></span><span class="kbd-desc">Previous row</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>g</kbd><kbd>g</kbd></span><span class="kbd-desc">Jump to first row</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>G</kbd></span><span class="kbd-desc">Jump to last row</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>Enter</kbd></span><span class="kbd-desc">Expand / collapse selected row</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>Esc</kbd></span><span class="kbd-desc">Close panel / clear selection</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>/</kbd></span><span class="kbd-desc">Focus search input</span></div>
              </div>
              <div class="kbd-section">
                <div class="kbd-section-title">View Modes</div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>a</kbd></span><span class="kbd-desc">Switch to APM / spans</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>l</kbd></span><span class="kbd-desc">Switch to Logs</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>t</kbd></span><span class="kbd-desc">Switch to Traces only</span></div>
              </div>
              <div class="kbd-section">
                <div class="kbd-section-title">Actions</div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>r</kbd></span><span class="kbd-desc">Refresh / re-run search</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>w</kbd></span><span class="kbd-desc">Toggle word wrap (logs)</span></div>
                <div class="kbd-row"><span class="kbd-keys"><kbd>?</kbd></span><span class="kbd-desc">Toggle this shortcut overlay</span></div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Export dialog -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showExportDialog" class="export-overlay" @click.self="showExportDialog = false">
          <div class="export-modal" @click.stop>
            <div class="export-header">
              <div class="export-title">Export {{ viewMode === 'logs' ? 'logs' : 'spans' }}</div>
              <button class="export-close" @click="showExportDialog = false">&times;</button>
            </div>
            <div class="export-body">
              <div class="export-field">
                <label class="export-label">Format</label>
                <div class="export-format-toggle">
                  <button :class="{ active: exportFormat === 'csv' }" @click="exportFormat = 'csv'">CSV</button>
                  <button :class="{ active: exportFormat === 'json' }" @click="exportFormat = 'json'">JSON</button>
                </div>
              </div>
              <div class="export-field">
                <label class="export-label">Rows</label>
                <input
                  class="export-rows-input mono"
                  type="number"
                  min="1"
                  :max="exportMaxRows"
                  v-model.number="exportRowCount"
                />
                <div class="export-hint">max {{ exportMaxRows.toLocaleString() }} — set by admin</div>
              </div>
              <div class="export-query mono">{{ currentQueryText() || 'all ' + (viewMode === 'logs' ? 'logs' : 'spans') }}</div>
              <div v-if="exportError" class="export-error">{{ exportError }}</div>
            </div>
            <div class="export-actions">
              <button class="export-cancel" @click="showExportDialog = false" :disabled="exporting">Cancel</button>
              <button class="export-go" @click="doExport" :disabled="exporting || !exportRowCount || exportRowCount < 1">
                {{ exporting ? 'Exporting…' : 'Export' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped src="../styles/views/ExploreView.css"></style>
