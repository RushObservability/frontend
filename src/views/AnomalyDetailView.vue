<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import InvestigationPanel from '../components/InvestigationPanel.vue'
import PanelCard from '../components/PanelCard.vue'
import type { AnomalyRule, AnomalyEvent, CorrelationResponse, LogRecord, RushEvent, TimeseriesBucket } from '../types'

const props = defineProps<{ ruleId: string }>()
const route = useRoute()
const router = useRouter()
const api = useApi()

// ═══ State ═══
const rule = ref<AnomalyRule | null>(null)
const events = ref<AnomalyEvent[]>([])
const loading = ref(true)
const chartData = ref<ChartSeries[]>([])
const focusedEventId = ref<string | null>(route.query.event as string | null)
const individualEvent = ref<AnomalyEvent | null>(null) // fetched when not in events list
const cursorFraction = ref<number | null>(null)
const cursorX = ref<number | null>(null)
const correlations = ref<CorrelationResponse | null>(null)

interface ChartSeries {
  name: string
  query: string
  timestamps: number[]
  values: number[]
  labels?: Record<string, string>
  bands: { ewma: number[]; upper: number[]; lower: number[]; anomalies: boolean[] }
  maxVal: number
  anomalyCount: number
}

// ═══ Time ranges ═══
const TIME_RANGES = [
  { label: '1h', seconds: 3600, step: 15 },
  { label: '3h', seconds: 10800, step: 30 },
  { label: '6h', seconds: 21600, step: 60 },
  { label: '12h', seconds: 43200, step: 120 },
  { label: '24h', seconds: 86400, step: 300 },
] as const

const selectedRange = ref(1) // default 3h

const COUNTER_SUFFIXES = ['_total', '_count', '_sum', '_bucket', '_created']
function isCounter(name: string): boolean {
  return COUNTER_SUFFIXES.some(s => name.endsWith(s))
}

function buildQuery(name: string, labels?: string[]): string {
  if (labels?.length) {
    const by = labels.join(', ')
    return isCounter(name) ? `sum by (${by})(rate(${name}[5m]))` : `sum by (${by})(${name})`
  }
  return isCounter(name) ? `sum(rate(${name}[5m]))` : `sum(${name})`
}

// ═══ EWMA ═══
function computeBands(data: number[], a: number, sens: number) {
  const ewma: number[] = [], upper: number[] = [], lower: number[] = [], anomalies: boolean[] = []
  const WARMUP = 12
  let sum = 0
  for (let i = 0; i < WARMUP && i < data.length; i++) sum += data[i]!
  let mean = sum / Math.min(WARMUP, data.length)
  let varSum = 0
  for (let i = 0; i < WARMUP && i < data.length; i++) varSum += (data[i]! - mean) ** 2
  let variance = varSum / Math.min(WARMUP, data.length)
  const minVar = variance * 0.3
  for (let i = 0; i < data.length; i++) {
    const std = Math.sqrt(variance)
    const hi = mean + sens * std
    const lo = Math.max(0, mean - sens * std)
    ewma.push(mean); upper.push(hi); lower.push(lo)
    const isAnomaly = i >= WARMUP && (data[i]! > hi || data[i]! < lo)
    anomalies.push(isAnomaly)
    if (i > 0 && !isAnomaly) {
      const diff = data[i]! - mean
      mean = a * data[i]! + (1 - a) * mean
      const va = a * 0.25
      variance = Math.max(va * diff * diff + (1 - va) * variance, minVar)
    }
  }
  return { ewma, upper, lower, anomalies }
}

function countAnomalyStreaks(flags: boolean[]): number {
  let count = 0, inStreak = false
  for (const f of flags) {
    if (f && !inStreak) { count++; inStreak = true }
    else if (!f) inStreak = false
  }
  return count
}

// ═══ Data loading ═══
async function loadRule() {
  loading.value = true
  try {
    const resp = await api.getAnomalyRule(props.ruleId)
    rule.value = resp.rule
    events.value = resp.events
  } catch {
    rule.value = null
    events.value = []
  } finally {
    loading.value = false
  }
}

async function fetchChart() {
  if (!rule.value) return

  const focusedEvent = focusedEventId.value
    ? (events.value.find(e => e.id === focusedEventId.value) || individualEvent.value)
    : null

  const range = TIME_RANGES[selectedRange.value]!
  let end: number, start: number

  if (focusedEvent) {
    // Center chart around the event time
    const eventTs = Math.floor(new Date(focusedEvent.created_at).getTime() / 1000)
    const halfWindow = Math.floor(range.seconds / 2)
    start = eventTs - halfWindow
    end = eventTs + halfWindow
  } else {
    end = Math.floor(Date.now() / 1000)
    start = end - range.seconds
  }

  // APM monitors aren't in Prometheus — chart their service metric from the
  // span-derived timeseries (same source the anomaly list uses).
  if (rule.value.source === 'apm') { await fetchApmChart(start, end, range.seconds); return }

  const splitLabels = rule.value.split_labels?.length ? rule.value.split_labels : undefined

  // If focused event has labels, build a targeted query for just that series
  const eventMetric = focusedEvent?.metric || ''
  const eventLabels = parseMetricLabels(eventMetric)
  const hasEventLabels = Object.keys(eventLabels).length > 0

  let query: string
  if (hasEventLabels) {
    // Build query with specific label selectors, e.g. sum(rate(http_requests_total{status_code="503"}[5m]))
    const labelSelector = Object.entries(eventLabels).map(([k, v]) => `${k}="${v}"`).join(', ')
    const selector = `${rule.value.pattern}{${labelSelector}}`
    query = isCounter(rule.value.pattern) ? `sum(rate(${selector}[5m]))` : `sum(${selector})`
  } else {
    query = buildQuery(rule.value.pattern, splitLabels)
  }

  try {
    const resp = await api.promQueryRange(query, start, end, range.step)
    if (!resp.result.length) { chartData.value = []; return }

    const series: ChartSeries[] = []
    for (const s of resp.result) {
      const labels: Record<string, string> = {}
      if (splitLabels) {
        for (const l of splitLabels) labels[l] = s.metric[l] || ''
      }

      // Drop the last point — it may be a partial minute with incomplete data
      const raw = s.values.slice(0, -1)
      const timestamps = raw.map(([ts]) => ts * 1000)
      const values = raw.map(([, v]) => parseFloat(v))
      if (values.length < 3) continue
      const bands = computeBands(values, rule.value.alpha, rule.value.sensitivity)
      const allVals = [...values, ...bands.upper]
      const maxVal = allVals.length ? Math.max(...allVals) * 1.1 : 1
      const anomalyCount = countAnomalyStreaks(bands.anomalies)
      series.push({
        name: rule.value.pattern,
        query,
        timestamps,
        values,
        labels: splitLabels ? labels : undefined,
        bands,
        maxVal,
        anomalyCount,
      })
    }
    chartData.value = series
  } catch {
    chartData.value = []
  }
}

