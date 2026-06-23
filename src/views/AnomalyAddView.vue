<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { NotificationChannel, TimeseriesBucket } from '../types'

const api = useApi()
const router = useRouter()
const route = useRoute()

// ═══ Types ═══
interface MetricMonitor {
  name: string
  query: string
  timestamps: number[]
  values: number[]
  labels?: Record<string, string>
}

// ═══ Constants ═══
const MAX_MONITORS = 20
const COUNTER_SUFFIXES = ['_total', '_count', '_sum', '_bucket', '_created']

const TIME_RANGES = [
  { label: '15m', seconds: 900, step: 15 },
  { label: '30m', seconds: 1800, step: 30 },
  { label: '1h', seconds: 3600, step: 60 },
  { label: '3h', seconds: 10800, step: 120 },
  { label: '6h', seconds: 21600, step: 300 },
  { label: '12h', seconds: 43200, step: 600 },
  { label: '24h', seconds: 86400, step: 900 },
] as const

// ═══ State ═══
const allMetricNames = ref<string[]>([])
const metricsLoading = ref(false)
const dataLoading = ref(false)
const cursorFraction = ref<number | null>(null)

const searchPattern = ref('')
const searchSensitivity = ref(3.0)
const searchAlpha = ref(0.25)

const previewData = ref<MetricMonitor[]>([])
const previewPattern = ref('')
const saveName = ref('')
const saveDescription = ref('')
const selectedRange = ref(2) // index into TIME_RANGES, default 1h
const channels = ref<NotificationChannel[]>([])
const selectedChannels = ref<string[]>([])

// ═══ APM source mode ═══
const apmSource = ref(false)
const apmService = ref('')
const apmServiceInput = ref('')
const apmServiceList = ref<string[]>([])
const apmAcOpen = ref(false)
const apmAcIndex = ref(-1)
const apmMetric = ref<'request_rate' | 'error_rate' | 'p50' | 'p95' | 'p99'>('request_rate')

const apmServiceSuggestions = computed(() => {
  const q = apmServiceInput.value.trim().toLowerCase()
  if (!q) return apmServiceList.value.slice(0, 12)
  return apmServiceList.value.filter(s => s.toLowerCase().includes(q)).slice(0, 12)
})

async function loadApmServices() {
  try {
    apmServiceList.value = await api.suggestValues('service_name')
  } catch {
    apmServiceList.value = []
  }
}

function switchToApm() {
  apmSource.value = true
  if (!apmServiceList.value.length) loadApmServices()
}

function selectApmService(name: string) {
  apmService.value = name
  apmServiceInput.value = name
  apmAcOpen.value = false
  apmAcIndex.value = -1
  fetchApmData()
}

function onApmServiceBlur() {
  setTimeout(() => { apmAcOpen.value = false; apmAcIndex.value = -1 }, 150)
}

