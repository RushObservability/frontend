<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import MetricsExplore from '../components/MetricsExplore.vue'
import TimePicker from '../components/TimePicker.vue'
import type { PromVectorResult, PromMatrixResult } from '../types'
import QueryHistory from '../components/QueryHistory.vue'
import { useQueryHistory } from '../composables/useQueryHistory'
import { authenticatedFetch } from '../composables/authSession'
import type { HistoryEntry } from '../composables/useQueryHistory'

interface MetricsHistoryQuery {
  query: string
  timePreset: number
}

const { entries: metricsHistory, push: pushHistory, remove: removeHistory, clear: clearHistory } = useQueryHistory<MetricsHistoryQuery>('rush_metrics_history')

const route = useRoute()
const router = useRouter()
const api = useApi()
// This page queries metric data, so it can't function when the metrics signal
// is disabled for the active tenant. Load the tenant list (if needed) so we
// know whether to show the "needs metrics" notice instead.
const { metricsEnabled, loadTenants: loadTenantSignals, loaded: tenantsLoaded } = useTenant()
if (!tenantsLoaded.value) loadTenantSignals()

// ═══ View mode ═══
const viewMode = ref<'query' | 'explore'>('query')

// ═══ Query state ═══
const query = ref('')
const activeTab = ref<'graph' | 'table'>('graph')
const executing = ref(false)
const errorMsg = ref('')
const queryTextarea = ref<HTMLTextAreaElement | null>(null)

// ═══ Autocomplete ═══
const promqlFunctions = [
  'abs', 'absent', 'avg', 'avg_over_time', 'ceil', 'changes', 'clamp',
  'count', 'count_over_time', 'delta', 'deriv', 'exp', 'floor',
  'histogram_quantile', 'holt_winters', 'idelta', 'increase', 'irate',
  'label_join', 'label_replace', 'ln', 'log2', 'log10',
  'max', 'max_over_time', 'min', 'min_over_time', 'minute',
  'predict_linear', 'quantile', 'quantile_over_time',
  'rate', 'resets', 'round', 'scalar', 'sort', 'sort_desc',
  'sqrt', 'stddev', 'stddev_over_time', 'stdvar', 'stdvar_over_time',
  'sum', 'sum_over_time', 'time', 'timestamp', 'topk', 'bottomk',
  'vector', 'year',
]
const acVisible = ref(false)
const acItems = ref<Array<{ text: string; kind: 'metric' | 'function' | 'label' | 'value' }>>([])
const acSelected = ref(0)
const acWordStart = ref(0)
const acWordEnd = ref(0)

// ═══ Label autocomplete caches ═══
const labelCache = new Map<string, string[]>()
const valueCache = new Map<string, string[]>()

type CursorContext =
  | { mode: 'default' }
  | { mode: 'label'; metric: string }
  | { mode: 'value'; metric: string; label: string }

function parseCursorContext(): CursorContext {
  const el = queryTextarea.value
  if (!el) return { mode: 'default' }
  const pos = el.selectionStart
  const text = query.value.slice(0, pos)

  // Find last unmatched '{' — scan backward counting braces
  let braceDepth = 0
  let bracePos = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '}') braceDepth++
    else if (text[i] === '{') {
      if (braceDepth === 0) { bracePos = i; break }
      braceDepth--
    }
  }
  if (bracePos < 0) return { mode: 'default' }

  // Extract metric name before the '{'
  let metricEnd = bracePos
  let metricStart = metricEnd
  while (metricStart > 0 && /[a-zA-Z0-9_:]/.test(text[metricStart - 1] ?? '')) metricStart--
  const metric = text.slice(metricStart, metricEnd)
  if (!metric) return { mode: 'default' }

  // Text inside braces after the last '{' up to cursor
  const inside = text.slice(bracePos + 1)

  // Find last comma or opening brace — that's the start of the current label matcher
  let segStart = 0
  for (let i = inside.length - 1; i >= 0; i--) {
    if (inside[i] === ',') { segStart = i + 1; break }
  }
  const segment = inside.slice(segStart).trimStart()

  // Check if we're after '=' (value position) or before it (label position)
  const eqIdx = segment.indexOf('=')
  if (eqIdx < 0) {
    // No '=' yet — typing a label name
    return { mode: 'label', metric }
  }

  // After '=' — typing a value. Extract the label name.
  const label = segment.slice(0, eqIdx).replace(/[!~]/g, '').trim()
  return { mode: 'value', metric, label }
}

function getWordAtCursor(): { word: string; start: number; end: number } {
  const el = queryTextarea.value
  if (!el) return { word: '', start: 0, end: 0 }
  const pos = el.selectionStart
  const text = query.value
  const boundary = /[^a-zA-Z0-9_:]/
  let start = pos
  while (start > 0 && !boundary.test(text[start - 1] ?? '')) start--
  let end = pos
  while (end < text.length && !boundary.test(text[end] ?? '')) end++
  return { word: text.slice(start, end), start, end }
}