// APM monitor chart: pull the service's span-derived timeseries for the window
// and project the bucket field named by the monitor's apm_metric, then run the
// same EWMA band/anomaly overlay as the Prometheus path.
async function fetchApmChart(start: number, end: number, windowSeconds: number) {
  const svc = rule.value?.service_name
  const metric = rule.value?.apm_metric || ''
  if (!svc) { chartData.value = []; return }
  const interval = windowSeconds <= 3600 ? '1m' : windowSeconds <= 21600 ? '5m' : '15m'
  try {
    const resp = await api.queryTimeseries({
      time_range: { from: new Date(start * 1000).toISOString(), to: new Date(end * 1000).toISOString() },
      filters: [{ field: 'service_name', op: '=', value: svc }],
      interval,
    })
    const buckets = (resp.buckets || []) as TimeseriesBucket[]
    if (!buckets.length) { chartData.value = []; return }
    // Drop the last bucket — it may be a partial interval with incomplete data.
    const trimmed = buckets.slice(0, -1)
    const timestamps = trimmed.map(b => new Date(b.bucket).getTime())
    let values: number[]
    switch (metric) {
      case 'error_rate': values = trimmed.map(b => b.error_count); break
      case 'p50': values = trimmed.map(b => b.p50_ms); break
      case 'p95': values = trimmed.map(b => b.p95_ms); break
      case 'p99': values = trimmed.map(b => b.p99_ms); break
      default: values = trimmed.map(b => b.count)
    }
    if (values.length < 3) { chartData.value = []; return }
    const bands = computeBands(values, rule.value!.alpha, rule.value!.sensitivity)
    const allVals = [...values, ...bands.upper]
    const maxVal = allVals.length ? Math.max(...allVals) * 1.1 : 1
    chartData.value = [{
      name: `${svc}:${metric}`,
      query: `apm:${svc}:${metric}`,
      timestamps,
      values,
      bands,
      maxVal,
      anomalyCount: countAnomalyStreaks(bands.anomalies),
    }]
  } catch {
    chartData.value = []
  }
}

function selectRange(idx: number) {
  selectedRange.value = idx
  fetchChart()
  if (corrChartSeries.value.length) fetchCorrCharts()
}

function selectEvent(eventId: string) {
  focusedEventId.value = eventId
  router.replace({ query: { ...route.query, event: eventId } })
  fetchChart()
  fetchCorrelations(eventId)
}

async function fetchCorrelations(eventId: string) {
  try {
    correlations.value = await api.getEventCorrelations(eventId)
    suspectedLogs.value = []
    await fetchCorrCharts()
    await fetchSuspectedLogs()
  } catch {
    correlations.value = null
    corrChartSeries.value = []
    suspectedLogs.value = []
  }
}

const focusedEvent = computed(() =>
  focusedEventId.value
    ? (events.value.find(e => e.id === focusedEventId.value) || individualEvent.value)
    : null
)

// Filter events to only those matching the focused event's metric
const filteredEvents = computed(() => {
  const fe = focusedEvent.value
  if (!fe || !fe.metric) return events.value
  return events.value.filter(e => e.metric === fe.metric)
})

// ═══ Chart geometry (larger than list view) ═══
const W = 900, H = 320
const pad = { top: 20, right: 20, bottom: 32, left: 60 }
const iW = W - pad.left - pad.right
const iH = H - pad.top - pad.bottom

function tx(i: number, total: number): number { return pad.left + (i / Math.max(total - 1, 1)) * iW }
function ty(v: number, mx: number): number { return pad.top + iH - (v / mx) * iH }

function linePath(vals: number[], mx: number): string {
  return vals.map((v, i) => `${i ? 'L' : 'M'}${tx(i, vals.length)},${ty(v, mx)}`).join(' ')
}

function areaPath(vals: number[], mx: number): string {
  const n = vals.length, base = pad.top + iH
  let d = `M${tx(0, n)},${base}`
  vals.forEach((v, i) => { d += ` L${tx(i, n)},${ty(v, mx)}` })
  return d + ` L${tx(n - 1, n)},${base} Z`
}

