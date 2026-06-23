<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { NotificationChannel, AnomalyRule, AnomalyEventWithRule, TimeseriesBucket } from '../types'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { canWrite } = useAuth()

// ═══ Types ═══
interface MetricMonitor {
  name: string
  query: string
  timestamps: number[]
  values: number[]
  labels?: Record<string, string>
}

interface AnomalyConfig {
  id: string
  name: string
  description: string
  source: 'prometheus' | 'apm'
  pattern: string
  serviceName: string
  apmMetric: string
  sensitivity: number
  alpha: number
  state: string
  lastTriggeredAt: number | null
  splitLabels?: string[]
  channelIds?: string[]
  createdAt: number
}

// ═══ Constants ═══
const MAX_MONITORS = 20
const LIVE_INTERVAL = 30_000
const COUNTER_SUFFIXES = ['_total', '_count', '_sum', '_bucket', '_created']

const TIME_RANGES = [
  { label: '1h', seconds: 3600, step: 15 },
  { label: '3h', seconds: 10800, step: 30 },
  { label: '6h', seconds: 21600, step: 60 },
  { label: '12h', seconds: 43200, step: 120 },
  { label: '24h', seconds: 86400, step: 300 },
  { label: '3d', seconds: 259200, step: 900 },
  { label: '7d', seconds: 604800, step: 1800 },
] as const

// ═══ State ═══
const allMetricNames = ref<string[]>([])
const metricsLoading = ref(false)
const cursorFraction = ref<number | null>(null)

const savedConfigs = ref<AnomalyConfig[]>([])
const configData = ref<Record<string, MetricMonitor[]>>({})

const liveMode = ref(true)
const liveRefreshing = ref(false)
const liveTimer = ref<ReturnType<typeof setInterval> | null>(null)
// @ts-ignore used for future feature
const historicalRange = ref(0) // index into TIME_RANGES, default 1h
const channels = ref<NotificationChannel[]>([])
const notifiedKeys = ref<Set<string>>(new Set())

// ═══ Top-level tabs (like alerts) ═══
type Tab = 'anomalous' | 'history' | 'monitors'
const validTabs: Tab[] = ['anomalous', 'history', 'monitors']
const initTab = validTabs.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'anomalous'
const activeTab = ref<Tab>(initTab)
const serverEvents = ref<AnomalyEventWithRule[]>([])
const serverEventsLoaded = ref(false)

function setTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ query: { ...route.query, tab } })
  if (tab === 'history' && !serverEventsLoaded.value) {
    loadServerEvents()
  }
  if (tab === 'monitors') {
    // Fetch chart data for all monitors when viewing the monitors tab
    fetchAllConfigData(activeRangeIdx())
  }
}

function anomalyBubbleUpUrl(ev: AnomalyEventWithRule): string {
  const eventMs = new Date(ev.created_at).getTime()
  const from = new Date(eventMs - 30 * 60_000).toISOString()
  const to   = new Date(eventMs + 30 * 60_000).toISOString()
  const params = new URLSearchParams({ bubbleup: '1', bu_from: from, bu_to: to })
  return `/?${params.toString()}`
}

async function loadServerEvents() {
  try {
    const resp = await api.listAllAnomalyEvents()
    serverEvents.value = resp.events
    serverEventsLoaded.value = true
  } catch {
    serverEvents.value = []
  }
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

// ═══ API persistence ═══
function fromApiRule(rule: AnomalyRule): AnomalyConfig {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    source: rule.source,
    pattern: rule.source === 'apm' ? '' : rule.pattern,
    serviceName: rule.service_name,
    apmMetric: rule.apm_metric,
    sensitivity: rule.sensitivity,
    alpha: rule.alpha,
    state: rule.state,
    lastTriggeredAt: rule.last_triggered_at ? new Date(rule.last_triggered_at).getTime() : null,
    splitLabels: rule.split_labels.length ? rule.split_labels : undefined,
    channelIds: rule.notification_channel_ids.length ? rule.notification_channel_ids : undefined,
    createdAt: new Date(rule.created_at).getTime(),
  }
}

async function loadConfigs() {
  try {
    const resp = await api.listAnomalyRules()
    savedConfigs.value = resp.rules.map(fromApiRule)
  } catch {
    savedConfigs.value = []
  }
}

const deleteTarget = ref<AnomalyConfig | null>(null)

function confirmDelete(config: AnomalyConfig) {
  deleteTarget.value = config
}

function cancelDelete() {
  deleteTarget.value = null
}