async function updateAutocomplete() {
  const ctx = parseCursorContext()

  if (ctx.mode === 'label') {
    const { word, start, end } = getWordAtCursor()
    // Fetch labels for this metric (cached)
    let labels = labelCache.get(ctx.metric)
    if (!labels) {
      try {
        labels = await api.promLabels(ctx.metric)
        labelCache.set(ctx.metric, labels)
      } catch { labels = [] }
    }
    const lower = (word || '').toLowerCase()
    const matches: Array<{ text: string; kind: 'label' }> = []
    for (const l of labels) {
      if (l === '__name__') continue
      if (!lower || l.toLowerCase().includes(lower)) matches.push({ text: l, kind: 'label' })
      if (matches.length >= 16) break
    }
    if (!matches.length) { acVisible.value = false; return }
    acItems.value = matches
    acSelected.value = 0
    acWordStart.value = start
    acWordEnd.value = end
    acVisible.value = true
    return
  }

  if (ctx.mode === 'value') {
    const { word, start, end } = getWordAtCursor()
    const cacheKey = `${ctx.metric}:${ctx.label}`
    let values = valueCache.get(cacheKey)
    if (!values) {
      try {
        values = await api.promLabelValues(ctx.label, ctx.metric)
        valueCache.set(cacheKey, values)
      } catch { values = [] }
    }
    // Strip leading quote from typed word for matching
    const raw = (word || '').replace(/^"/, '')
    const lower = raw.toLowerCase()
    const matches: Array<{ text: string; kind: 'value' }> = []
    for (const v of values) {
      if (!lower || v.toLowerCase().includes(lower)) matches.push({ text: v, kind: 'value' })
      if (matches.length >= 16) break
    }
    if (!matches.length) { acVisible.value = false; return }
    acItems.value = matches
    acSelected.value = 0
    acWordStart.value = start
    acWordEnd.value = end
    acVisible.value = true
    return
  }

  // Default mode — metric names + functions
  const { word, start, end } = getWordAtCursor()
  if (word.length < 1) {
    acVisible.value = false
    return
  }
  const lower = word.toLowerCase()
  const matches: Array<{ text: string; kind: 'metric' | 'function' }> = []
  for (const m of metricNames.value) {
    if (m.toLowerCase().includes(lower)) matches.push({ text: m, kind: 'metric' })
    if (matches.length >= 12) break
  }
  for (const f of promqlFunctions) {
    if (f.includes(lower) && !matches.some(i => i.text === f)) {
      matches.push({ text: f, kind: 'function' })
    }
    if (matches.length >= 16) break
  }
  if (!matches.length) {
    acVisible.value = false
    return
  }
  acItems.value = matches
  acSelected.value = 0
  acWordStart.value = start
  acWordEnd.value = end
  acVisible.value = true
}

function acceptAutocomplete(item: { text: string; kind: 'metric' | 'function' | 'label' | 'value' }) {
  let before = query.value.slice(0, acWordStart.value)
  const after = query.value.slice(acWordEnd.value)
  let insertion: string

  if (item.kind === 'value') {
    // Strip any partial quote from before
    if (before.endsWith('"')) before = before.slice(0, -1)
    insertion = `"${item.text}"`
  } else if (item.kind === 'function') {
    insertion = item.text + '('
  } else {
    insertion = item.text
  }

  query.value = before + insertion + after
  acVisible.value = false
  nextTick(() => {
    const el = queryTextarea.value
    if (el) {
      const pos = before.length + insertion.length
      el.selectionStart = el.selectionEnd = pos
      el.focus()
    }
  })
}

// ═══ Time range ═══
const selectedPreset = ref(60)
const customRange = ref<{ from: string; to: string } | null>(null)

// ═══ Smart suggestions ═══
const counterSuffixes = ['_total', '_count', '_bucket', '_sum']
const suggestions = ref<Array<{ label: string; query: string; kind: 'rate' | 'group' }>>([])

function isBareName(q: string): string | null {
  const trimmed = q.trim()
  // Must look like a single metric name (alphanumeric + _ + :), no parens, no braces
  if (!trimmed || /[({}\[\])]/.test(trimmed)) return null
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(trimmed)) return null
  return trimmed
}

function looksLikeCounter(name: string): boolean {
  return counterSuffixes.some(s => name.endsWith(s))
}