function bandPath(upper: number[], lower: number[], mx: number): string {
  const n = upper.length
  let d = `M${tx(0, n)},${ty(upper[0]!, mx)}`
  for (let i = 1; i < n; i++) d += ` L${tx(i, n)},${ty(upper[i]!, mx)}`
  for (let i = n - 1; i >= 0; i--) d += ` L${tx(i, n)},${ty(lower[i]!, mx)}`
  return d + ' Z'
}

function anomalyRects(flags: boolean[], total: number): Array<{ x: number; w: number }> {
  const step = iW / Math.max(total - 1, 1)
  const rects: Array<{ x: number; w: number }> = []
  let start: number | null = null
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start === null) start = i
    else if (!flags[i] && start !== null) {
      rects.push({ x: tx(start, total) - step * 0.5, w: (i - start) * step + step })
      start = null
    }
  }
  if (start !== null) rects.push({ x: tx(start, total) - step * 0.5, w: (total - start) * step })
  return rects
}

function yTicks(mx: number): Array<{ label: string; y: number }> {
  return [0, 0.25, 0.5, 0.75, 1].map(s => ({ label: fmtCompact(mx * s), y: pad.top + iH - s * iH }))
}

function timeLabels(timestamps: number[]): Array<{ label: string; x: number }> {
  const out: Array<{ label: string; x: number }> = []
  const total = timestamps.length
  const skip = Math.max(1, Math.floor(total / 10))
  for (let i = 0; i < total; i += skip) {
    const d = new Date(timestamps[i]!)
    out.push({
      label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      x: tx(i, total),
    })
  }
  return out
}

// ═══ Event marker on chart ═══
function eventMarkerX(timestamps: number[]): number | null {
  if (!focusedEvent.value) return null
  const eventTs = new Date(focusedEvent.value.created_at).getTime()
  if (!timestamps.length) return null
  const first = timestamps[0]!, last = timestamps[timestamps.length - 1]!
  if (eventTs < first || eventTs > last) return null
  const frac = (eventTs - first) / (last - first)
  return pad.left + frac * iW
}

// ═══ Crosshair (shared across main + corr charts) ═══
function onChartMouseMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const svgX = ((e.clientX - rect.left) / rect.width) * W
  const frac = Math.max(0, Math.min(1, (svgX - pad.left) / iW))
  cursorFraction.value = frac
  cursorX.value = pad.left + frac * iW
  corrCursorFraction.value = frac
  corrCursorX.value = cPad.left + frac * ciW
}

function onChartMouseLeave() {
  cursorFraction.value = null
  cursorX.value = null
  corrCursorFraction.value = null
  corrCursorX.value = null
}

function valueAtCursor(vals: number[]): string {
  if (cursorFraction.value === null) return ''
  const idx = Math.round(cursorFraction.value * (vals.length - 1))
  return fmtCompact(vals[idx] ?? 0)
}

function timeAtCursor(timestamps: number[]): string {
  if (cursorFraction.value === null) return ''
  const idx = Math.round(cursorFraction.value * (timestamps.length - 1))
  const d = new Date(timestamps[idx] ?? 0)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function dotY(vals: number[], mx: number): number {
  if (cursorFraction.value === null) return 0
  const idx = Math.round(cursorFraction.value * (vals.length - 1))
  return ty(vals[idx] ?? 0, mx)
}

// ═══ Formatters ═══
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(1)
  if (n > 0) return n.toFixed(3)
  return '0'
}

function formatEventTime(iso: string): string {
  const d = new Date(iso)
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hr = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  return `${mon}/${day} ${hr}:${min}:${sec}`
}

function parseMetricLabels(metric: string): Record<string, string> {
  const labels: Record<string, string> = {}
  const braceIdx = metric.indexOf('{')
  if (braceIdx === -1) return labels
  const inner = metric.slice(braceIdx + 1, metric.lastIndexOf('}'))
  const re = /(\w+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    labels[m[1]!] = m[2]!
  }
  return labels
}

function formatSeriesName(name: string, labels?: Record<string, string>): string {
  if (!labels || !Object.keys(labels).length) return name
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  return pairs ? `${name}{${pairs}}` : name
}

// ═══ Colors ═══
const PALETTE = ['#3b82f6', '#e5584f', '#9b7dd4', '#47b881', '#5b8dd9', '#e0965c', '#6bc9c4', '#d47da0']

function seriesColor(index: number, a?: number): string {
  const hex = PALETTE[index % PALETTE.length]!
  if (a !== undefined) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${a})`
  }
  return hex
}

// ═══ Correlation chart geometry (matches anomaly list page: W=580, H=180) ═══
const cW = 580, cH = 180
const cPad = { top: 14, right: 14, bottom: 26, left: 54 }
const ciW = cW - cPad.left - cPad.right
const ciH = cH - cPad.top - cPad.bottom

function cTx(i: number, total: number): number { return cPad.left + (i / Math.max(total - 1, 1)) * ciW }
function cTy(v: number, mx: number): number { return cPad.top + ciH - (v / mx) * ciH }

function cLinePath(vals: number[], mx: number): string {
  const n = vals.length
  return vals.map((v, i) => `${i ? 'L' : 'M'}${cTx(i, n)},${cTy(v, mx)}`).join(' ')
}

function cAreaPath(vals: number[], mx: number): string {
  const n = vals.length, base = cPad.top + ciH
  let d = `M${cTx(0, n)},${base}`
  vals.forEach((v, i) => { d += ` L${cTx(i, n)},${cTy(v, mx)}` })
  return d + ` L${cTx(n - 1, n)},${base} Z`
}

function cYTicks(mx: number): Array<{ label: string; y: number }> {
  return [0, 0.5, 1].map(s => ({ label: fmtCompact(mx * s), y: cPad.top + ciH - s * ciH }))
}

function cTimeLabels(timestamps: number[]): Array<{ label: string; x: number }> {
  const out: Array<{ label: string; x: number }> = []
  const total = timestamps.length
  const skip = Math.max(1, Math.floor(total / 6))
  for (let i = 0; i < total; i += skip) {
    const d = new Date(timestamps[i]!)
    out.push({ label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`, x: cTx(i, total) })
  }
  return out
}