async function executeDelete() {
  if (!deleteTarget.value) return
  const id = deleteTarget.value.id
  try {
    await api.deleteAnomalyRule(id)
  } catch { /* best effort */ }
  savedConfigs.value = savedConfigs.value.filter(c => c.id !== id)
  delete configData.value[id]
  if (editingId.value === id) editingId.value = null
  deleteTarget.value = null
}

// ═══ Inline editing ═══
const editingId = ref<string | null>(null)
const editName = ref('')
const editDescription = ref('')
const editSensitivity = ref(3.0)
const editAlpha = ref(0.25)
const editChannels = ref<string[]>([])

function startEdit(config: AnomalyConfig) {
  editingId.value = config.id
  editName.value = config.name || ''
  editDescription.value = config.description || ''
  editSensitivity.value = config.sensitivity
  editAlpha.value = config.alpha
  editChannels.value = config.channelIds ? [...config.channelIds] : []
}

function toggleEditChannel(id: string) {
  editChannels.value = editChannels.value.includes(id)
    ? editChannels.value.filter(c => c !== id)
    : [...editChannels.value, id]
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit() {
  const config = savedConfigs.value.find(c => c.id === editingId.value)
  if (!config) return
  const newName = editName.value.trim() || config.pattern || config.name
  const newDesc = editDescription.value.trim()
  try {
    await api.updateAnomalyRule(config.id, {
      name: newName,
      description: newDesc,
      source: config.source,
      pattern: config.pattern,
      query: '',
      service_name: config.serviceName,
      apm_metric: config.apmMetric,
      sensitivity: editSensitivity.value,
      alpha: editAlpha.value,
      eval_interval_secs: 300,
      window_secs: 3600,
      split_labels: config.splitLabels || [],
      notification_channel_ids: editChannels.value,
    })
  } catch { /* best effort */ }
  config.name = newName
  config.description = newDesc
  config.sensitivity = editSensitivity.value
  config.alpha = editAlpha.value
  config.channelIds = editChannels.value.length ? [...editChannels.value] : undefined
  editingId.value = null
}

// ═══ Data fetching ═══
async function fetchMetrics(names: string[], labels?: string[], rangeIdx?: number): Promise<MetricMonitor[]> {
  const range = rangeIdx !== undefined ? TIME_RANGES[rangeIdx]! : TIME_RANGES[0]!
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
          // Drop the last point — it may be a partial minute with incomplete data
          const raw = series.values.slice(0, -1)
          const timestamps = raw.map(([ts]) => ts * 1000)
          const values = raw.map(([, v]) => parseFloat(v))
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
      // Drop the last point — it may be a partial minute with incomplete data
      const raw = series.values.slice(0, -1)
      const timestamps = raw.map(([ts]) => ts * 1000)
      const values = raw.map(([, v]) => parseFloat(v))
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

async function fetchApmConfigData(config: AnomalyConfig, rangeIdx?: number) {
  if (!config.serviceName) { configData.value[config.id] = []; return }
  const range = rangeIdx !== undefined ? TIME_RANGES[rangeIdx]! : TIME_RANGES[0]!
  const to = new Date()
  const from = new Date(to.getTime() - range.seconds * 1000)
  const interval = range.seconds <= 3600 ? '1m' : range.seconds <= 21600 ? '5m' : '15m'
  try {
    const resp = await api.queryTimeseries({
      time_range: { from: from.toISOString(), to: to.toISOString() },
      filters: [{ field: 'service_name', op: '=', value: config.serviceName }],
      interval,
    })
    const buckets = (resp.buckets || []) as TimeseriesBucket[]
    if (!buckets.length) { configData.value[config.id] = []; return }
    // Drop the last bucket — it may be a partial minute with incomplete data
    const trimmed = buckets.slice(0, -1)
    const timestamps = trimmed.map(b => new Date(b.bucket).getTime())
    let values: number[]
    switch (config.apmMetric) {
      case 'error_rate': values = trimmed.map(b => b.error_count); break
      case 'p50': values = trimmed.map(b => b.p50_ms); break
      case 'p95': values = trimmed.map(b => b.p95_ms); break
      case 'p99': values = trimmed.map(b => b.p99_ms); break
      default: values = trimmed.map(b => b.count)
    }
    if (values.length < 3) { configData.value[config.id] = []; return }
    const name = `${config.serviceName}:${config.apmMetric}`
    configData.value[config.id] = [{ name, query: `apm:${name}`, timestamps, values }]
  } catch {
    configData.value[config.id] = []
  }
}

async function fetchConfigData(config: AnomalyConfig, rangeIdx?: number) {
  if (config.source === 'apm') {
    await fetchApmConfigData(config, rangeIdx)
    return
  }
  if (!config.pattern) {
    configData.value[config.id] = []
    return
  }
  try {
    const re = new RegExp(config.pattern)
    const names = allMetricNames.value.filter(n => re.test(n)).slice(0, MAX_MONITORS)
    if (!names.length) { configData.value[config.id] = []; return }
    configData.value[config.id] = await fetchMetrics(names, config.splitLabels?.length ? config.splitLabels : undefined, rangeIdx)
  } catch {
    configData.value[config.id] = []
  }
}

async function fetchAllConfigData(rangeIdx?: number) {
  await Promise.allSettled(savedConfigs.value.map(c => fetchConfigData(c, rangeIdx)))
}

function activeRangeIdx(): number | undefined {
  return undefined
}

// ═══ Chart computation ═══
function countAnomalyStreaks(flags: boolean[]): number {
  let count = 0
  let inStreak = false
  for (const f of flags) {
    if (f && !inStreak) { count++; inStreak = true }
    else if (!f) inStreak = false
  }
  return count
}

function computeChartsForMonitors(monitors: MetricMonitor[], sens: number, a: number) {
  return monitors.map(m => {
    const bands = computeBands(m.values, a, sens)
    const allVals = [...m.values, ...bands.upper]
    const maxVal = allVals.length ? Math.max(...allVals) * 1.1 : 1
    const anomalyCount = countAnomalyStreaks(bands.anomalies)
    return { ...m, bands, maxVal, anomalyCount }
  })
}

const allConfigCharts = computed(() => {
  const result: Record<string, ReturnType<typeof computeChartsForMonitors>> = {}
  for (const config of savedConfigs.value) {
    const data = configData.value[config.id] || []
    result[config.id] = computeChartsForMonitors(data, config.sensitivity, config.alpha)
  }
  return result
})

// ═══ Filter to only anomalous series for the Anomalous tab ═══
function anomalousChartsFor(configId: string) {
  return (allConfigCharts.value[configId] || []).filter(m => m.anomalyCount > 0)
}

// ═══ Anomalous configs (currently active OR triggered within last 30 min) ═══
const RECENT_WINDOW_MS = 30 * 60 * 1000

// Optional service filter (deep-linked from a service page via ?service=).
const serviceFilter = ref((route.query.service as string) || '')
const visibleSaved = computed(() =>
  serviceFilter.value ? savedConfigs.value.filter(c => c.serviceName === serviceFilter.value) : savedConfigs.value
)

const anomalousConfigs = computed(() => {
  const cutoff = Date.now() - RECENT_WINDOW_MS
  return visibleSaved.value.filter(c =>
    c.state === 'anomalous' ||
    (c.lastTriggeredAt !== null && c.lastTriggeredAt > cutoff)
  )
})

// ═══ Live mode ═══
function toggleLive() {
  liveMode.value = !liveMode.value
  if (liveMode.value) {
    refreshAll()
    liveTimer.value = setInterval(refreshAll, LIVE_INTERVAL)
  } else if (liveTimer.value) {
    clearInterval(liveTimer.value)
    liveTimer.value = null
  }
}

async function refreshAll() {
  liveRefreshing.value = true
  try {
    // Re-load rule states from API so anomalous tab reflects engine state changes
    await loadConfigs()
    // Fetch chart data for all configs visible on the anomalous tab (active + recently triggered)
    const visible = anomalousConfigs.value
    if (visible.length) {
      await Promise.allSettled(visible.map(c => fetchConfigData(c, activeRangeIdx())))
    }
    triggerNotifications()
  } finally {
    liveRefreshing.value = false
  }
}

function triggerNotifications() {
  for (const config of savedConfigs.value) {
    if (!config.channelIds?.length) continue
    const charts = allConfigCharts.value[config.id] || []
    for (const m of charts) {
      const len = m.values.length
      if (len === 0 || !m.bands.anomalies[len - 1]) continue
      // Find trailing streak start
      let streakStart = len - 1
      while (streakStart > 0 && m.bands.anomalies[streakStart - 1]) streakStart--
      const dedupKey = `${config.id}:${formatSeriesName(m.name, m.labels)}:${m.timestamps[streakStart]}`
      if (notifiedKeys.value.has(dedupKey)) continue
      notifiedKeys.value.add(dedupKey)

      for (const chId of config.channelIds) {
        const ch = channels.value.find(c => c.id === chId)
        const payload = buildAlertPayload(config, m, ch?.channel_type)
        api.notifyChannel(chId, payload).catch(() => {
          // Silently ignore notification failures
        })
      }
    }
  }
}

// ═══ Manual alert sending ═══
const alertSending = ref<Set<string>>(new Set())
const alertSent = ref<Set<string>>(new Set())
const alertPickerOpen = ref<string | null>(null) // chartAlertKey of open picker

function chartAlertKey(configId: string, m: { name: string; labels?: Record<string, string> }): string {
  return `${configId}:${formatSeriesName(m.name, m.labels)}`
}

function toggleAlertPicker(configId: string, m: { name: string; labels?: Record<string, string> }) {
  const key = chartAlertKey(configId, m)
  alertPickerOpen.value = alertPickerOpen.value === key ? null : key
}

function closeAlertPicker() {
  alertPickerOpen.value = null
}

function getAnomalyDetails(
  config: AnomalyConfig,
  m: ReturnType<typeof computeChartsForMonitors>[number]
) {
  const len = m.values.length
  let peakIdx = len - 1
  let peakDev = 0
  for (let i = 0; i < len; i++) {
    if (!m.bands.anomalies[i]) continue
    const dev = Math.abs(m.values[i]! - m.bands.ewma[i]!)
    if (dev > peakDev) { peakDev = dev; peakIdx = i }
  }
  const bandWidth = m.bands.upper[peakIdx]! - m.bands.ewma[peakIdx]!
  const sigmas = bandWidth > 0 ? peakDev / (bandWidth / config.sensitivity) : 0
  const metricLabel = formatSeriesName(m.name, m.labels)
  const severity = sigmas > config.sensitivity * 1.5 ? 'critical' : 'warning'
  const ts = new Date(m.timestamps[peakIdx]!).toISOString()
  return { peakIdx, sigmas, metricLabel, severity, ts, bandWidth }
}

function buildAlertPayload(
  config: AnomalyConfig,
  m: ReturnType<typeof computeChartsForMonitors>[number],
  channelType?: string
): Record<string, unknown> {
  const d = getAnomalyDetails(config, m)
  const monitorName = config.name || config.pattern
  const viewUrl = `${window.location.origin}/anomaly`

  if (channelType === 'slack') {
    const emoji = d.severity === 'critical' ? ':rotating_light:' : ':warning:'
    return {
      text: `${emoji} Anomaly: ${d.metricLabel}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${d.severity === 'critical' ? '🚨' : '⚠️'} Anomaly Detected`, emoji: true }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Monitor*\n${monitorName}` },
            { type: 'mrkdwn', text: `*Severity*\n${d.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Metric*\n\`${d.metricLabel}\`` },
            { type: 'mrkdwn', text: `*Deviation*\n${d.sigmas.toFixed(1)}σ` },
          ]
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Actual*\n${fmtCompact(m.values[d.peakIdx]!)}` },
            { type: 'mrkdwn', text: `*Expected*\n~${fmtCompact(m.bands.ewma[d.peakIdx]!)} ± ${fmtCompact(d.bandWidth)}` },
          ]
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Detected at ${d.ts}` }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in Rush', emoji: true },
              url: viewUrl,
              style: 'primary',
            }
          ]
        }
      ]
    }
  }

  // Generic webhook payload
  return {
    text: `Anomaly detected: ${d.metricLabel} value=${fmtCompact(m.values[d.peakIdx]!)} (expected ~${fmtCompact(m.bands.ewma[d.peakIdx]!)}, σ=${d.sigmas.toFixed(1)})`,
    monitor: monitorName,
    metric: d.metricLabel,
    value: m.values[d.peakIdx]!,
    expected: m.bands.ewma[d.peakIdx]!,
    severity: d.severity,
    timestamp: d.ts,
    url: viewUrl,
  }
}