function onApmServiceKeydown(e: KeyboardEvent) {
  const list = apmServiceSuggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    apmAcIndex.value = Math.min(apmAcIndex.value + 1, list.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    apmAcIndex.value = Math.max(apmAcIndex.value - 1, -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (apmAcIndex.value >= 0 && list[apmAcIndex.value]) {
      selectApmService(list[apmAcIndex.value]!)
    } else if (apmServiceInput.value.trim()) {
      selectApmService(apmServiceInput.value.trim())
    }
  } else if (e.key === 'Escape') {
    apmAcOpen.value = false
  }
}

const APM_METRIC_LABELS: Record<string, string> = {
  request_rate: 'Request Rate',
  error_rate: 'Error Rate',
  p50: 'Duration (p50)',
  p95: 'Duration (p95)',
  p99: 'Duration (p99)',
}

const APM_METRICS = [
  { value: 'request_rate', label: 'Request Rate' },
  { value: 'error_rate', label: 'Error Rate' },
  { value: 'p50', label: 'Duration (p50)' },
  { value: 'p95', label: 'Duration (p95)' },
  { value: 'p99', label: 'Duration (p99)' },
] as const

function extractApmValues(buckets: TimeseriesBucket[], metric: string): { timestamps: number[]; values: number[] } {
  const timestamps = buckets.map(b => new Date(b.bucket).getTime())
  let values: number[]
  switch (metric) {
    case 'error_rate': values = buckets.map(b => b.error_count); break
    case 'p50': values = buckets.map(b => b.p50_ms); break
    case 'p95': values = buckets.map(b => b.p95_ms); break
    case 'p99': values = buckets.map(b => b.p99_ms); break
    default: values = buckets.map(b => b.count)
  }
  return { timestamps, values }
}

async function fetchApmData() {
  if (!apmService.value) return
  dataLoading.value = true
  const range = TIME_RANGES[selectedRange.value]!
  const to = new Date()
  const from = new Date(to.getTime() - range.seconds * 1000)
  const interval = range.seconds <= 3600 ? '1m' : range.seconds <= 21600 ? '5m' : '15m'
  try {
    const resp = await api.queryTimeseries({
      time_range: { from: from.toISOString(), to: to.toISOString() },
      filters: [{ field: 'service_name', op: '=', value: apmService.value }],
      interval,
    })
    const buckets = (resp.buckets || []) as TimeseriesBucket[]
    if (!buckets.length) {
      previewData.value = []
      return
    }
    const { timestamps, values } = extractApmValues(buckets, apmMetric.value)
    if (values.length < 3) {
      previewData.value = []
      return
    }
    const name = `${apmService.value}:${apmMetric.value}`
    previewData.value = [{ name, query: `apm:${apmService.value}:${apmMetric.value}`, timestamps, values }]
    previewPattern.value = name
    if (!saveName.value) saveName.value = `${apmService.value} ${APM_METRIC_LABELS[apmMetric.value] || apmMetric.value}`
  } catch (e) {
    console.error('APM data fetch failed:', e)
    previewData.value = []
  } finally {
    dataLoading.value = false
  }
}

// ═══ Label splitting ═══
const LABELS_EXCLUDE = new Set(['__name__', 'job', 'instance'])
const commonLabels = ref<string[]>([])
const labelsLoading = ref(false)
const selectedLabels = ref<string[]>([])

// ═══ Autocomplete ═══
const acOpen = ref(false)
const acIndex = ref(-1)
const MAX_SUGGESTIONS = 12

const acSuggestions = computed(() => {
  const q = searchPattern.value.trim()
  if (!q || !acOpen.value) return []
  // If the pattern looks like a regex/glob, don't show autocomplete
  if (/[*+?^${}()|[\]\\]/.test(q)) return []
  const lower = q.toLowerCase()
  return allMetricNames.value
    .filter(n => n.toLowerCase().includes(lower))
    .slice(0, MAX_SUGGESTIONS)
})

function acSelect(name: string) {
  searchPattern.value = name
  acOpen.value = false
  acIndex.value = -1
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!acSuggestions.value.length) {
    if (e.key === 'Enter') queryPreview()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    acIndex.value = Math.min(acIndex.value + 1, acSuggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    acIndex.value = Math.max(acIndex.value - 1, -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (acIndex.value >= 0) {
      acSelect(acSuggestions.value[acIndex.value]!)
    } else {
      acOpen.value = false
      queryPreview()
    }
  } else if (e.key === 'Escape') {
    acOpen.value = false
    acIndex.value = -1
  }
}

function onSearchInput() {
  acOpen.value = true
  acIndex.value = -1
}

function onSearchBlur() {
  setTimeout(() => { acOpen.value = false; acIndex.value = -1 }, 150)
}

// ═══ Metric helpers ═══
function isCounter(name: string): boolean {
  return COUNTER_SUFFIXES.some(s => name.endsWith(s))
}

function buildQuery(name: string, labels?: string[]): string {
  if (labels?.length) {
    const by = labels.join(', ')
    return isCounter(name)
      ? `sum by (${by})(rate(${name}[5m]))`
      : `sum by (${by})(${name})`
  }
  return isCounter(name) ? `sum(rate(${name}[5m]))` : `sum(${name})`
}

// ═══ EWMA anomaly detection ═══
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

// ═══ Save ═══
async function saveConfig() {
  if (!previewPattern.value || !previewData.value.length) return

  const range = TIME_RANGES[selectedRange.value]!
  try {
    await api.createAnomalyRule({
      name: saveName.value.trim() || previewPattern.value,
      description: saveDescription.value.trim(),
      source: apmSource.value ? 'apm' : 'prometheus',
      pattern: apmSource.value ? '' : previewPattern.value,
      query: '',
      service_name: apmSource.value ? apmService.value : '',
      apm_metric: apmSource.value ? apmMetric.value : '',
      sensitivity: searchSensitivity.value,
      alpha: searchAlpha.value,
      eval_interval_secs: 300,
      window_secs: range.seconds,
      split_labels: apmSource.value ? [] : selectedLabels.value,
      notification_channel_ids: selectedChannels.value,
    })
  } catch (e: any) {
    console.error('Failed to create anomaly rule:', e)
    return
  }

  router.push('/anomaly')
}

// ═══ Metric matching ═══
// Convert glob-style patterns to regex (e.g. http_* → ^http_.*$)
function toRegex(pat: string): RegExp | null {
  // If it looks like a glob (has * without preceding .), convert to regex
  const hasGlob = pat.includes('*') && !pat.includes('.*')
  const rePat = hasGlob ? '^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$' : pat
  try { return new RegExp(rePat) } catch { return null }
}

const matchedMetrics = computed(() => {
  const pat = searchPattern.value.trim()
  if (!pat) return []
  const re = toRegex(pat)
  if (!re) return []
  return allMetricNames.value.filter(n => re.test(n)).slice(0, MAX_MONITORS)
})

const isValidRegex = computed(() => {
  if (!searchPattern.value.trim()) return true
  return toRegex(searchPattern.value.trim()) !== null
})

// ═══ Label discovery ═══
watch(matchedMetrics, async (metrics) => {
  if (!metrics.length) {
    commonLabels.value = []
    selectedLabels.value = []
    return
  }
  labelsLoading.value = true
  try {
    // For a single metric, fetch labels directly; for multiple, intersect
    let results: string[][]
    if (metrics.length === 1) {
      results = [await api.promLabels(`{__name__="${metrics[0]}"}`)]
    } else {
      // Use regex match for the pattern to avoid N separate calls
      const pat = searchPattern.value.trim()
      const hasGlob = pat.includes('*') && !pat.includes('.*')
      if (hasGlob || metrics.length > 5) {
        // Single regex call for the pattern
        const rePat = hasGlob ? pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') : pat
        results = [await api.promLabels(`{__name__=~"${rePat}"}`)]
      } else {
        results = await Promise.all(
          metrics.map(name => api.promLabels(`{__name__="${name}"}`))
        )
      }
    }
    let intersection: Set<string> | null = null
    for (const labels of results) {
      const filtered = new Set(labels.filter(l => !LABELS_EXCLUDE.has(l)))
      if (intersection === null) {
        intersection = filtered
      } else {
        for (const l of intersection) {
          if (!filtered.has(l)) intersection.delete(l)
        }
      }
    }
    commonLabels.value = [...(intersection || [])].sort()
    selectedLabels.value = selectedLabels.value.filter(l => commonLabels.value.includes(l))
  } catch {
    commonLabels.value = []
  } finally {
    labelsLoading.value = false
  }
})

// Re-query when selected labels change
watch(selectedLabels, async (newLabels, oldLabels) => {
  if (JSON.stringify(newLabels) === JSON.stringify(oldLabels)) return
  if (!previewPattern.value || !matchedMetrics.value.length) return
  dataLoading.value = true
  try {
    previewData.value = await fetchMetrics(
      matchedMetrics.value,
      newLabels.length ? newLabels : undefined
    )
  } finally {
    dataLoading.value = false
  }
}, { deep: true })

// Re-query when time range changes
watch(selectedRange, async () => {
  if (apmSource.value) {
    fetchApmData()
    return
  }
  if (!previewPattern.value || !matchedMetrics.value.length) return
  dataLoading.value = true
  try {
    previewData.value = await fetchMetrics(
      matchedMetrics.value,
      selectedLabels.value.length ? selectedLabels.value : undefined
    )
  } finally {
    dataLoading.value = false
  }
})

// Re-query when APM metric changes
watch(apmMetric, () => {
  if (apmSource.value) {
    saveName.value = `${apmService.value} ${APM_METRIC_LABELS[apmMetric.value] || apmMetric.value}`
    fetchApmData()
  }
})

// ═══ Data fetching ═══
async function fetchMetrics(names: string[], labels?: string[]): Promise<MetricMonitor[]> {
  const range = TIME_RANGES[selectedRange.value]!
  const end = Math.floor(Date.now() / 1000)
  const start = end - range.seconds
  const step = range.step
  const hasLabels = labels && labels.length > 0

  const results = await Promise.allSettled(
    names.map(async (name): Promise<MetricMonitor[]> => {
      const query = buildQuery(name, labels)
      const resp = await api.promQueryRange(query, start, end, step)
      if (!resp.result.length) return []

      if (hasLabels) {
        const monitors: MetricMonitor[] = []
        for (const series of resp.result) {
          const timestamps = series.values.map(([ts]) => ts * 1000)
          const values = series.values.map(([, v]) => parseFloat(v))
          if (values.length < 3) continue
          const seriesLabels: Record<string, string> = {}
          for (const l of labels) {
            seriesLabels[l] = series.metric[l] || ''
          }
          monitors.push({ name, query, timestamps, values, labels: seriesLabels })
        }
        return monitors
      }

      const series = resp.result[0]!
      const timestamps = series.values.map(([ts]) => ts * 1000)
      const values = series.values.map(([, v]) => parseFloat(v))
      if (values.length < 3) return []
      return [{ name, query, timestamps, values }]
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<MetricMonitor[]> =>
      r.status === 'fulfilled')
    .flatMap(r => r.value)
}

async function loadMetricNames() {
  metricsLoading.value = true
  try {
    allMetricNames.value = await api.promLabelValues('__name__')
  } catch (e) {
    console.error('Failed to load metric names:', e)
  } finally {
    metricsLoading.value = false
  }
}

async function queryPreview() {
  const metrics = matchedMetrics.value
  if (!metrics.length) {
    previewData.value = []
    previewPattern.value = ''
    return
  }
  dataLoading.value = true
  try {
    previewData.value = await fetchMetrics(metrics, selectedLabels.value.length ? selectedLabels.value : undefined)
    previewPattern.value = searchPattern.value.trim()
  } finally {
    dataLoading.value = false
  }
}

// ═══ Chart computation ═══
function computeChartsForMonitors(monitors: MetricMonitor[], sens: number, a: number) {
  return monitors.map(m => {
    const bands = computeBands(m.values, a, sens)
    const allVals = [...m.values, ...bands.upper]
    const maxVal = allVals.length ? Math.max(...allVals) * 1.1 : 1
    const anomalyCount = bands.anomalies.filter(Boolean).length
    return { ...m, bands, maxVal, anomalyCount }
  })
}

const previewCharts = computed(() =>
  computeChartsForMonitors(previewData.value, searchSensitivity.value, searchAlpha.value)
)

// ═══ Chart geometry ═══
const W = 580, H = 180
const pad = { top: 14, right: 14, bottom: 26, left: 54 }
const iW = W - pad.left - pad.right
const iH = H - pad.top - pad.bottom

function tx(i: number, total: number): number { return pad.left + (i / Math.max(total - 1, 1)) * iW }
function ty(v: number, mx: number): number { return pad.top + iH - (v / mx) * iH }

function linePath(vals: number[], mx: number): string {
  const n = vals.length
  return vals.map((v, i) => `${i ? 'L' : 'M'}${tx(i, n)},${ty(v, mx)}`).join(' ')
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
  return [0, 0.5, 1].map(s => ({ label: fmtCompact(mx * s), y: pad.top + iH - s * iH }))
}

function timeLabels(timestamps: number[]): Array<{ label: string; x: number }> {
  const out: Array<{ label: string; x: number }> = []
  const total = timestamps.length
  const skip = Math.max(1, Math.floor(total / 6))
  for (let i = 0; i < total; i += skip) {
    const d = new Date(timestamps[i]!)
    out.push({ label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`, x: tx(i, total) })
  }
  return out
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(1)
  if (n > 0) return n.toFixed(3)
  return '0'
}

// ═══ Colors ═══
const PALETTE = ['#3b82f6', '#e5584f', '#9b7dd4', '#47b881', '#5b8dd9', '#e0965c', '#6bc9c4', '#d47da0']

function metricColor(name: string, monitors: MetricMonitor[], a?: number): string {
  const idx = monitors.findIndex(m => m.name === name)
  const hex = PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length]!
  if (a !== undefined) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${a})`
  }
  return hex
}

function formatSeriesName(name: string, labels?: Record<string, string>): string {
  if (!labels || !Object.keys(labels).length) return name
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  return pairs ? `${name}{${pairs}}` : name
}

function formatLabelSuffix(labels?: Record<string, string>): string {
  if (!labels || !Object.keys(labels).length) return ''
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  return pairs ? `{${pairs}}` : ''
}

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

type ChartEntry = ReturnType<typeof computeChartsForMonitors>[number]

interface MetricGroup {
  metricName: string
  charts: ChartEntry[]
}

function groupChartsByMetric(charts: ChartEntry[]): MetricGroup[] {
  const groups = new Map<string, ChartEntry[]>()
  for (const c of charts) {
    const arr = groups.get(c.name) || []
    arr.push(c)
    groups.set(c.name, arr)
  }
  return [...groups.entries()].map(([metricName, entries]) => ({
    metricName,
    charts: entries,
  }))
}

const previewGroups = computed(() => groupChartsByMetric(previewCharts.value))

const totalPreviewAnomalies = computed(() =>
  previewCharts.value.reduce((sum, m) => sum + m.anomalyCount, 0)
)

// ═══ Shared crosshair ═══
function onChartMouseMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const svgX = ((e.clientX - rect.left) / rect.width) * W
  cursorFraction.value = Math.max(0, Math.min(1, (svgX - pad.left) / iW))
}

function onChartMouseLeave() {
  cursorFraction.value = null
}

const cursorX = computed(() =>
  cursorFraction.value !== null ? pad.left + cursorFraction.value * iW : null
)

function valueAtCursor(values: number[]): string {
  if (cursorFraction.value === null || !values.length) return ''
  return fmtCompact(values[Math.round(cursorFraction.value * (values.length - 1))]!)
}

function timeAtCursor(timestamps: number[]): string {
  if (cursorFraction.value === null || !timestamps.length) return ''
  const d = new Date(timestamps[Math.round(cursorFraction.value * (timestamps.length - 1))]!)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function dotY(values: number[], mx: number): number {
  if (cursorFraction.value === null || !values.length) return pad.top
  return ty(values[Math.round(cursorFraction.value * (values.length - 1))]!, mx)
}

// ═══ Lifecycle ═══
async function loadChannels() {
  try {
    const resp = await api.listChannels()
    channels.value = resp.channels
  } catch {
    channels.value = []
  }
}

onMounted(() => {
  loadChannels()

  // Detect APM source from query params
  if (route.query.source === 'apm' && route.query.service) {
    apmSource.value = true
    apmService.value = String(route.query.service)
    apmServiceInput.value = String(route.query.service)
    loadApmServices()
    if (route.query.metric) {
      apmMetric.value = String(route.query.metric) as typeof apmMetric.value
    }
    // Map APM time preset to our range index
    if (route.query.t) {
      const mins = Number(route.query.t)
      const secs = mins * 60
      const idx = TIME_RANGES.findIndex(r => r.seconds >= secs)
      if (idx >= 0) selectedRange.value = idx
    }
    fetchApmData()
  } else {
    loadMetricNames()
  }
})
</script>

<template>
  <div class="anomaly-page">
    <!-- ═══ Header ═══ -->
    <div class="page-header">
      <div class="page-header-left">
        <router-link to="/anomaly" class="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </router-link>
        <h1 class="page-title">Add Monitor</h1>
      </div>
    </div>

    <!-- ═══ Source Toggle ═══ -->
    <div class="source-toggle-row card">
      <label class="control-label">Source</label>
      <div class="split-chips">
        <button class="split-chip" :class="{ active: !apmSource }" @click="apmSource = false">Prometheus</button>
        <button class="split-chip" :class="{ active: apmSource }" @click="switchToApm()">APM</button>
      </div>
    </div>

    <!-- ═══ APM Source ═══ -->
    <div v-if="apmSource" class="search-section card">
      <div class="apm-service-row">
        <label class="control-label">Service</label>
        <div class="search-input-wrap">
          <input
            v-model="apmServiceInput"
            class="search-input mono"
            placeholder="Type to search services..."
            spellcheck="false"
            autocomplete="off"
            @input="apmAcOpen = true"
            @focus="apmAcOpen = true"
            @blur="onApmServiceBlur"
            @keydown="onApmServiceKeydown"
          />
          <div class="ac-dropdown" v-if="apmAcOpen && apmServiceSuggestions.length">
            <div
              v-for="(s, i) in apmServiceSuggestions"
              :key="s"
              class="ac-item mono"
              :class="{ active: i === apmAcIndex }"
              @mousedown.prevent="selectApmService(s)"
            >{{ s }}</div>
          </div>
        </div>
      </div>
      <div class="apm-metric-row" v-if="apmService">
        <label class="control-label">Metric</label>
        <div class="split-chips">
          <button
            v-for="m in APM_METRICS"
            :key="m.value"
            class="split-chip"
            :class="{ active: apmMetric === m.value }"
            @click="apmMetric = m.value as typeof apmMetric"
          >{{ m.label }}</button>
        </div>
      </div>
    </div>

    <!-- ═══ Search (Prometheus mode) ═══ -->
    <div v-else class="search-section card">
      <div class="search-row">
        <div class="search-input-wrap" :class="{ invalid: !isValidRegex }">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchPattern"
            class="search-input mono"
            placeholder="Metric pattern (regex)  e.g. http_request_.*"
            spellcheck="false"
            autocomplete="off"
            @keydown="onSearchKeydown"
            @input="onSearchInput"
            @focus="onSearchInput"
            @blur="onSearchBlur"
          />
          <span class="search-count mono" v-if="searchPattern && isValidRegex">
            {{ matchedMetrics.length }} matched
          </span>
          <div class="ac-dropdown" v-if="acSuggestions.length">
            <div
              v-for="(s, i) in acSuggestions"
              :key="s"
              class="ac-item mono"
              :class="{ active: i === acIndex }"
              @mousedown.prevent="acSelect(s)"
            >{{ s }}</div>
          </div>
        </div>
        <button class="monitor-btn" @click="queryPreview" :disabled="!matchedMetrics.length || dataLoading">
          <template v-if="dataLoading">
            <span class="spinner"></span> Loading
          </template>
          <template v-else>Query</template>
        </button>
      </div>

      <div class="matched-section" v-if="matchedMetrics.length">
        <div class="matched-chips">
          <span v-for="m in matchedMetrics" :key="m" class="metric-chip mono">{{ m }}</span>
          <span v-if="matchedMetrics.length >= MAX_MONITORS" class="metric-chip-overflow">
            +more (limited to {{ MAX_MONITORS }})
          </span>
        </div>
      </div>

      <div v-if="!isValidRegex" class="regex-error">Invalid regex pattern</div>
    </div>

    <!-- ═══ Controls ═══ -->
    <div class="controls-row card" v-if="previewData.length || (!apmSource && matchedMetrics.length && commonLabels.length)">
      <div class="control-group">
        <label class="control-label">
          Sensitivity
          <span class="control-value mono">{{ searchSensitivity.toFixed(1) }}&sigma;</span>
        </label>
        <input type="range" class="control-slider" min="1" max="5" step="0.1" v-model.number="searchSensitivity" />
        <div class="control-hint"><span>More alerts</span><span>Fewer alerts</span></div>
      </div>
      <div class="control-group">
        <label class="control-label">
          Adaptation Speed
          <span class="control-value mono">&alpha;={{ searchAlpha.toFixed(2) }}</span>
        </label>
        <input type="range" class="control-slider" min="0.05" max="0.6" step="0.05" v-model.number="searchAlpha" />
        <div class="control-hint"><span>Slow (stable)</span><span>Fast (reactive)</span></div>
      </div>
      <div class="control-group">
        <label class="control-label">Time Range</label>
        <div class="split-chips">
          <button
            v-for="(r, ri) in TIME_RANGES"
            :key="r.label"
            class="split-chip mono"
            :class="{ active: selectedRange === ri }"
            @click="selectedRange = ri"
          >{{ r.label }}</button>
        </div>
      </div>
      <div class="control-group" v-if="!apmSource && commonLabels.length">
        <label class="control-label">Split by</label>
        <div class="split-chips">
          <button
            class="split-chip"
            :class="{ active: !selectedLabels.length }"
            @click="selectedLabels = []"
          >None</button>
          <button
            v-for="l in commonLabels"
            :key="l"
            class="split-chip mono"
            :class="{ active: selectedLabels.includes(l) }"
            @click="selectedLabels.includes(l) ? selectedLabels = selectedLabels.filter(s => s !== l) : selectedLabels = [...selectedLabels, l]"
          >{{ l }}</button>
        </div>
      </div>
      <div class="control-legend">
        <div class="legend-items">
          <span class="legend-item"><span class="lsw band-sw"></span> Expected band</span>
          <span class="legend-item"><span class="lsw baseline-sw"></span> EWMA baseline</span>
          <span class="legend-item"><span class="lsw anomaly-sw"></span> Anomaly</span>
        </div>
      </div>
    </div>

    <!-- ═══ Preview Charts ═══ -->
    <div class="preview-section" v-if="previewCharts.length">
      <div class="section-header">
        <div class="section-header-left">
          <span class="preview-badge">Preview</span>
          <span class="section-pattern mono">{{ previewPattern }}</span>
          <span class="anomaly-summary" :class="totalPreviewAnomalies > 0 ? 'has-anomalies' : 'clear'">
            {{ totalPreviewAnomalies }} {{ totalPreviewAnomalies === 1 ? 'anomaly' : 'anomalies' }}
          </span>
        </div>
        <span class="range-badge mono">{{ TIME_RANGES[selectedRange]!.label }} window</span>
      </div>
      <div class="save-fields">
        <input
          v-model="saveName"
          class="save-field"
          :placeholder="'Name  (default: ' + previewPattern + ')'"
          spellcheck="false"
        />
        <input
          v-model="saveDescription"
          class="save-field save-field-desc"
          placeholder="Description (optional)"
          spellcheck="false"
        />
        <button class="save-btn" @click="saveConfig">Save Monitor</button>
      </div>
      <div class="channel-selector" v-if="channels.length">
        <label class="control-label">Notify channels</label>
        <div class="channel-chips">
          <button
            v-for="ch in channels"
            :key="ch.id"
            class="channel-chip"
            :class="{ active: selectedChannels.includes(ch.id) }"
            @click="selectedChannels.includes(ch.id)
              ? selectedChannels = selectedChannels.filter(id => id !== ch.id)
              : selectedChannels = [...selectedChannels, ch.id]"
          >
            <span class="channel-chip-type">{{ ch.channel_type }}</span>
            {{ ch.name }}
          </button>
        </div>
      </div>

      <!-- Grouped display when labels are selected -->
      <template v-if="selectedLabels.length">
        <div v-for="group in previewGroups" :key="group.metricName" class="metric-group">
          <div class="metric-group-header mono">{{ group.metricName }}</div>
          <div class="charts-grid">
            <div v-for="(m, mi) in group.charts" :key="m.name + ':' + formatLabelSuffix(m.labels)" class="chart-card card">
              <div class="chart-header">
                <div class="chart-header-left">
                  <span class="chart-color-dot" :style="{ background: seriesColor(mi) }"></span>
                  <span class="chart-name mono">{{ formatSeriesName(m.name, m.labels) }}</span>
                </div>
                <div class="chart-header-right">
                  <span class="chart-hover-val mono" v-if="cursorFraction !== null">
                    {{ valueAtCursor(m.values) }}
                    <span class="chart-hover-time">{{ timeAtCursor(m.timestamps) }}</span>
                  </span>
                  <span class="chart-badge" :class="m.anomalyCount > 0 ? 'has-anomalies' : 'clear'" v-else>
                    {{ m.anomalyCount > 0 ? `${m.anomalyCount} anomalies` : 'clear' }}
                  </span>
                </div>
              </div>
              <svg :viewBox="`0 0 ${W} ${H}`" class="chart-svg" preserveAspectRatio="none" @mousemove="onChartMouseMove" @mouseleave="onChartMouseLeave">
                <template v-for="t in yTicks(m.maxVal)" :key="'y' + t.label">
                  <line :x1="pad.left" :y1="t.y" :x2="W - pad.right" :y2="t.y" class="grid-line" />
                  <text :x="pad.left - 4" :y="t.y + 3" class="axis-label" text-anchor="end">{{ t.label }}</text>
                </template>
                <template v-for="l in timeLabels(m.timestamps)" :key="'x' + l.label">
                  <text :x="l.x" :y="H - 4" class="axis-label" text-anchor="middle">{{ l.label }}</text>
                </template>
                <rect v-for="(r, ri) in anomalyRects(m.bands.anomalies, m.values.length)" :key="'a' + ri" :x="r.x" :y="pad.top" :width="r.w" :height="iH" class="anomaly-region" />
                <path :d="bandPath(m.bands.upper, m.bands.lower, m.maxVal)" class="band-fill" />
                <path :d="linePath(m.bands.upper, m.maxVal)" class="band-edge" />
                <path :d="linePath(m.bands.lower, m.maxVal)" class="band-edge" />
                <path :d="linePath(m.bands.ewma, m.maxVal)" class="baseline-line" />
                <path :d="areaPath(m.values, m.maxVal)" :style="{ fill: seriesColor(mi, 0.10) }" />
                <path :d="linePath(m.values, m.maxVal)" class="metric-line" :style="{ stroke: seriesColor(mi) }" />
                <template v-if="cursorX !== null">
                  <line :x1="cursorX" :y1="pad.top" :x2="cursorX" :y2="pad.top + iH" class="crosshair" />
                  <circle :cx="cursorX" :cy="dotY(m.values, m.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: seriesColor(mi), stroke: 'var(--bg-surface)' }" />
                </template>
              </svg>
            </div>
          </div>
        </div>
      </template>
      <!-- Flat grid -->
      <div class="charts-grid" v-else>
        <div v-for="m in previewCharts" :key="m.name" class="chart-card card">
          <div class="chart-header">
            <div class="chart-header-left">
              <span class="chart-color-dot" :style="{ background: metricColor(m.name, previewData) }"></span>
              <span class="chart-name mono">{{ m.name }}</span>
            </div>
            <div class="chart-header-right">
              <span class="chart-hover-val mono" v-if="cursorFraction !== null">
                {{ valueAtCursor(m.values) }}
                <span class="chart-hover-time">{{ timeAtCursor(m.timestamps) }}</span>
              </span>
              <span class="chart-badge" :class="m.anomalyCount > 0 ? 'has-anomalies' : 'clear'" v-else>
                {{ m.anomalyCount > 0 ? `${m.anomalyCount} anomalies` : 'clear' }}
              </span>
            </div>
          </div>
          <svg :viewBox="`0 0 ${W} ${H}`" class="chart-svg" preserveAspectRatio="none" @mousemove="onChartMouseMove" @mouseleave="onChartMouseLeave">
            <template v-for="t in yTicks(m.maxVal)" :key="'y' + t.label">
              <line :x1="pad.left" :y1="t.y" :x2="W - pad.right" :y2="t.y" class="grid-line" />
              <text :x="pad.left - 4" :y="t.y + 3" class="axis-label" text-anchor="end">{{ t.label }}</text>
            </template>
            <template v-for="l in timeLabels(m.timestamps)" :key="'x' + l.label">
              <text :x="l.x" :y="H - 4" class="axis-label" text-anchor="middle">{{ l.label }}</text>
            </template>
            <rect v-for="(r, ri) in anomalyRects(m.bands.anomalies, m.values.length)" :key="'a' + ri" :x="r.x" :y="pad.top" :width="r.w" :height="iH" class="anomaly-region" />
            <path :d="bandPath(m.bands.upper, m.bands.lower, m.maxVal)" class="band-fill" />
            <path :d="linePath(m.bands.upper, m.maxVal)" class="band-edge" />
            <path :d="linePath(m.bands.lower, m.maxVal)" class="band-edge" />
            <path :d="linePath(m.bands.ewma, m.maxVal)" class="baseline-line" />
            <path :d="areaPath(m.values, m.maxVal)" :style="{ fill: metricColor(m.name, previewData, 0.10) }" />
            <path :d="linePath(m.values, m.maxVal)" class="metric-line" :style="{ stroke: metricColor(m.name, previewData) }" />
            <template v-if="cursorX !== null">
              <line :x1="cursorX" :y1="pad.top" :x2="cursorX" :y2="pad.top + iH" class="crosshair" />
              <circle :cx="cursorX" :cy="dotY(m.values, m.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: metricColor(m.name, previewData), stroke: 'var(--bg-surface)' }" />
            </template>
          </svg>
        </div>
      </div>
    </div>

    <!-- ═══ Empty State ═══ -->
    <div class="empty-panel card" v-if="!previewData.length && !dataLoading && !apmSource">
      <div class="empty-icon">📡</div>
      <div class="empty-text">Enter a metric pattern and click Query to preview</div>
      <div class="empty-sub mono" v-if="metricsLoading">Loading metric names...</div>
      <div class="empty-sub mono" v-else>{{ allMetricNames.length }} metrics available</div>
    </div>

    <!-- ═══ Loading State ═══ -->
    <div class="loading-panel card" v-if="dataLoading && !previewData.length">
      <span class="spinner large"></span>
      <span>Fetching metric data...</span>
    </div>
  </div>
</template>

<style scoped src="../styles/views/AnomalyAddView.css"></style>