function cEventMarkerX(timestamps: number[]): number | null {
  if (!focusedEvent.value) return null
  const eventTs = new Date(focusedEvent.value.created_at).getTime()
  if (!timestamps.length) return null
  const first = timestamps[0]!, last = timestamps[timestamps.length - 1]!
  if (eventTs < first || eventTs > last) return null
  const frac = (eventTs - first) / (last - first)
  return cPad.left + frac * ciW
}

const corrCursorFraction = ref<number | null>(null)
const corrCursorX = ref<number | null>(null)

function onCorrChartMouseMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const svgX = ((e.clientX - rect.left) / rect.width) * cW
  const frac = Math.max(0, Math.min(1, (svgX - cPad.left) / ciW))
  corrCursorFraction.value = frac
  corrCursorX.value = cPad.left + frac * ciW
  cursorFraction.value = frac
  cursorX.value = pad.left + frac * iW
}

function onCorrChartMouseLeave() {
  corrCursorFraction.value = null
  corrCursorX.value = null
  cursorFraction.value = null
  cursorX.value = null
}

function corrValueAtCursor(vals: number[]): string {
  if (corrCursorFraction.value === null) return ''
  const idx = Math.round(corrCursorFraction.value * (vals.length - 1))
  return fmtCompact(vals[idx] ?? 0)
}

function corrTimeAtCursor(timestamps: number[]): string {
  if (corrCursorFraction.value === null) return ''
  const idx = Math.round(corrCursorFraction.value * (timestamps.length - 1))
  const d = new Date(timestamps[idx] ?? 0)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function corrDotY(vals: number[], mx: number): number {
  if (corrCursorFraction.value === null) return 0
  const idx = Math.round(corrCursorFraction.value * (vals.length - 1))
  return cTy(vals[idx] ?? 0, mx)
}

interface CorrChartData {
  name: string
  timestamps: number[]
  values: number[]
  bands: { ewma: number[]; upper: number[]; lower: number[]; anomalies: boolean[] }
  maxVal: number
  anomalyCount: number
  total: number
}

function cBandPath(upper: number[], lower: number[], mx: number): string {
  const n = upper.length
  let d = `M${cTx(0, n)},${cTy(upper[0]!, mx)}`
  for (let i = 1; i < n; i++) d += ` L${cTx(i, n)},${cTy(upper[i]!, mx)}`
  for (let i = n - 1; i >= 0; i--) d += ` L${cTx(i, n)},${cTy(lower[i]!, mx)}`
  return d + ' Z'
}

function cAnomalyRects(flags: boolean[], total: number): Array<{ x: number; w: number }> {
  const step = ciW / Math.max(total - 1, 1)
  const rects: Array<{ x: number; w: number }> = []
  let start: number | null = null
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start === null) start = i
    else if (!flags[i] && start !== null) {
      rects.push({ x: cTx(start, total) - step * 0.5, w: (i - start) * step + step })
      start = null
    }
  }
  if (start !== null) rects.push({ x: cTx(start, total) - step * 0.5, w: (total - start) * step })
  return rects
}

const corrChartSeries = ref<CorrChartData[]>([])

// Build a per-service PromQL query by injecting service_name into the metric selector
function buildServiceQuery(metricStr: string, serviceName: string): string {
  // metricStr is like "http_requests_total{status_code=\"400\"}" or just "http_requests_total"
  const braceIdx = metricStr.indexOf('{')
  let name: string
  let existingLabels: string

  if (braceIdx !== -1) {
    name = metricStr.slice(0, braceIdx)
    // Extract existing labels (strip outer braces)
    existingLabels = metricStr.slice(braceIdx + 1, metricStr.lastIndexOf('}'))
  } else {
    name = metricStr
    existingLabels = ''
  }

  const svcLabel = `service_name="${serviceName}"`
  const allLabels = existingLabels ? `${existingLabels}, ${svcLabel}` : svcLabel
  const selector = `${name}{${allLabels}}`

  return isCounter(name) ? `sum(rate(${selector}[5m]))` : `sum(${selector})`
}

async function fetchCorrCharts() {
  if (!correlations.value?.services?.length || !rule.value) {
    corrChartSeries.value = []
    return
  }

  // Use the focused event metric (e.g. http_requests_total{status_code="400"})
  // or fall back to the rule pattern
  const fe = focusedEvent.value
  const metricStr = fe?.metric || rule.value.pattern

  // Use the same time range as the main chart
  const range = TIME_RANGES[selectedRange.value]!
  let end: number, start: number

  if (fe) {
    const eventTs = Math.floor(new Date(fe.created_at).getTime() / 1000)
    const halfWindow = Math.floor(range.seconds / 2)
    start = eventTs - halfWindow
    end = eventTs + halfWindow
  } else {
    end = Math.floor(Date.now() / 1000)
    start = end - range.seconds
  }

  const series: CorrChartData[] = []

  // Query Prometheus for each correlated service in parallel
  const promises = correlations.value.services.map(async (svc) => {
    const query = buildServiceQuery(metricStr, svc.name)
    try {
      const resp = await api.promQueryRange(query, start, end, range.step)
      if (!resp.result.length) return null

      const r = resp.result[0]!
      // Drop the last point — it may be a partial minute with incomplete data
      const raw = r.values.slice(0, -1)
      const timestamps = raw.map(([ts]) => ts * 1000)
      const values = raw.map(([, v]) => parseFloat(v))
      if (values.length < 2) return null

      const bands = computeBands(values, rule.value!.alpha, rule.value!.sensitivity)
      const allVals = [...values, ...bands.upper]
      const maxVal = allVals.length ? Math.max(...allVals) * 1.1 : 1
      const anomalyCount = countAnomalyStreaks(bands.anomalies)
      return { name: svc.name, timestamps, values, bands, maxVal, anomalyCount, total: svc.total } as CorrChartData
    } catch {
      return null
    }
  })

  const results = await Promise.all(promises)
  for (const r of results) {
    if (r) series.push(r)
  }

  corrChartSeries.value = series
}