async function sendAlertToChannel(
  config: AnomalyConfig,
  m: ReturnType<typeof computeChartsForMonitors>[number],
  channelId: string
) {
  const key = chartAlertKey(config.id, m)
  const sendKey = `${key}:${channelId}`
  if (alertSending.value.has(sendKey)) return
  alertSending.value.add(sendKey)

  const ch = channels.value.find(c => c.id === channelId)
  const payload = buildAlertPayload(config, m, ch?.channel_type)
  try {
    await api.notifyChannel(channelId, payload)
    alertSent.value.add(sendKey)
    setTimeout(() => alertSent.value.delete(sendKey), 3000)
  } catch {
    // failed silently
  } finally {
    alertSending.value.delete(sendKey)
  }
}

async function sendAlertToAll(
  config: AnomalyConfig,
  m: ReturnType<typeof computeChartsForMonitors>[number]
) {
  const key = chartAlertKey(config.id, m)
  if (alertSending.value.has(key)) return
  alertSending.value.add(key)

  try {
    await Promise.all(channels.value.map(ch => {
      const payload = buildAlertPayload(config, m, ch.channel_type)
      return api.notifyChannel(ch.id, payload)
    }))
    alertSent.value.add(key)
    setTimeout(() => alertSent.value.delete(key), 3000)
  } catch {
    // failed silently
  } finally {
    alertSending.value.delete(key)
    alertPickerOpen.value = null
  }
}

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

function formatTimeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

function formatEventTime(iso: string): string {
  const d = new Date(iso)
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hr = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mon}/${day} ${hr}:${min}`
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

// ═══ Scroll to chart ═══
// @ts-ignore used for future feature
function scrollToChart(metric: string) {
  nextTick(() => {
    const el = document.querySelector(`[data-chart-metric="${CSS.escape(metric)}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('chart-highlight')
      setTimeout(() => el.classList.remove('chart-highlight'), 1500)
    }
  })
}

// ═══ Click outside to close alert picker ═══
function onDocClick(e: MouseEvent) {
  if (!alertPickerOpen.value) return
  const target = e.target as HTMLElement
  if (!target.closest('.alert-action')) {
    alertPickerOpen.value = null
  }
}

// ═══ Lifecycle ═══
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  await loadConfigs()
  await loadMetricNames()
  try {
    const resp = await api.listChannels()
    channels.value = resp.channels
  } catch {
    channels.value = []
  }
  // Load data appropriate for the initial tab
  if (activeTab.value === 'history') {
    loadServerEvents()
  } else if (activeTab.value === 'monitors') {
    fetchAllConfigData(activeRangeIdx())
  }
  // Fetch chart data for configs visible on anomalous tab (active + recently triggered)
  const visible = anomalousConfigs.value
  if (visible.length) {
    await Promise.allSettled(visible.map(c => fetchConfigData(c)))
  }
  triggerNotifications()
  liveTimer.value = setInterval(refreshAll, LIVE_INTERVAL)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  if (liveTimer.value) {
    clearInterval(liveTimer.value)
    liveTimer.value = null
  }
})
</script>