async function updateSuggestions() {
  const metric = isBareName(query.value)
  if (!metric || !looksLikeCounter(metric)) {
    suggestions.value = []
    return
  }

  const items: Array<{ label: string; query: string; kind: 'rate' | 'group' }> = []

  // Primary suggestion: wrap in rate()
  items.push({
    label: `rate(${metric}[5m])`,
    query: `rate(${metric}[5m])`,
    kind: 'rate',
  })

  // Fetch labels for group-by suggestions
  let labels = labelCache.get(metric)
  if (!labels) {
    try {
      labels = await api.promLabels(metric)
      labelCache.set(metric, labels)
    } catch { labels = [] }
  }

  const groupLabels = labels.filter(l => l !== '__name__' && l !== 'service_name')
  for (const lbl of groupLabels.slice(0, 4)) {
    items.push({
      label: `sum by (${lbl}) (rate(...[5m]))`,
      query: `sum by (${lbl}) (rate(${metric}[5m]))`,
      kind: 'group',
    })
  }

  suggestions.value = items
}

function applySuggestion(s: { query: string }) {
  query.value = s.query
  suggestions.value = []
  nextTick(() => {
    const el = queryTextarea.value
    if (el) {
      el.selectionStart = el.selectionEnd = s.query.length
      el.focus()
    }
  })
}

// ═══ Helpers data ═══
const metricNames = ref<string[]>([])
const labelNames = ref<string[]>([])
const showMetricDropdown = ref(false)
const metricFilter = ref('')

const filteredMetrics = computed(() => {
  if (!metricFilter.value) return metricNames.value
  const f = metricFilter.value.toLowerCase()
  return metricNames.value.filter(m => m.toLowerCase().includes(f))
})

// ═══ Results ═══
const vectorResults = ref<PromVectorResult[]>([])
const matrixResults = ref<PromMatrixResult[]>([])
const hasResults = ref(false)

// ═══ Chart constants ═══
const chartW = 900
const chartH = 300
const pad = { top: 16, right: 16, bottom: 32, left: 64 }
const innerW = chartW - pad.left - pad.right
const innerH = chartH - pad.top - pad.bottom

const palette = [
  '#3b82f6', '#47b881', '#5b8def', '#e5584f',
  '#a78bfa', '#f59e0b', '#06b6d4', '#ec4899',
]

// ═══ Chart computeds ═══
const yMax = computed(() => {
  let max = 0
  for (const series of matrixResults.value) {
    for (const [, v] of series.values) {
      const n = parseFloat(v)
      if (n > max) max = n
    }
  }
  return max || 1
})

const timeExtent = computed(() => {
  const nowSecs = Math.floor(Date.now() / 1000)
  const startSecs = nowSecs - selectedPreset.value * 60
  return { min: startSecs, max: nowSecs }
})

function scaleX(t: number): number {
  const { min, max } = timeExtent.value
  const range = max - min || 1
  return pad.left + ((t - min) / range) * innerW
}

function scaleY(v: number): number {
  return pad.top + innerH - (v / yMax.value) * innerH
}