// ═══ Combined suspected-service logs (±5min from event) ═══
// Unified row type for both logs and spans
interface SuspectedLogEntry {
  timestamp: number  // epoch ms
  source: 'log' | 'span' | 'event'
  service_name: string
  severity: string
  body: string
  trace_id: string
  http_method?: string
  http_path?: string
  http_status_code?: number
  duration_ms?: number
}

const suspectedLogs = ref<SuspectedLogEntry[]>([])
const suspectedLogsLoading = ref(false)

function tsToMs(ts: number): number {
  if (ts > 1e18) return ts / 1_000_000  // nanoseconds
  if (ts > 1e15) return ts / 1_000       // microseconds
  if (ts > 1e12) return ts               // milliseconds
  return ts * 1000                        // seconds
}

async function fetchSuspectedLogs() {
  const fe = focusedEvent.value
  const serviceNames = corrChartSeries.value.length
    ? corrChartSeries.value.map(s => s.name)
    : (correlations.value?.services?.map(s => s.name) || [])

  if (!fe || !serviceNames.length) { suspectedLogs.value = []; return }

  const eventTs = new Date(fe.created_at).getTime()
  const from = new Date(eventTs - 5 * 60 * 1000).toISOString()
  const to = new Date(eventTs + 5 * 60 * 1000).toISOString()

  // Parse status code from event metric if available
  const statusMatch = fe.metric?.match(/status_code="(\d+)"/)
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : null

  suspectedLogsLoading.value = true
  try {
    const entries: SuspectedLogEntry[] = []

    // 1. Fetch logs directly for each service via the logs API
    const logPromises = serviceNames.map(svc =>
      api.queryLogs({
        time_range: { from, to },
        filters: [{ field: 'ServiceName', op: '=', value: svc }],
        limit: 100,
      }).catch(() => ({ rows: [] as LogRecord[], total: 0 }))
    )

    // 2. Fetch spans (spans) for all services in parallel
    const spanFilters = (svc: string) => {
      const filters: Array<{ field: string; op: string; value: string | number }> = [
        { field: 'service_name', op: '=', value: svc },
      ]
      if (statusCode !== null) {
        filters.push({ field: 'http_status_code', op: '=', value: statusCode })
      }
      return filters
    }

    const spanPromises = serviceNames.map(svc =>
      api.queryEvents({
        time_range: { from, to },
        filters: spanFilters(svc),
        limit: 100,
      }).catch(() => ({ rows: [] as RushEvent[], total: 0 }))
    )

    const [logResults, spanResults] = await Promise.all([
      Promise.all(logPromises),
      Promise.all(spanPromises),
    ])

    // Convert logs to unified entries
    for (const r of logResults) {
      for (const log of (r.rows as LogRecord[])) {
        entries.push({
          timestamp: tsToMs(log.Timestamp),
          source: 'log',
          service_name: log.ServiceName,
          severity: log.SeverityText || 'INFO',
          body: log.Body,
          trace_id: log.TraceId,
        })
      }
    }

    // Also include correlation endpoint's logs (may have additional entries)
    if (correlations.value?.logs?.length) {
      const seen = new Set(entries.map(e => `${e.trace_id}:${e.timestamp}`))
      for (const log of correlations.value.logs) {
        const ts = new Date(log.timestamp).getTime()
        const key = `${log.trace_id}:${ts}`
        if (!seen.has(key)) {
          entries.push({
            timestamp: ts,
            source: 'log',
            service_name: log.service_name,
            severity: log.severity_text || 'INFO',
            body: log.body,
            trace_id: log.trace_id,
          })
        }
      }
    }

    // Convert spans to unified entries (span summary + span events)
    for (const r of spanResults) {
      for (const span of r.rows) {
        const durationMs = span.duration_ns / 1_000_000
        const statusLabel = span.status === 'STATUS_CODE_ERROR' ? 'ERROR' : span.http_status_code >= 400 ? 'WARN' : 'INFO'
        entries.push({
          timestamp: tsToMs(span.timestamp),
          source: 'span',
          service_name: span.service_name,
          severity: statusLabel,
          body: `${span.http_method} ${span.http_path} ${span.http_status_code} (${durationMs.toFixed(0)}ms)`,
          trace_id: span.trace_id,
          http_method: span.http_method,
          http_path: span.http_path,
          http_status_code: span.http_status_code,
          duration_ms: durationMs,
        })

        // Extract span events (log-like entries embedded in each span)
        if (span.event_names?.length) {
          for (let ei = 0; ei < span.event_names.length; ei++) {
            const evName = span.event_names[ei] || ''
            const evTs = span.event_timestamps?.[ei]
            const evAttrStr = span.event_attributes?.[ei] || '{}'
            let attrSuffix = ''
            try {
              const attrs = typeof evAttrStr === 'string' ? JSON.parse(evAttrStr) : evAttrStr
              const parts: string[] = []
              for (const [k, v] of Object.entries(attrs)) {
                parts.push(`${k}=${v}`)
              }
              if (parts.length) attrSuffix = ' ' + parts.join(' ')
            } catch { /* ignore parse errors */ }

            entries.push({
              timestamp: evTs ? tsToMs(evTs) : tsToMs(span.timestamp),
              source: 'event',
              service_name: span.service_name,
              severity: evName.toLowerCase().includes('error') || evName.toLowerCase().includes('exception') ? 'ERROR' : 'INFO',
              body: `${evName}${attrSuffix}`,
              trace_id: span.trace_id,
            })
          }
        }
      }
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp - a.timestamp)
    suspectedLogs.value = entries
  } catch {
    suspectedLogs.value = []
  } finally {
    suspectedLogsLoading.value = false
  }
}