<template>
  <div class="anomaly-page">
    <!-- ═══ Header ═══ -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Anomaly Detection</h1>
      </div>
      <div class="page-header-right">
        <router-link v-if="canWrite" to="/anomaly/add" class="add-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Monitor
        </router-link>
        <button class="live-toggle" :class="{ active: liveMode, refreshing: liveRefreshing }" @click="toggleLive" v-if="activeTab === 'anomalous'">
          <span class="live-dot" :class="{ spin: liveRefreshing }"></span>
          {{ liveRefreshing ? 'Updating...' : liveMode ? 'Live' : 'Paused' }}
        </button>
      </div>
    </div>

    <div v-if="serviceFilter" class="svc-scope-chip">
      Filtered to service <span class="mono">{{ serviceFilter }}</span>
      <button @click="serviceFilter = ''" title="Clear filter" aria-label="Clear service filter">&times;</button>
    </div>

    <!-- ═══ Sub-tabs (matches Alerts) ═══ -->
    <div class="sub-tabs">
      <button class="sub-tab" :class="{ active: activeTab === 'anomalous' }" @click="setTab('anomalous')">
        <span class="tab-icon tab-icon-anomalous">&#9679;</span> Anomalous
        <span class="tab-count" v-if="anomalousConfigs.length">{{ anomalousConfigs.length }}</span>
      </button>
      <button class="sub-tab" :class="{ active: activeTab === 'history' }" @click="setTab('history')">
        <span class="tab-icon tab-icon-history">&#9716;</span> History
      </button>
      <button class="sub-tab" :class="{ active: activeTab === 'monitors' }" @click="setTab('monitors')">
        <span class="tab-icon tab-icon-monitors">&#9881;</span> Monitors
      </button>
    </div>

    <!-- ═══ TAB: Anomalous ═══ -->
    <template v-if="activeTab === 'anomalous'">
      <!-- Anomalous configs detected by engine -->
      <template v-for="config in anomalousConfigs" :key="config.id">
      <div class="monitor-section">
        <div class="section-header">
          <div class="section-header-left">
            <span class="section-name">{{ config.name || config.pattern || `${config.serviceName}:${config.apmMetric}` }}</span>
            <span class="section-pattern mono" v-if="config.source === 'apm'">{{ config.serviceName }}:{{ config.apmMetric }}</span>
            <span class="section-pattern mono" v-else-if="config.name && config.name !== config.pattern">{{ config.pattern }}</span>
            <span class="state-badge mono anomalous" v-if="config.state === 'anomalous'">anomalous</span>
            <span class="state-badge mono recent" v-else>resolved</span>
            <span class="recent-time mono" v-if="config.state !== 'anomalous' && config.lastTriggeredAt">{{ formatTimeAgo(config.lastTriggeredAt) }}</span>
          </div>
        </div>
        <div class="charts-grid" v-if="anomalousChartsFor(config.id).length">
          <div v-for="(m, mi) in anomalousChartsFor(config.id)" :key="formatSeriesName(m.name, m.labels)" class="chart-card card" :data-chart-metric="formatSeriesName(m.name, m.labels)">
            <div class="chart-header">
              <div class="chart-header-left">
                <span class="chart-color-dot" :style="{ background: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []) }"></span>
                <span class="chart-name mono">{{ formatSeriesName(m.name, m.labels) }}</span>
              </div>
              <div class="chart-header-right">
                <span class="chart-hover-val mono" v-if="cursorFraction !== null">
                  {{ valueAtCursor(m.values) }}
                  <span class="chart-hover-time">{{ timeAtCursor(m.timestamps) }}</span>
                </span>
                <span class="chart-badge has-anomalies" v-else-if="m.anomalyCount > 0">
                  {{ m.anomalyCount }} anomalies
                </span>
              </div>
            </div>
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
              <path :d="areaPath(m.values, m.maxVal)" :style="{ fill: config.splitLabels?.length ? seriesColor(mi, 0.10) : metricColor(m.name, configData[config.id] || [], 0.10) }" />
              <path :d="linePath(m.values, m.maxVal)" class="metric-line" :style="{ stroke: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []) }" />
              <template v-if="cursorX !== null">
                <line :x1="cursorX" :y1="pad.top" :x2="cursorX" :y2="pad.top + iH" class="crosshair" />
                <circle :cx="cursorX" :cy="dotY(m.values, m.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []), stroke: 'var(--bg-surface)' }" />
              </template>
            </svg>
          </div>
        </div>
      </div>
      </template>

      <!-- Empty anomalous state -->
      <div class="empty-panel card" v-if="!anomalousConfigs.length">
        <div class="empty-icon">&#10003;</div>
        <div class="empty-text">No anomalies in the last 30 minutes</div>
        <div class="empty-sub">All monitors are reporting normal</div>
      </div>
    </template>

    <!-- ═══ TAB: History ═══ -->
    <template v-if="activeTab === 'history'">
      <div class="events-table card" v-if="serverEvents.length">
        <div class="events-thead">
          <span class="ev-col ev-time">Time</span>
          <span class="ev-col ev-sev">State</span>
          <span class="ev-col ev-rule">Monitor</span>
          <span class="ev-col ev-metric">Metric</span>
          <span class="ev-col ev-val">Value</span>
          <span class="ev-col ev-exp">Expected</span>
          <span class="ev-col ev-actions"></span>
        </div>
        <div class="events-body">
          <router-link
            v-for="ev in serverEvents" :key="ev.id"
            :to="{ name: 'anomaly-detail', params: { ruleId: ev.rule_id }, query: { event: ev.id } }"
            class="events-row clickable"
          >
            <span class="ev-col ev-time mono">{{ formatEventTime(ev.created_at) }}</span>
            <span class="ev-col ev-sev">
              <span class="sev-badge" :class="ev.state === 'anomalous' ? 'critical' : 'resolved'">{{ ev.state }}</span>
            </span>
            <span class="ev-col ev-rule">{{ ev.rule_name }}</span>
            <span class="ev-col ev-metric mono">{{ ev.metric }}</span>
            <span class="ev-col ev-val mono">{{ fmtCompact(ev.value) }}</span>
            <span class="ev-col ev-exp mono">{{ fmtCompact(ev.expected) }} ±{{ ev.deviation.toFixed(1) }}σ</span>
            <span class="ev-col ev-actions" @click.prevent.stop>
              <router-link :to="anomalyBubbleUpUrl(ev)" class="btn-bubbleup-sm">⬡ BubbleUp</router-link>
            </span>
          </router-link>
        </div>
      </div>
      <div class="empty-panel card" v-else>
        <div class="empty-icon">&#9716;</div>
        <div class="empty-text">No history yet</div>
        <div class="empty-sub">Anomaly events will appear here as the engine detects state changes</div>
      </div>
    </template>

    <!-- ═══ TAB: Monitors ═══ -->
    <template v-if="activeTab === 'monitors'">
    <template v-for="config in visibleSaved" :key="config.id">
    <div class="monitor-section">
      <!-- Edit mode -->
      <template v-if="editingId === config.id">
        <div class="edit-form card">
          <div class="edit-row">
            <input v-model="editName" class="save-field" placeholder="Name" spellcheck="false" />
            <input v-model="editDescription" class="save-field save-field-desc" placeholder="Description (optional)" spellcheck="false" />
          </div>
          <div class="edit-row">
            <div class="control-group">
              <label class="control-label">
                Sensitivity
                <span class="control-value mono">{{ editSensitivity.toFixed(1) }}σ</span>
              </label>
              <input type="range" class="control-slider" min="1" max="5" step="0.1" v-model.number="editSensitivity" />
              <div class="control-hint"><span>More alerts</span><span>Fewer alerts</span></div>
            </div>
            <div class="control-group">
              <label class="control-label">
                Adaptation Speed
                <span class="control-value mono">α={{ editAlpha.toFixed(2) }}</span>
              </label>
              <input type="range" class="control-slider" min="0.05" max="0.6" step="0.05" v-model.number="editAlpha" />
              <div class="control-hint"><span>Slow (stable)</span><span>Fast (reactive)</span></div>
            </div>
          </div>
          <div class="edit-row">
            <div class="channel-selector">
              <label class="control-label">
                Alert channels
                <span class="control-hint-inline">notified automatically when an anomaly fires</span>
              </label>
              <div class="channel-chips" v-if="channels.length">
                <button
                  v-for="ch in channels"
                  :key="ch.id"
                  class="channel-chip"
                  :class="{ active: editChannels.includes(ch.id) }"
                  @click="toggleEditChannel(ch.id)"
                >
                  <span class="channel-chip-type">{{ ch.channel_type }}</span>
                  {{ ch.name }}
                </button>
              </div>
              <router-link v-else to="/channels" class="channel-empty-link">No channels configured — add one →</router-link>
            </div>
          </div>
          <div class="edit-row edit-actions">
            <span class="section-pattern mono">{{ config.source === 'apm' ? `${config.serviceName}:${config.apmMetric}` : config.pattern }}</span>
            <div class="section-header-actions">
              <button class="save-btn" @click="saveEdit">Save</button>
              <button class="discard-btn" @click="cancelEdit">Cancel</button>
            </div>
          </div>
        </div>
      </template>
      <!-- View mode -->
      <template v-else>
        <div class="section-header">
          <div class="section-header-left">
            <span class="section-name">{{ config.name || config.pattern || `${config.serviceName}:${config.apmMetric}` }}</span>
            <span class="section-pattern mono" v-if="config.source === 'apm'">{{ config.serviceName }}:{{ config.apmMetric }}</span>
            <span class="section-pattern mono" v-else-if="config.name && config.name !== config.pattern">{{ config.pattern }}</span>
            <span class="state-badge mono" :class="config.state">{{ config.state }}</span>
            <span class="settings-badge mono">σ={{ config.sensitivity.toFixed(1) }} α={{ config.alpha.toFixed(2) }}</span>
            <span class="settings-badge mono" v-if="config.splitLabels?.length">split: {{ config.splitLabels.join(', ') }}</span>
            <template v-if="config.channelIds?.length">
              <span
                v-for="chId in config.channelIds"
                :key="chId"
                class="channel-badge"
              >{{ channels.find(c => c.id === chId)?.name || chId }}</span>
            </template>
          </div>
          <div class="section-header-actions" v-if="canWrite">
            <button class="edit-btn" @click="startEdit(config)" title="Edit monitor">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="delete-btn" @click="confirmDelete(config)" title="Remove monitor">&times;</button>
          </div>
        </div>
        <div class="section-description" v-if="config.description">{{ config.description }}</div>
      </template>
      <div class="charts-grid" v-if="(allConfigCharts[config.id] || []).length">
        <div v-for="(m, mi) in allConfigCharts[config.id]" :key="formatSeriesName(m.name, m.labels)" class="chart-card card" :data-chart-metric="formatSeriesName(m.name, m.labels)">
          <div class="chart-header">
            <div class="chart-header-left">
              <span class="chart-color-dot" :style="{ background: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []) }"></span>
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
              <span class="alert-action" v-if="m.anomalyCount > 0">
                <button
                  class="alert-bell"
                  :class="{ sent: alertSent.has(chartAlertKey(config.id, m)) }"
                  @click.stop="toggleAlertPicker(config.id, m)"
                  :title="alertSent.has(chartAlertKey(config.id, m)) ? 'Sent!' : 'Send alert'"
                >
                  <svg v-if="alertSent.has(chartAlertKey(config.id, m))" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                </button>
                <div class="alert-picker" v-if="alertPickerOpen === chartAlertKey(config.id, m)" @click.stop>
                  <template v-if="channels.length">
                    <div class="alert-picker-header">Send to channel</div>
                    <button
                      v-for="ch in channels"
                      :key="ch.id"
                      class="alert-picker-item"
                      :class="{
                        sending: alertSending.has(chartAlertKey(config.id, m) + ':' + ch.id),
                        sent: alertSent.has(chartAlertKey(config.id, m) + ':' + ch.id)
                      }"
                      :disabled="alertSending.has(chartAlertKey(config.id, m) + ':' + ch.id) || alertSent.has(chartAlertKey(config.id, m) + ':' + ch.id)"
                      @click="sendAlertToChannel(config, m, ch.id)"
                    >
                      <span class="alert-picker-type">{{ ch.channel_type }}</span>
                      <span class="alert-picker-name">{{ ch.name }}</span>
                      <svg v-if="alertSent.has(chartAlertKey(config.id, m) + ':' + ch.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button
                      v-if="channels.length > 1"
                      class="alert-picker-item alert-picker-all"
                      :disabled="alertSending.has(chartAlertKey(config.id, m)) || alertSent.has(chartAlertKey(config.id, m))"
                      @click="sendAlertToAll(config, m)"
                    >
                      Send to all
                      <svg v-if="alertSent.has(chartAlertKey(config.id, m))" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </template>
                  <div v-else class="alert-picker-empty">
                    <span>No channels configured</span>
                    <router-link to="/alerts" class="alert-picker-link" @click="closeAlertPicker">Create channel</router-link>
                  </div>
                </div>
              </span>
            </div>
          </div>
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
            <path :d="areaPath(m.values, m.maxVal)" :style="{ fill: config.splitLabels?.length ? seriesColor(mi, 0.10) : metricColor(m.name, configData[config.id] || [], 0.10) }" />
            <path :d="linePath(m.values, m.maxVal)" class="metric-line" :style="{ stroke: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []) }" />
            <template v-if="cursorX !== null">
              <line :x1="cursorX" :y1="pad.top" :x2="cursorX" :y2="pad.top + iH" class="crosshair" />
              <circle :cx="cursorX" :cy="dotY(m.values, m.maxVal)" r="3.5" class="crosshair-dot" :style="{ fill: config.splitLabels?.length ? seriesColor(mi) : metricColor(m.name, configData[config.id] || []), stroke: 'var(--bg-surface)' }" />
            </template>
          </svg>
        </div>
      </div>
      <div class="no-data card" v-else-if="!configData[config.id]?.length">
        <span class="empty-sub">No data for this pattern</span>
      </div>
    </div>
    </template>

    <!-- Empty State for monitors tab -->
    <div class="empty-panel card" v-if="!savedConfigs.length">
      <div class="empty-icon">&#128225;</div>
      <div class="empty-text">No monitors configured yet</div>
      <div class="empty-sub">Click "Add Monitor" to create your first anomaly detector</div>
      <router-link v-if="canWrite" to="/anomaly/add" class="add-btn empty-add">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Monitor
      </router-link>
    </div>
    </template>

    <!-- ═══ Delete Confirmation Modal ═══ -->
    <Teleport to="body">
      <div class="modal-overlay" v-if="deleteTarget" @click.self="cancelDelete">
        <div class="modal-box">
          <div class="modal-title">Delete Monitor</div>
          <div class="modal-body">
            Are you sure you want to delete
            <strong>{{ deleteTarget.name || deleteTarget.pattern }}</strong>?
            This cannot be undone.
          </div>
          <div class="modal-actions">
            <button class="discard-btn" @click="cancelDelete">Cancel</button>
            <button class="modal-delete-btn" @click="executeDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="../styles/views/AnomalyView.css"></style>