function seriesPath(series: PromMatrixResult): string {
  if (!series.values.length) return ''
  let d = ''
  for (let i = 0; i < series.values.length; i++) {
    const [t, v] = series.values[i]!
    const x = scaleX(t)
    const y = scaleY(parseFloat(v))
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`
  }
  return d
}

function seriesAreaPath(series: PromMatrixResult): string {
  if (!series.values.length) return ''
  const baseline = pad.top + innerH
  let d = `M${scaleX(series.values[0]![0])},${baseline}`
  for (const [t, v] of series.values) {
    d += ` L${scaleX(t)},${scaleY(parseFloat(v))}`
  }
  d += ` L${scaleX(series.values[series.values.length - 1]![0])},${baseline} Z`
  return d
}

function seriesLabel(metric: Record<string, string>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(metric)) {
    if (k === '__name__') continue
    parts.push(`${k}="${v}"`)
  }
  const name = metric.__name__ || ''
  if (!parts.length) return name || '{}'
  return name ? `${name}{${parts.join(', ')}}` : `{${parts.join(', ')}}`
}

const yTicks = computed(() => {
  const max = yMax.value
  const ticks: Array<{ label: string; y: number }> = []
  const steps = [0, 0.25, 0.5, 0.75, 1]
  for (const s of steps) {
    const val = max * s
    ticks.push({ label: formatCompact(val), y: scaleY(val) })
  }
  return ticks
})

const xLabels = computed(() => {
  const { min, max } = timeExtent.value
  if (min === max) return []
  const labels: Array<{ label: string; x: number }> = []
  const count = 6
  for (let i = 0; i <= count; i++) {
    const t = min + (i / count) * (max - min)
    const d = new Date(t * 1000)
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    labels.push({ label: `${h}:${m}`, x: scaleX(t) })
  }
  return labels
})

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(1)
  if (n > 0) return n.toFixed(3)
  return '0'
}

// ═══ Hover tooltip ═══
const chartContainer = ref<HTMLElement | null>(null)
const hoverVisible = ref(false)
const hoverX = ref(0)          // SVG x coordinate for crosshair
const hoverTime = ref(0)       // Unix timestamp at cursor
const hoverTooltipX = ref(0)   // pixel x for tooltip div
const hoverTooltipY = ref(0)   // pixel y for tooltip div
const hoverValues = ref<Array<{ label: string; value: string; color: string; y: number }>>([])
const hoverTimeLabel = ref('')
const tooltipFlipped = ref(false)
const chartContainerWidth = ref(0)

function handleChartMouseMove(e: MouseEvent) {
  const svg = (chartContainer.value?.querySelector('.metrics-chart') as SVGSVGElement | null)
  if (!svg || !matrixResults.value.length) return

  const rect = svg.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const svgX = (mouseX / rect.width) * chartW

  // Clamp to chart area
  if (svgX < pad.left || svgX > chartW - pad.right) {
    hoverVisible.value = false
    return
  }

  // Convert SVG x back to time
  const { min, max } = timeExtent.value
  const range = max - min || 1
  const t = min + ((svgX - pad.left) / innerW) * range

  hoverX.value = svgX
  hoverTime.value = t

  // Format time
  const d = new Date(t * 1000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  hoverTimeLabel.value = `${hh}:${mm}:${ss}`

  // Find nearest value for each series
  const vals: Array<{ label: string; value: string; color: string; y: number }> = []
  for (let si = 0; si < matrixResults.value.length; si++) {
    const series = matrixResults.value[si]!
    if (!series.values.length) continue
    // Binary search for nearest timestamp
    let lo = 0, hi = series.values.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (series.values[mid]![0] < t) lo = mid + 1
      else hi = mid
    }
    // Check neighbors to find closest
    let best = lo
    if (best > 0 && Math.abs(series.values[best - 1]![0] - t) < Math.abs(series.values[best]![0] - t)) {
      best = best - 1
    }
    const v = parseFloat(series.values[best]![1])
    vals.push({
      label: seriesLabel(series.metric),
      value: formatCompact(v),
      color: palette[si % palette.length]!,
      y: scaleY(v),
    })
  }
  hoverValues.value = vals

  // Position tooltip in pixel space, flip if near right edge
  hoverTooltipX.value = e.clientX - rect.left
  hoverTooltipY.value = e.clientY - rect.top
  chartContainerWidth.value = rect.width
  tooltipFlipped.value = hoverTooltipX.value > rect.width * 0.65
  hoverVisible.value = true
}

function handleChartMouseLeave() {
  hoverVisible.value = false
}

// ═══ Table helpers ═══
function labelBadges(metric: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([key, value]) => ({ key, value }))
}

// ═══ Execute query ═══
async function executeQuery(opts?: { skipHistory?: boolean }) {
  if (!query.value.trim()) return

  // If it's a bare counter metric, show suggestions alongside results
  const bare = isBareName(query.value)
  if (bare && looksLikeCounter(bare)) {
    updateSuggestions()
  } else {
    suggestions.value = []
  }

  if (!opts?.skipHistory) {
    pushHistory({ query: query.value, timePreset: selectedPreset.value })
  }

  executing.value = true
  errorMsg.value = ''
  vectorResults.value = []
  matrixResults.value = []
  hasResults.value = false

  try {
    if (activeTab.value === 'table') {
      const data = await api.promQuery(query.value)
      if (data.resultType === 'vector') {
        vectorResults.value = data.result
      }
    } else {
      const now = Math.floor(Date.now() / 1000)
      const start = now - selectedPreset.value * 60
      const step = Math.max(1, Math.floor((now - start) / 250))
      const data = await api.promQueryRange(query.value, start, now, step)
      if (data.resultType === 'matrix') {
        matrixResults.value = data.result
      }
    }
    hasResults.value = true
  } catch (e: any) {
    errorMsg.value = e.message || 'Query failed'
  } finally {
    executing.value = false
  }
  syncUrlState()
}

function clearQuery() {
  query.value = ''
  vectorResults.value = []
  matrixResults.value = []
  hasResults.value = false
  errorMsg.value = ''
  suggestions.value = []
  syncUrlState()
}

function loadHistoryEntry(entry: HistoryEntry<MetricsHistoryQuery>) {
  query.value = entry.query.query
  selectedPreset.value = entry.query.timePreset
  executeQuery({ skipHistory: true })
}

function createAlertFromQuery() {
  const q = encodeURIComponent(query.value.trim())
  router.push(`/alerts/rules/add?promql=${q}&signal=metrics`)
}

function seriesPromql(metric: Record<string, string>): string {
  const name = metric.__name__ || ''
  const labels = Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  const selector = name + (labels ? `{${labels}}` : '')
  if (looksLikeCounter(name)) return `rate(${selector}[5m])`
  return selector
}

function createAlertFromSeries(metric: Record<string, string>) {
  const q = encodeURIComponent(seriesPromql(metric))
  router.push(`/alerts/rules/add?promql=${q}&signal=metrics`)
}

function handleExploreSelect(_metric: string, queryStr: string) {
  query.value = queryStr
  viewMode.value = 'query'
  activeTab.value = 'graph'
  nextTick(() => executeQuery())
}

function insertMetric(name: string) {
  query.value = name
  showMetricDropdown.value = false
  metricFilter.value = ''
}

function handleQueryKeydown(e: KeyboardEvent) {
  if (acVisible.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      acSelected.value = (acSelected.value + 1) % acItems.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      acSelected.value = (acSelected.value - 1 + acItems.value.length) % acItems.value.length
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      const item = acItems.value[acSelected.value]
      if (item) acceptAutocomplete(item)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      acVisible.value = false
      return
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    executeQuery()
  }
}

function handleQueryInput() {
  updateAutocomplete()
}

function handleQueryBlur() {
  window.setTimeout(() => { acVisible.value = false }, 150)
}

// ═══ Natural language to PromQL ═══
const nlMode = ref(false)
const nlInput = ref('')
const nlLoading = ref(false)
const nlResult = ref('')
const nlConfidence = ref(0)

function enterNlMode() {
  nlMode.value = true
  nlInput.value = ''
  nlResult.value = ''
  nlConfidence.value = 0
  nextTick(() => queryTextarea.value?.focus())
}

function exitNlMode() {
  nlMode.value = false
  nlInput.value = ''
  nlResult.value = ''
}

function nlRuleFallback(input: string): string | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  // Extract window: "over 5min", "over 1h", "5m window", "last 10m"
  const windowMatch = s.match(/(?:over|last|window|past)\s+(\d+)\s*(min(?:utes?)?|m|h(?:ours?)?|s(?:econds?)?)/)
  const windowNum = windowMatch ? windowMatch[1] : '5'
  const windowUnit = windowMatch
    ? (windowMatch[2]?.startsWith('h') ? 'h' : windowMatch[2]?.startsWith('s') ? 's' : 'm')
    : 'm'
  const window = `[${windowNum}${windowUnit}]`

  // Extract metric name — last bare word that looks like a metric
  const metricMatch = s.match(/(?:for|of|on|metric)\s+([a-z_:][a-z0-9_:]*)/) ||
                      s.match(/([a-z_:][a-z0-9_:]{3,})(?:\s|$)/)
  const metric = metricMatch ? metricMatch[1] : null

  if (!metric) return null

  // p99 / p95 / p50
  const pMatch = s.match(/p(99|95|90|75|50)/)
  if (pMatch) {
    const q = Number(pMatch[1]) / 100
    return `histogram_quantile(${q}, rate(${metric}_bucket${window}))`
  }

  // rate
  if (s.includes('rate') || s.includes('per second') || s.includes('rps')) {
    const sumByMatch = s.match(/(?:by|per|group by|grouped by)\s+([a-z_][a-z0-9_]*)/)
    if (sumByMatch) return `sum by (${sumByMatch[1]}) (rate(${metric}${window}))`
    return `rate(${metric}${window})`
  }

  // increase
  if (s.includes('increase') || s.includes('total over') || s.includes('delta')) {
    return `increase(${metric}${window})`
  }

  // sum
  if (s.includes('sum') || s.includes('total')) {
    const sumByMatch = s.match(/(?:by|per|group by|grouped by)\s+([a-z_][a-z0-9_]*)/)
    if (sumByMatch) return `sum by (${sumByMatch[1]}) (${metric})`
    return `sum(${metric})`
  }

  // avg / average
  if (s.includes('avg') || s.includes('average')) {
    return `avg(${metric})`
  }

  // count
  if (s.includes('count')) return `count(${metric})`

  // max / min
  if (s.includes('max')) return `max(${metric})`
  if (s.includes('min')) return `min(${metric})`

  // topk
  const topkMatch = s.match(/top\s*(\d+)/)
  if (topkMatch) return `topk(${topkMatch[1]}, ${metric})`

  return null
}

async function translateNl() {
  if (!nlInput.value.trim()) return
  nlLoading.value = true
  nlResult.value = ''
  nlConfidence.value = 0

  try {
    const res = await authenticatedFetch('/api/v1/parse-promql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: nlInput.value, metric_names: metricNames.value.slice(0, 100) }),
    })
    if (res.ok) {
      const data = await res.json()
      nlResult.value = data.promql ?? ''
      nlConfidence.value = data.confidence ?? 0
      return
    }
  } catch { /* fall through to rule-based */ }

  // Rule-based fallback
  const fallback = nlRuleFallback(nlInput.value)
  if (fallback) {
    nlResult.value = fallback
    nlConfidence.value = 0.6
  }
  nlLoading.value = false
}

let nlDebounceTimer: ReturnType<typeof setTimeout> | null = null
function onNlInput() {
  if (nlDebounceTimer) clearTimeout(nlDebounceTimer)
  nlResult.value = ''
  nlConfidence.value = 0
  const rule = nlRuleFallback(nlInput.value)
  if (rule) { nlResult.value = rule; nlConfidence.value = 0.6 }
  nlDebounceTimer = setTimeout(translateNl, 600)
}

function applyNl() {
  if (!nlResult.value) return
  query.value = nlResult.value
  exitNlMode()
  nextTick(() => executeQuery())
}

function onNlKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && nlResult.value) { e.preventDefault(); applyNl() }
  if (e.key === 'Escape') { e.preventDefault(); exitNlMode() }
}

function toggleNlMode() {
  if (nlMode.value) { exitNlMode() } else { enterNlMode() }
}

function handleUnifiedInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  if (nlMode.value) {
    nlInput.value = val
    onNlInput()
  } else {
    query.value = val
    handleQueryInput()
  }
}

function handleUnifiedKeydown(e: KeyboardEvent) {
  if (nlMode.value) { onNlKeydown(e) } else { handleQueryKeydown(e) }
}

// ═══ Load helpers ═══
async function loadHelpers() {
  try {
    const [namesResult, labelsResult] = await Promise.allSettled([
      api.promLabelValues('__name__'),
      api.promLabels(),
    ])
    if (namesResult.status === 'fulfilled') {
      metricNames.value = namesResult.value.sort()
    }
    if (labelsResult.status === 'fulfilled') {
      labelNames.value = labelsResult.value.filter(l => l !== '__name__').sort()
    }
  } catch { /* helpers optional */ }
}

// ═══ Share link ═══
const shareCopied = ref(false)

function buildShareUrl(): string {
  const params = new URLSearchParams()
  if (query.value) params.set('q', query.value)
  if (activeTab.value !== 'graph') params.set('tab', activeTab.value)
  if (selectedPreset.value !== 60) params.set('t', String(selectedPreset.value))
  if (viewMode.value !== 'query') params.set('mode', viewMode.value)
  const qs = params.toString()
  return `${window.location.origin}/metrics${qs ? '?' + qs : ''}`
}

function syncUrlState() {
  const params: Record<string, string> = {}
  if (query.value) params.q = query.value
  if (activeTab.value !== 'graph') params.tab = activeTab.value
  if (selectedPreset.value !== 60) params.t = String(selectedPreset.value)
  if (viewMode.value !== 'query') params.mode = viewMode.value
  router.replace({ path: '/metrics', query: Object.keys(params).length ? params : undefined })
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
  if (q.q) query.value = String(q.q)
  if (q.tab === 'table') activeTab.value = 'table'
  if (q.t) selectedPreset.value = Number(q.t) || 60
  if (q.mode === 'explore') viewMode.value = 'explore'
}

onMounted(() => {
  labelCache.clear()
  valueCache.clear()
  restoreFromUrl()
  loadHelpers()
  if (query.value.trim()) executeQuery()
})

// Re-execute on tab or time range change if we have a query
watch([activeTab, selectedPreset], () => {
  if (hasResults.value && query.value.trim()) {
    executeQuery()
  } else {
    syncUrlState()
  }
})

watch(viewMode, () => {
  syncUrlState()
})
</script>

<template>
  <div class="metrics-view">
    <!-- ═══ Header ═══ -->
    <div class="metrics-header">
      <h1 class="metrics-title">Metrics</h1>
      <div class="metrics-controls">
        <TimePicker v-model="selectedPreset" v-model:custom-range="customRange" />
        <button class="share-btn" @click="shareLink" :title="shareCopied ? 'Copied!' : 'Copy shareable link'">
          {{ shareCopied ? '&#10003; Copied' : '&#128279; Share' }}
        </button>
      </div>
    </div>

    <!-- Metrics-disabled notice: this page queries metric data. -->
    <div v-if="!metricsEnabled" class="empty-state card">
      <div class="empty-state-icon">&#9888;</div>
      <div>Metrics are disabled for this tenant</div>
      <div class="metrics-notice-sub">
        This page queries metric data. Enable the Metrics signal for this tenant
        in Settings &rsaquo; Tenants to run PromQL queries and explore metrics.
      </div>
    </div>

    <!-- ═══ Mode Toggle ═══ -->
    <div v-if="metricsEnabled" class="mode-bar">
      <button
        class="mode-btn"
        :class="{ active: viewMode === 'query' }"
        @click="viewMode = 'query'"
      >
        Query
      </button>
      <button
        class="mode-btn"
        :class="{ active: viewMode === 'explore' }"
        @click="viewMode = 'explore'"
      >
        Explore
      </button>
    </div>

    <!-- ═══ Explore Mode ═══ -->
    <MetricsExplore
      v-if="metricsEnabled && viewMode === 'explore'"
      :metric-names="metricNames"
      :time-preset="selectedPreset"
      @select="handleExploreSelect"
    />

    <!-- ═══ Query Bar ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query'" class="query-section card">
      <div class="query-row">
        <div class="query-input-wrapper">
          <textarea
            ref="queryTextarea"
            :value="nlMode ? nlInput : query"
            class="query-input mono"
            :class="{ 'nl-active': nlMode }"
            :placeholder="nlMode ? 'Describe what you want to query... (Enter to apply, Esc to cancel)' : 'Enter a PromQL expression...'"
            rows="2"
            @input="handleUnifiedInput"
            @keydown="handleUnifiedKeydown"
            @blur="handleQueryBlur"
          ></textarea>
          <!-- ✦ AI button overlaid inside textarea -->
          <button
            class="nl-inline-btn"
            :class="{ active: nlMode }"
            @mousedown.prevent="toggleNlMode"
            :title="nlMode ? 'Exit AI mode (Esc)' : 'AI: describe in plain English'"
          >✦</button>
          <!-- NL spinner -->
          <span v-if="nlMode && nlLoading" class="nl-inline-spinner">···</span>
          <!-- Autocomplete dropdown (PromQL mode only) -->
          <div v-if="!nlMode && acVisible && acItems.length" class="ac-dropdown">
            <div
              v-for="(item, idx) in acItems"
              :key="item.text"
              class="ac-item mono"
              :class="{ selected: idx === acSelected }"
              @mousedown.prevent="acceptAutocomplete(item)"
            >
              <span class="ac-kind" :class="item.kind">{{ { function: 'fn', metric: 'm', label: 'l', value: 'v' }[item.kind] }}</span>
              <span>{{ item.text }}</span>
            </div>
          </div>
        </div>
        <div class="query-actions">
          <button class="btn btn-execute" @click="() => nlMode ? applyNl() : executeQuery()" :disabled="executing || (nlMode ? !nlResult : !query.trim())">
            {{ executing ? 'Running...' : 'Execute' }}
          </button>
          <button class="btn btn-clear" @click="clearQuery" :disabled="!query">
            Clear
          </button>
          <button
            v-if="query.trim()"
            class="btn btn-alert"
            title="Create alert from this query"
            @click="createAlertFromQuery"
          >&#9888; Alert</button>
          <QueryHistory
            :entries="metricsHistory ?? []"
            @load="loadHistoryEntry"
            @remove="removeHistory"
            @clear="clearHistory"
          >
            <template #summary="{ entry }">
              <span class="mono">{{ entry.query.query.length > 50 ? entry.query.query.slice(0, 50) + '...' : entry.query.query }}</span>
            </template>
          </QueryHistory>
        </div>
      </div>

      <!-- NL preview -->
      <div v-if="nlMode && nlResult" class="nl-preview">
        <span class="nl-preview-label">✦</span>
        <code class="nl-preview-expr mono">{{ nlResult }}</code>
        <span v-if="nlConfidence >= 0.7" class="nl-conf high">high confidence</span>
        <span v-else-if="nlConfidence >= 0.5" class="nl-conf mid">best guess</span>
        <button class="btn btn-execute nl-apply-btn" @click="applyNl">Apply →</button>
      </div>

      <!-- Helper bar -->
      <div class="helper-bar">
        <div class="helper-group">
          <div class="metric-dropdown-wrapper">
            <button class="helper-btn" @click="showMetricDropdown = !showMetricDropdown">
              Metrics &#9662;
            </button>
            <div v-if="showMetricDropdown" class="metric-dropdown">
              <input
                v-model="metricFilter"
                class="metric-search mono"
                placeholder="Filter metrics..."
              />
              <div class="metric-list">
                <div
                  v-for="m in filteredMetrics"
                  :key="m"
                  class="metric-item mono"
                  @click="insertMetric(m)"
                >
                  {{ m }}
                </div>
                <div v-if="!filteredMetrics.length" class="metric-empty">
                  No metrics found
                </div>
              </div>
            </div>
          </div>
          <div v-if="labelNames.length" class="label-hints">
            <span class="label-hint-label">Labels:</span>
            <span v-for="l in labelNames.slice(0, 8)" :key="l" class="label-badge mono">{{ l }}</span>
            <span v-if="labelNames.length > 8" class="label-hint-more">+{{ labelNames.length - 8 }} more</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Smart Suggestions ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query' && suggestions.length" class="suggestions-bar card">
      <span class="suggestions-label">Suggestions</span>
      <div class="suggestions-list">
        <button
          v-for="(s, i) in suggestions"
          :key="i"
          class="suggestion-chip mono"
          :class="s.kind"
          @click="applySuggestion(s)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <!-- ═══ Tab Toggle ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query'" class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'graph' }"
        @click="activeTab = 'graph'"
      >
        Graph
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'table' }"
        @click="activeTab = 'table'"
      >
        Table
      </button>
    </div>

    <!-- ═══ Error ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query' && errorMsg" class="error-banner card">
      <span class="error-icon">&#9888;</span>
      <span class="mono">{{ errorMsg }}</span>
    </div>

    <!-- ═══ Graph Tab ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query' && activeTab === 'graph'" class="results-panel card">
      <div v-if="!hasResults" class="empty-state">
        <div class="empty-state-icon">&#9707;</div>
        <div>Enter a PromQL query and click Execute</div>
      </div>
      <div v-else-if="!matrixResults.length" class="empty-state">
        <div class="empty-state-icon">&#9676;</div>
        <div>No data returned</div>
      </div>
      <template v-else>
        <div ref="chartContainer" class="chart-container" @mousemove="handleChartMouseMove" @mouseleave="handleChartMouseLeave">
          <svg :viewBox="`0 0 ${chartW} ${chartH}`" class="metrics-chart" preserveAspectRatio="xMidYMid meet">
            <!-- Grid lines -->
            <template v-for="tick in yTicks" :key="'yt' + tick.label">
              <line :x1="pad.left" :y1="tick.y" :x2="chartW - pad.right" :y2="tick.y" class="grid-line" />
              <text :x="pad.left - 6" :y="tick.y + 3" class="axis-label" text-anchor="end">{{ tick.label }}</text>
            </template>
            <!-- X labels -->
            <template v-for="lbl in xLabels" :key="'xl' + lbl.label">
              <text :x="lbl.x" :y="chartH - 4" class="axis-label" text-anchor="middle">{{ lbl.label }}</text>
            </template>
            <!-- Series -->
            <template v-for="(series, idx) in matrixResults" :key="'s' + idx">
              <path :d="seriesAreaPath(series)" :fill="palette[idx % palette.length]" fill-opacity="0.08" />
              <path :d="seriesPath(series)" fill="none" :stroke="palette[idx % palette.length]" stroke-width="1.5" />
            </template>
            <!-- Crosshair + dots -->
            <template v-if="hoverVisible">
              <line :x1="hoverX" :y1="pad.top" :x2="hoverX" :y2="pad.top + innerH" class="crosshair-line" />
              <circle
                v-for="(v, vi) in hoverValues"
                :key="'dot' + vi"
                :cx="hoverX"
                :cy="v.y"
                r="3.5"
                :fill="v.color"
                stroke="var(--bg-surface)"
                stroke-width="1.5"
                class="crosshair-dot"
              />
            </template>
          </svg>
          <!-- Tooltip -->
          <div
            v-if="hoverVisible"
            class="chart-tooltip"
            :class="{ 'tooltip-left': tooltipFlipped }"
            :style="{
              left: tooltipFlipped ? undefined : hoverTooltipX + 12 + 'px',
              right: tooltipFlipped ? (chartContainerWidth - hoverTooltipX + 12) + 'px' : undefined,
              top: hoverTooltipY - 10 + 'px',
            }"
          >
            <div class="tooltip-time mono">{{ hoverTimeLabel }}</div>
            <div v-for="v in hoverValues" :key="v.label" class="tooltip-row">
              <span class="tooltip-swatch" :style="{ background: v.color }"></span>
              <span class="tooltip-label mono">{{ v.label }}</span>
              <span class="tooltip-value mono">{{ v.value }}</span>
            </div>
          </div>
        </div>
        <!-- Legend -->
        <div class="chart-legend">
          <div v-for="(series, idx) in matrixResults" :key="'l' + idx" class="legend-item">
            <span class="legend-swatch" :style="{ background: palette[idx % palette.length] }"></span>
            <span class="legend-text mono">{{ seriesLabel(series.metric) }}</span>
            <button
              class="legend-alert-btn"
              title="Create alert for this series"
              @click.stop="createAlertFromSeries(series.metric)"
            >&#9888; Alert</button>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══ Table Tab ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query' && activeTab === 'table'" class="results-panel card">
      <div v-if="!hasResults" class="empty-state">
        <div class="empty-state-icon">&#9707;</div>
        <div>Enter a PromQL query and click Execute</div>
      </div>
      <div v-else-if="!vectorResults.length" class="empty-state">
        <div class="empty-state-icon">&#9676;</div>
        <div>No data returned</div>
      </div>
      <table v-else class="result-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Labels</th>
            <th class="col-value">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in vectorResults" :key="i">
            <td class="mono metric-name">{{ r.metric.__name__ || '-' }}</td>
            <td>
              <div class="label-badges">
                <span
                  v-for="b in labelBadges(r.metric)"
                  :key="b.key"
                  class="tbl-label-badge mono"
                >
                  {{ b.key }}=<span class="label-val">{{ b.value }}</span>
                </span>
              </div>
            </td>
            <td class="mono col-value">{{ r.value[1] }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped src="../styles/views/MetricsView.css"></style>