function formatLogTime(ts: number): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const hr = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  const sec = d.getSeconds().toString().padStart(2, '0')
  return `${hr}:${min}:${sec}`
}

function formatCorrelationTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts.slice(11, 16)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ═══ SRE Investigation ═══
const investigationOpen = ref(false)

function openInvestigation() {
  if (!focusedEventId.value) return
  investigationOpen.value = true
}


onMounted(async () => {
  await loadRule()

  // If focused event isn't in the loaded events list, fetch it individually
  if (focusedEventId.value && !events.value.find(e => e.id === focusedEventId.value)) {
    try {
      individualEvent.value = await api.getAnomalyEvent(focusedEventId.value)
    } catch {
      // Event not found, continue without it
    }
  }

  await fetchChart()
  if (focusedEventId.value) {
    fetchCorrelations(focusedEventId.value)
  }
})
</script>

<template>
  <div class="detail-page">
    <!-- Header -->
    <div class="page-header">
      <div class="page-header-left">
        <router-link to="/anomaly?tab=history" class="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </router-link>
        <span class="page-title" v-if="rule">{{ rule.name || rule.pattern }}</span>
        <span class="page-title" v-else-if="loading">Loading...</span>
        <span class="page-title" v-else>Rule not found</span>
        <span class="state-badge mono" :class="rule?.state" v-if="rule">{{ rule.state }}</span>
      </div>
      <div class="page-header-right" v-if="focusedEvent">
        <button class="btn btn-ai" @click="openInvestigation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          Investigate
        </button>
      </div>
    </div>

    <!-- Rule info -->
    <div class="rule-meta card" v-if="rule">
      <div class="meta-row">
        <span class="meta-label">Source</span>
        <span class="meta-value mono">{{ rule.source }}</span>
      </div>
      <div class="meta-row" v-if="rule.pattern">
        <span class="meta-label">Pattern</span>
        <span class="meta-value mono">{{ rule.pattern }}</span>
      </div>
      <div class="meta-row" v-if="rule.service_name">
        <span class="meta-label">Service</span>
        <span class="meta-value mono">{{ rule.service_name }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Sensitivity</span>
        <span class="meta-value mono">{{ rule.sensitivity.toFixed(1) }}σ</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Alpha</span>
        <span class="meta-value mono">{{ rule.alpha.toFixed(2) }}</span>
      </div>
      <div class="meta-row" v-if="rule.split_labels?.length">
        <span class="meta-label">Split by</span>
        <span class="meta-value mono">{{ rule.split_labels.join(', ') }}</span>
      </div>
      <div class="meta-row" v-if="rule.last_eval_at">
        <span class="meta-label">Last eval</span>
        <span class="meta-value mono">{{ formatEventTime(rule.last_eval_at) }}</span>
      </div>
    </div>

    <!-- Focused event context -->
    <div class="focused-event card" v-if="focusedEvent">
      <div class="focused-header">
        <span class="sev-badge" :class="focusedEvent.state === 'anomalous' ? 'critical' : 'resolved'">{{ focusedEvent.state }}</span>
        <span class="focused-time mono">{{ formatEventTime(focusedEvent.created_at) }}</span>
      </div>
      <div class="focused-stats">
        <div class="focused-stat">
          <span class="stat-label">Metric</span>
          <span class="stat-value mono">{{ focusedEvent.metric }}</span>
        </div>
        <div class="focused-stat">
          <span class="stat-label">Value</span>
          <span class="stat-value mono">{{ fmtCompact(focusedEvent.value) }}</span>
        </div>
        <div class="focused-stat">
          <span class="stat-label">Expected</span>
          <span class="stat-value mono">{{ fmtCompact(focusedEvent.expected) }}</span>
        </div>
        <div class="focused-stat">
          <span class="stat-label">Deviation</span>
          <span class="stat-value mono">{{ focusedEvent.deviation.toFixed(1) }}σ</span>
        </div>
      </div>
    </div>

    <!-- Time range selector -->
    <div class="range-bar" v-if="rule">
      <button
        v-for="(r, ri) in TIME_RANGES" :key="r.label"
        class="range-btn" :class="{ active: selectedRange === ri }"
        @click="selectRange(ri)"
      >{{ r.label }}</button>
    </div>

    <!-- Charts -->
    <div class="charts-section" v-if="chartData.length">
      <PanelCard
        v-for="(m, mi) in chartData"
        :key="formatSeriesName(m.name, m.labels)"
        class="chart-card"
        :title="formatSeriesName(m.name, m.labels)"
        description="Observed metric (line) vs. EWMA baseline and ±band; shaded regions mark detected anomalies."
      >
        <template #actions>
          <span class="chart-color-dot" :style="{ background: seriesColor(mi) }"></span>
          <span class="chart-hover-val mono" v-if="cursorFraction !== null">
            {{ valueAtCursor(m.values) }}
            <span class="chart-hover-time">{{ timeAtCursor(m.timestamps) }}</span>
          </span>
          <span class="chart-badge has-anomalies" v-else-if="m.anomalyCount > 0">
            {{ m.anomalyCount }} anomalies
          </span>
        </template>
        <svg
          :viewBox="`0 0 ${W} ${H}`"
          class="chart-svg"
          preserveAspectRatio="none"
          @mousemove="onChartMouseMove"
          @mouseleave="onChartMouseLeave"
        >
          <template v-for="t in yTicks(m.maxVal)" :key="'y' + t.label">
            <line :x1="pad.left" :y1="t.y" :x2="W - pad.right" :y2="t.y" class="grid-line" />
            <text :x="pad.left - 4" :y="t.y + 3" class="axis-label" text-anchor="end">{{ t.label }}</text>
          </template>
          <template v-for="l in timeLabels(m.timestamps)" :key="'x' + l.label">
            <text :x="l.x" :y="H - 4" class="axis-label" text-anchor="middle">{{ l.label }}</text>
          </template>
          <rect
            v-for="(r, ri) in anomalyRects(m.bands.anomalies, m.values.length)"
            :key="'a' + ri"
            :x="r.x" :y="pad.top" :width="r.w" :height="iH"
            class="anomaly-region"
          />
          <path :d="bandPath(m.bands.upper, m.bands.lower, m.maxVal)" class="band-fill" />
          <path :d="linePath(m.bands.upper, m.maxVal)" class="band-edge" />
          <path :d="linePath(m.bands.lower, m.maxVal)" class="band-edge" />
          <path :d="linePath(m.bands.ewma, m.maxVal)" class="baseline-line" />
          <path :d="areaPath(m.values, m.maxVal)" :style="{ fill: seriesColor(mi, 0.10) }" />
          <path :d="linePath(m.values, m.maxVal)" class="metric-line" :style="{ stroke: seriesColor(mi) }" />
          <!-- Event marker -->
          <template v-if="eventMarkerX(m.timestamps) !== null">
            <line
              :x1="eventMarkerX(m.timestamps)!" :y1="pad.top"
              :x2="eventMarkerX(m.timestamps)!" :y2="pad.top + iH"
              class="event-marker"
            />
            <circle :cx="eventMarkerX(m.timestamps)!" :cy="pad.top + 6" r="4" class="event-marker-dot" />
          </template>
          <!-- Crosshair -->
          <template v-if="cursorX !== null">
            <line :x1="cursorX" :y1="pad.top" :x2="cursorX" :y2="pad.top + iH" class="crosshair" />
            <circle :cx="cursorX" :cy="dotY(m.values, m.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: seriesColor(mi), stroke: 'var(--bg-surface)' }" />
          </template>
        </svg>
      </PanelCard>
    </div>

    <div class="empty-chart card" v-else-if="!loading && rule">
      <div class="empty-icon">&#9676;</div>
      <div class="empty-text">No chart data available</div>
    </div>

    <!-- Suspected Services -->
    <div class="corr-section" v-if="corrChartSeries.length">
      <div class="section-title">
        Suspected Services
        <span class="section-subtitle mono" v-if="correlations">HTTP {{ correlations.status_code }} &middot; {{ formatCorrelationTime(correlations.window_from) }}–{{ formatCorrelationTime(correlations.window_to) }}</span>
      </div>
      <div class="corr-charts">
        <PanelCard
          v-for="(svc, si) in corrChartSeries"
          :key="svc.name"
          class="corr-chart-card"
          :title="svc.name"
          description="Suspected service's request volume vs. EWMA baseline and ±band; shaded regions mark detected anomalies."
        >
          <template #actions>
            <span class="chart-color-dot" :style="{ background: seriesColor(si) }"></span>
            <span class="chart-hover-val mono" v-if="corrCursorFraction !== null">
              {{ corrValueAtCursor(svc.values) }}
              <span class="chart-hover-time">{{ corrTimeAtCursor(svc.timestamps) }}</span>
            </span>
            <span class="chart-badge has-anomalies" v-else-if="svc.anomalyCount > 0">
              {{ svc.anomalyCount }} anomalies
            </span>
            <span class="corr-total-badge mono" v-else>{{ fmtCompact(svc.total) }}</span>
          </template>
          <svg
            :viewBox="`0 0 ${cW} ${cH}`"
            class="chart-svg"
            preserveAspectRatio="none"
            @mousemove="onCorrChartMouseMove"
            @mouseleave="onCorrChartMouseLeave"
          >
            <template v-for="t in cYTicks(svc.maxVal)" :key="'cy' + t.label">
              <line :x1="cPad.left" :y1="t.y" :x2="cW - cPad.right" :y2="t.y" class="grid-line" />
              <text :x="cPad.left - 4" :y="t.y + 3" class="axis-label" text-anchor="end">{{ t.label }}</text>
            </template>
            <template v-for="l in cTimeLabels(svc.timestamps)" :key="'cx' + l.label">
              <text :x="l.x" :y="cH - 4" class="axis-label" text-anchor="middle">{{ l.label }}</text>
            </template>
            <!-- Anomaly regions -->
            <rect
              v-for="(r, ri) in cAnomalyRects(svc.bands.anomalies, svc.values.length)"
              :key="'ca' + ri"
              :x="r.x" :y="cPad.top" :width="r.w" :height="ciH"
              class="anomaly-region"
            />
            <!-- EWMA bands -->
            <path :d="cBandPath(svc.bands.upper, svc.bands.lower, svc.maxVal)" class="band-fill" />
            <path :d="cLinePath(svc.bands.upper, svc.maxVal)" class="band-edge" />
            <path :d="cLinePath(svc.bands.lower, svc.maxVal)" class="band-edge" />
            <path :d="cLinePath(svc.bands.ewma, svc.maxVal)" class="baseline-line" />
            <!-- Event marker -->
            <template v-if="cEventMarkerX(svc.timestamps) !== null">
              <line
                :x1="cEventMarkerX(svc.timestamps)!" :y1="cPad.top"
                :x2="cEventMarkerX(svc.timestamps)!" :y2="cPad.top + ciH"
                class="event-marker"
              />
              <circle :cx="cEventMarkerX(svc.timestamps)!" :cy="cPad.top + 6" r="4" class="event-marker-dot" />
            </template>
            <!-- Metric line -->
            <path :d="cAreaPath(svc.values, svc.maxVal)" :style="{ fill: seriesColor(si, 0.10) }" />
            <path :d="cLinePath(svc.values, svc.maxVal)" class="metric-line" :style="{ stroke: seriesColor(si) }" />
            <!-- Crosshair -->
            <template v-if="corrCursorX !== null">
              <line :x1="corrCursorX" :y1="cPad.top" :x2="corrCursorX" :y2="cPad.top + ciH" class="crosshair" />
              <circle :cx="corrCursorX" :cy="corrDotY(svc.values, svc.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: seriesColor(si), stroke: 'var(--bg-surface)' }" />
            </template>
          </svg>
        </PanelCard>
      </div>
    </div>

    <!-- Suspected Service Logs -->
    <div class="corr-logs-section" v-if="corrChartSeries.length">
      <div class="section-title">
        Suspected Service Logs
        <span class="section-subtitle mono" v-if="suspectedLogsLoading">loading...</span>
        <span class="section-subtitle mono" v-else>&pm;5min &middot; {{ suspectedLogs.length }} entries</span>
      </div>
      <div class="corr-logs-table card" v-if="suspectedLogs.length">
        <div class="corr-logs-thead">
          <span class="cl-col cl-time">Time</span>
          <span class="cl-col cl-src">Source</span>
          <span class="cl-col cl-sev">Severity</span>
          <span class="cl-col cl-svc">Service</span>
          <span class="cl-col cl-body">Body</span>
        </div>
        <div class="corr-logs-body">
          <div v-for="(log, li) in suspectedLogs" :key="li" class="corr-logs-row">
            <span class="cl-col cl-time mono">{{ formatLogTime(log.timestamp) }}</span>
            <span class="cl-col cl-src">
              <span class="src-badge" :class="log.source">{{ log.source }}</span>
            </span>
            <span class="cl-col cl-sev">
              <span class="log-sev-badge" :class="log.severity.toLowerCase()">{{ log.severity }}</span>
            </span>
            <span class="cl-col cl-svc mono">{{ log.service_name }}</span>
            <span class="cl-col cl-body mono" :title="log.body">
              {{ log.body }}
              <router-link v-if="log.trace_id" :to="`/trace/${log.trace_id}`" class="trace-link" @click.stop>trace</router-link>
            </span>
          </div>
        </div>
      </div>
      <div class="empty-chart card" v-else-if="!suspectedLogsLoading">
        <div class="empty-text">No logs or spans found for suspected services in the &pm;5min window</div>
      </div>
    </div>

    <!-- Events table -->
    <div class="events-section" v-if="filteredEvents.length">
      <div class="section-title">
        Event History
        <span class="section-title-filter mono" v-if="focusedEvent?.metric">{{ focusedEvent.metric }}</span>
      </div>
      <div class="events-table card">
        <div class="events-thead">
          <span class="ev-col ev-time">Time</span>
          <span class="ev-col ev-sev">State</span>
          <span class="ev-col ev-metric">Metric</span>
          <span class="ev-col ev-val">Value</span>
          <span class="ev-col ev-exp">Expected</span>
          <span class="ev-col ev-dev">Deviation</span>
        </div>
        <div class="events-body">
          <div
            v-for="ev in filteredEvents" :key="ev.id"
            class="events-row"
            :class="{ selected: ev.id === focusedEventId }"
            @click="selectEvent(ev.id)"
          >
            <span class="ev-col ev-time mono">{{ formatEventTime(ev.created_at) }}</span>
            <span class="ev-col ev-sev">
              <span class="sev-badge" :class="ev.state === 'anomalous' ? 'critical' : 'resolved'">{{ ev.state }}</span>
            </span>
            <span class="ev-col ev-metric mono">{{ ev.metric }}</span>
            <span class="ev-col ev-val mono">{{ fmtCompact(ev.value) }}</span>
            <span class="ev-col ev-exp mono">{{ fmtCompact(ev.expected) }}</span>
            <span class="ev-col ev-dev mono">{{ ev.deviation.toFixed(1) }}σ</span>
          </div>
        </div>
      </div>
    </div>

    <!-- SRE Investigation Drawer -->
    <Teleport to="body">
      <div class="ai-drawer-backdrop" v-if="investigationOpen" @click.self="investigationOpen = false">
        <div class="ai-drawer">
          <InvestigationPanel
            :event-id="focusedEventId || undefined"
            @close="investigationOpen = false"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="../styles/views/AnomalyDetailView.css"></style>
