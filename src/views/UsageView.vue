<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import { useTenant } from '../composables/useTenant'
import DataTable from '../components/DataTable.vue'
import { TimeSeriesPanel, type TimeSeriesPanelSeries } from '../components/panels'
import type {
  UsageResponse, UsageEntry, UnusedMetric, CardinalityEntry,
  LabelBreakdownResponse, LabelCardinality, UsageMeteringSummary,
  UsageMeteringBreakdown, UsageMeteringTenantBreakdown, UsageMeteringTenantsResponse, StatsResponse,
  PartitionStorage, TimeDomain,
} from '../types'

const api = useApi()
const route = useRoute()
const router = useRouter()
const { isAdmin } = useAuth()
const { activeTenantName, tenants, loadTenants } = useTenant()

const usage = ref<UsageResponse | null>(null)
const loadingUsage = ref(false)
const loadError = ref('')
const metering = ref<UsageMeteringSummary | null>(null)
const overviewMetering = ref<UsageMeteringSummary | null>(null)
const meteringBreakdown = ref<UsageMeteringBreakdown | null>(null)
const tenantMeteringBreakdown = ref<UsageMeteringTenantBreakdown | null>(null)
const tenantRanking = ref<UsageMeteringTenantsResponse | null>(null)
const stats = ref<StatsResponse | null>(null)
const ingestBuffer = ref<{ backend: string; pending_bytes: number; pending_count: number; max_bytes: number; used_pct: number; oldest_age_secs: number; committed_total: number } | null>(null)
const showStorage = ref(false)
const showPartitions = ref(false)
const partitions = ref<PartitionStorage[]>([])
const partitionsNow = ref(0)
const loadingPartitions = ref(false)
const partitionsLoaded = ref(false)
const partitionsError = ref('')
const expandedCold = ref<Record<string, boolean>>({})

const daysBack = ref(30)
const selectedTimeDomain = ref<TimeDomain>()
const allTenantsValue = '__all__'
const selectedUsageTenant = ref(isAdmin.value ? allTenantsValue : activeTenantName.value)
let usageRequestId = 0

const usageSectionKeys = ['overview', 'ingest', 'metrics', 'apm', 'logs'] as const
type UsageSection = typeof usageSectionKeys[number]
const activeUsageSection = computed<UsageSection>(() => {
  const tab = String(route.params.tab || '')
  if (tab === 'cardinality' || tab === 'unused') return 'metrics'
  return usageSectionKeys.includes(tab as UsageSection) ? tab as UsageSection : 'overview'
})

function selectUsageSection(section: UsageSection) {
  router.push({
    name: 'usage',
    params: { tab: section === 'overview' ? undefined : section },
    query: route.query,
  })
}

const dayPresets = [7, 14, 30, 60, 90]

const emptyUsageResponse = (): UsageResponse => ({
  usage: [],
  total: 0,
  unused: [],
  cardinality: [],
})

// Cardinality drill-down state
const expandedMetric = ref<string | null>(null)
const labelBreakdown = ref<LabelBreakdownResponse | null>(null)
const loadingBreakdown = ref(false)

onMounted(async () => {
  if (isAdmin.value) await loadTenants()
  selectedUsageTenant.value = isAdmin.value ? allTenantsValue : activeTenantName.value
  loadUsage()
  loadStats()
  if (isAdmin.value) loadIngestBuffer()
})

function selectedUsageScope() {
  return selectedUsageTenant.value === allTenantsValue
    ? { global: true }
    : selectedUsageTenant.value !== activeTenantName.value
      ? { tenant_id: selectedUsageTenant.value }
      : {}
}

async function loadUsage() {
  const requestId = ++usageRequestId
  const requestedTenant = selectedUsageTenant.value
  loadingUsage.value = true
  loadError.value = ''
  const to = new Date()
  const from = new Date(to.getTime() - daysBack.value * 86400000)
  const range = { from: from.toISOString(), to: to.toISOString() }
  const usageScope = selectedUsageScope()
  selectedTimeDomain.value = { from: from.getTime() / 1000, to: to.getTime() / 1000 }

  // The original signal-usage view must remain useful when a newer optional
  // metering endpoint is unavailable during a rolling backend deployment.
  const interval = daysBack.value > 31 ? 'day' : 'hour'
  const [signalResult, ingestResult, breakdownResult, tenantBreakdownResult] = await Promise.allSettled([
    api.getUsage({ days: daysBack.value, limit: 200, ...usageScope }),
    api.getUsageMeteringSummary({ ...range, ...usageScope }),
    api.getUsageMeteringBreakdown({ ...range, ...usageScope, interval }),
    requestedTenant === allTenantsValue
      ? api.getUsageMeteringTenantBreakdown({ ...range, interval })
      : Promise.resolve(null),
  ])

  if (requestId !== usageRequestId) return

  if (signalResult.status === 'fulfilled') {
    usage.value = signalResult.value
  } else if (!usage.value) {
    usage.value = emptyUsageResponse()
    loadError.value = signalResult.reason?.message || 'Unable to load signal usage.'
  }
  metering.value = ingestResult.status === 'fulfilled' ? ingestResult.value : null
  if (ingestResult.status === 'fulfilled' && requestedTenant === activeTenantName.value) {
    overviewMetering.value = ingestResult.value
  }
  meteringBreakdown.value = breakdownResult.status === 'fulfilled' ? breakdownResult.value : null
  tenantMeteringBreakdown.value = tenantBreakdownResult.status === 'fulfilled'
    ? tenantBreakdownResult.value
    : null

  if (isAdmin.value && requestedTenant === allTenantsValue) {
    try {
      const result = await api.getUsageMeteringTenants({ ...range, limit: 25 })
      if (requestId === usageRequestId) tenantRanking.value = result
    } catch {
      if (requestId === usageRequestId) tenantRanking.value = null
    }
  } else if (requestId === usageRequestId) {
    tenantRanking.value = null
  }
  if (requestId === usageRequestId) loadingUsage.value = false
}

function selectUsageTenant() {
  expandedMetric.value = null
  labelBreakdown.value = null
  loadUsage()
}

function selectDays(d: number) {
  daysBack.value = d
  loadUsage()
  loadStats()
  if (isAdmin.value) loadIngestBuffer()
}

async function loadStats() {
  const to = new Date()
  const from = new Date(to.getTime() - daysBack.value * 86400000)
  try {
    stats.value = await api.getStats({ time_range: { from: from.toISOString(), to: to.toISOString() } })
  } catch {
    stats.value = null
  }
}

async function loadIngestBuffer() {
  try { ingestBuffer.value = await api.getIngestBuffer() } catch { ingestBuffer.value = null }
}

async function loadPartitions() {
  loadingPartitions.value = true
  partitionsError.value = ''
  try {
    const result = await api.getStoragePartitions()
    partitions.value = result.partitions
    partitionsNow.value = result.now
    partitionsLoaded.value = true
  } catch {
    partitionsError.value = 'Could not load storage partitions.'
  } finally {
    loadingPartitions.value = false
  }
}

function togglePartitions() {
  showPartitions.value = !showPartitions.value
  if (showPartitions.value && !partitionsLoaded.value) loadPartitions()
}

function toggleCold(signal: string) {
  expandedCold.value[signal] = !expandedCold.value[signal]
}

async function toggleMetric(metric: string) {
  if (expandedMetric.value === metric) {
    expandedMetric.value = null
    labelBreakdown.value = null
    return
  }
  expandedMetric.value = metric
  loadingBreakdown.value = true
  try {
    labelBreakdown.value = await api.getLabelBreakdown(metric, selectedUsageScope())
  } catch {
    labelBreakdown.value = null
  } finally {
    loadingBreakdown.value = false
  }
}

const usageList = computed<UsageEntry[]>(() => usage.value?.usage ?? [])
const usageTenantOptions = computed(() => {
  const names = new Set(tenants.value.map(tenant => tenant.name))
  names.add(activeTenantName.value)
  return [...names].sort((a, b) => a.localeCompare(b))
})
const selectedUsageTenantLabel = computed(() => selectedUsageTenant.value === allTenantsValue
  ? 'All tenants'
  : selectedUsageTenant.value)
const isGlobalUsageScope = computed(() => selectedUsageTenant.value === allTenantsValue)
const usageGroups = computed(() => [
  {
    key: 'metric',
    label: 'Metrics',
    description: 'Metric names queried during this window, including the source and query frequency.',
    entries: usageList.value.filter(row => row.signal_type === 'metric'),
  },
  {
    key: 'span',
    label: 'APM / Spans',
    description: 'Application traces explored during this window, grouped by the signal name being queried.',
    entries: usageList.value.filter(row => row.signal_type === 'span'),
  },
  {
    key: 'log',
    label: 'Logs',
    description: 'Log searches made during this window, including query frequency, latency, and returned rows.',
    entries: usageList.value.filter(row => row.signal_type === 'log'),
  },
])
const unusedList = computed<UnusedMetric[]>(() => usage.value?.unused ?? [])
const cardinalityList = computed<CardinalityEntry[]>(() => usage.value?.cardinality ?? [])
const totalTracked = computed(() => usage.value?.total ?? 0)
const totalSeries = computed(() => cardinalityList.value.reduce((sum, c) => sum + c.series_count, 0))
const metricInventoryCount = computed(() => new Set([
  ...usageGroups.value[0]!.entries.map(row => row.signal_name),
  ...cardinalityList.value.map(row => row.metric_name),
  ...unusedList.value.map(row => row.metric_name),
]).size)
const activeUsageGroup = computed(() => usageGroups.value.find(group => group.key === (
  activeUsageSection.value === 'apm' ? 'span' : activeUsageSection.value.slice(0, -1)
)))

const totalDisk = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.bytes_on_disk, 0) ?? 0)
const totalRows = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.total_rows, 0) ?? 0)
const totalCompressed = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.compressed_bytes, 0) ?? 0)
const totalUncompressed = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.uncompressed_bytes, 0) ?? 0)
const overallCompression = computed(() => totalCompressed.value > 0
  ? `${(totalUncompressed.value / totalCompressed.value).toFixed(1)}x`
  : '—')
const objectStoreEnabled = computed(() => stats.value?.object_store_enabled ?? false)
const totalLocal = computed(() => stats.value?.storage.reduce((sum, table) => sum + (table.bytes_local ?? 0), 0) ?? 0)
const totalObjectStore = computed(() => stats.value?.storage.reduce((sum, table) => sum + (table.bytes_object_store ?? 0), 0) ?? 0)
const localPct = computed(() => {
  const total = totalLocal.value + totalObjectStore.value
  return total > 0 ? (totalLocal.value / total) * 100 : 100
})
const partitionGroups = computed(() => {
  const groups: Record<string, PartitionStorage[]> = {}
  for (const partition of partitions.value) (groups[partition.signal] ??= []).push(partition)
  return ['logs', 'traces', 'metrics', 'other'].filter(signal => groups[signal]?.length).map(signal => {
    const rows = groups[signal]!.slice().sort((a, b) => b.partition.localeCompare(a.partition))
    const hot = rows.filter(row => row.tier !== 'cold')
    const cold = rows.filter(row => row.tier === 'cold')
    const bytesLocal = rows.reduce((sum, row) => sum + row.bytes_local, 0)
    const bytesCold = rows.reduce((sum, row) => sum + row.bytes_object_store, 0)
    const total = bytesLocal + bytesCold
    const deleteTimes = cold.map(row => row.delete_at).filter((time): time is number => !!time)
    return {
      signal, rows, hot, cold, bytesLocal, bytesCold,
      partitionCount: rows.length,
      moveAfter: rows[0]!.move_after_days,
      retention: rows[0]!.retention_days,
      localPct: total > 0 ? (bytesLocal / total) * 100 : 100,
      coldDeleteMin: deleteTimes.length ? Math.min(...deleteTimes) : undefined,
      coldDeleteMax: deleteTimes.length ? Math.max(...deleteTimes) : undefined,
    }
  })
})

const ingestSignals = computed(() => Object.entries(metering.value?.signals ?? {})
  .map(([signal, counts]) => ({ signal, ...counts }))
  .sort((a, b) => b.bytes_count - a.bytes_count))
const usageNavigation = computed(() => [
  { key: 'overview' as UsageSection, label: 'Overview', count: null },
  { key: 'ingest' as UsageSection, label: 'Ingest', count: metering.value?.totals.events_count ?? null },
  { key: 'metrics' as UsageSection, label: 'Metrics', count: metricInventoryCount.value },
  { key: 'apm' as UsageSection, label: 'APM / Spans', count: null },
  { key: 'logs' as UsageSection, label: 'Logs', count: null },
])
const activeUsageLabel = computed(() => usageNavigation.value.find(item => item.key === activeUsageSection.value)?.label ?? 'Overview')
const ingestChartSeries = computed<TimeSeriesPanelSeries[]>(() => ingestSignals.value.flatMap(signal => {
  const points = (meteringBreakdown.value?.buckets ?? []).flatMap(bucket => {
    const timestamp = new Date(bucket.timestamp).getTime() / 1000
    return Number.isFinite(timestamp)
      ? [[timestamp, bucket.signals[signal.signal]?.bytes_count ?? 0] as [number, number]]
      : []
  })
  return points.length ? [{
    name: signalLabel(signal.signal),
    color: signalColor(signal.signal),
    points,
  }] : []
}))
const ingestBucketSeconds = computed(() => meteringBreakdown.value?.interval === 'day' ? 86_400 : 3_600)
const tenantSeriesColors = ['#2f6fec', '#e2884d', '#4caf7c', '#9c6ade', '#d4605a', '#47a3a3', '#c45ea0', '#7c8ea0']
const overviewIngestSeries = computed<TimeSeriesPanelSeries[]>(() => {
  if (!isGlobalUsageScope.value) {
    const points = (meteringBreakdown.value?.buckets ?? []).flatMap(bucket => {
      const timestamp = new Date(bucket.timestamp).getTime() / 1000
      const bytes = Object.values(bucket.signals).reduce((sum, signal) => sum + signal.bytes_count, 0)
      return Number.isFinite(timestamp) ? [[timestamp, bytes] as [number, number]] : []
    })
    return points.length ? [{
      name: selectedUsageTenantLabel.value,
      color: tenantSeriesColors[0]!,
      points,
    }] : []
  }

  const totals = new Map<string, number>()
  for (const bucket of tenantMeteringBreakdown.value?.buckets ?? []) {
    for (const [tenantId, counts] of Object.entries(bucket.tenants)) {
      totals.set(tenantId, (totals.get(tenantId) ?? 0) + counts.bytes_count)
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tenantId], index) => ({
      name: tenantId,
      color: tenantSeriesColors[index % tenantSeriesColors.length]!,
      points: (tenantMeteringBreakdown.value?.buckets ?? []).flatMap(bucket => {
        const timestamp = new Date(bucket.timestamp).getTime() / 1000
        return Number.isFinite(timestamp)
          ? [[timestamp, bucket.tenants[tenantId]?.bytes_count ?? 0] as [number, number]]
          : []
      }),
    }))
})

function formatBytes(bytes: number): string {
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(2)} TiB`
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GiB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatRate(rate: number): string {
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}k/s`
  if (rate >= 1) return `${rate.toFixed(1)}/s`
  if (rate >= 0.01) return `${rate.toFixed(2)}/s`
  return `${rate.toFixed(3)}/s`
}

function formatQueryDuration(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}

function formatQueryResults(value: number | null | undefined): string {
  if (value == null) return '—'
  return formatCount(Math.round(value))
}

function compressionRatio(row: { compressed_bytes: number; uncompressed_bytes: number }): string {
  return row.compressed_bytes > 0 ? `${(row.uncompressed_bytes / row.compressed_bytes).toFixed(1)}x` : '—'
}

function untilLabel(epoch?: number): string {
  if (!epoch) return '—'
  const now = partitionsNow.value || Math.floor(Date.now() / 1000)
  let seconds = epoch - now
  if (seconds <= 0) return 'due'
  const days = Math.floor(seconds / 86400)
  seconds -= days * 86400
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `in ${days}d${hours ? ` ${hours}h` : ''}`
  if (hours) return `in ${hours}h${minutes ? ` ${minutes}m` : ''}`
  return `in ${minutes}m`
}

function tierLabel(tier: string): string {
  return tier === 'cold' ? 'S3' : tier === 'mixed' ? 'local + S3' : 'local'
}

function signalLabel(signal: string): string {
  return signal === 'traces' ? 'Traces' : signal.charAt(0).toUpperCase() + signal.slice(1)
}

function signalColor(signal: string): string {
  return signal === 'metrics' ? 'var(--ok)' : signal === 'logs' ? '#5b8dd9' : signal === 'traces' ? 'var(--amber)' : '#9b7dd4'
}

const breakdownTotal = computed(() => {
  if (!labelBreakdown.value) return 0
  return labelBreakdown.value.labels.reduce((s, l) => s + l.unique_values, 0)
})

function formatDate(ts: string): string {
  const ms = parseInt(ts, 10)
  if (isNaN(ms)) return ts
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  return Math.floor(diff / 86_400_000) + 'd ago'
}

function cardinalityPct(count: number): number {
  const max = cardinalityList.value[0]?.series_count || 1
  return Math.max(2, (count / max) * 100)
}

function cardinalityLevel(count: number): string {
  if (count >= 1000) return 'card-high'
  if (count >= 100) return 'card-medium'
  return 'card-low'
}

// Treemap colors
const treemapColors = [
  '#e2884d', '#5b8dd9', '#4caf7c', '#d4605a', '#9c6ade',
  '#e0a030', '#47a3a3', '#c45ea0', '#7c8ea0', '#6bbf6b',
]

function treemapPct(label: LabelCardinality): number {
  if (!breakdownTotal.value) return 0
  return (label.unique_values / breakdownTotal.value) * 100
}
</script>

<template>
  <div class="usage-view">
    <header class="usage-header">
      <h1>Signal Usage</h1>
      <p class="subtitle">Track which metrics, spans, and logs are being queried</p>
    </header>

    <div v-if="loadError" class="usage-load-error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" @click="loadUsage">Retry</button>
    </div>

    <div class="usage-navigation-shell">
      <div class="usage-detail-head">
        <div>
          <div class="section-kicker">Usage analysis · selected window</div>
          <h2>{{ activeUsageLabel }}</h2>
          <p>Move between collection and signal families. Metric usage, cardinality, and unused metrics stay together.</p>
        </div>
        <div class="usage-header-filters">
          <label v-if="isAdmin" class="usage-tenant-filter">
            <span class="usage-control-label">Tenant</span>
            <select v-model="selectedUsageTenant" aria-label="Ingest tenant" @change="selectUsageTenant">
              <option :value="allTenantsValue">All tenants</option>
              <option v-for="tenantName in usageTenantOptions" :key="tenantName" :value="tenantName">
                {{ tenantName }}
              </option>
            </select>
          </label>
          <div class="usage-lookback" role="group" aria-label="Lookback">
            <span class="usage-control-label">Lookback</span>
            <div class="btn-group">
              <button
                v-for="d in dayPresets"
                :key="d"
                type="button"
                :class="{ active: daysBack === d }"
                :aria-pressed="daysBack === d"
                @click="selectDays(d)"
              >
                {{ d }}d
              </button>
            </div>
          </div>
        </div>
      </div>
      <nav class="usage-subnav" aria-label="Usage sections">
        <button
          v-for="item in usageNavigation"
          :key="item.key"
          type="button"
          class="usage-subnav-item"
          :class="{ active: activeUsageSection === item.key }"
          :aria-current="activeUsageSection === item.key ? 'page' : undefined"
          @click="selectUsageSection(item.key)"
        >
          <span class="usage-subnav-label">{{ item.label }}</span>
          <span v-if="item.count !== null" class="usage-subnav-count mono">{{ item.key === 'ingest' ? formatCount(item.count) : item.count }}</span>
        </button>
      </nav>
    </div>

    <!-- The former Settings → Stats overview now lives here, above the
         query-usage detail so operators get system context before drilling in. -->
    <section v-if="stats && activeUsageSection === 'overview'" class="stats-snapshot">
      <div class="section-heading-row">
        <div>
          <div class="section-kicker">System footprint · {{ activeTenantName || 'active tenant' }}</div>
          <h2>Collection and storage</h2>
          <p>How much Rush is receiving, retaining, and processing in the selected window.</p>
        </div>
        <span class="scope-chip"><span class="scope-dot"></span> tenant scoped</span>
      </div>

      <div class="stats-snapshot-grid">
        <article class="stats-snapshot-card">
          <div class="snapshot-label"><span class="snapshot-dot snapshot-dot-metrics"></span>Metrics</div>
          <strong>{{ formatCount(stats.metrics.total_datapoints) }}</strong>
          <span>{{ formatRate(stats.metrics.datapoints_per_sec) }} · {{ formatCount(stats.metrics.unique_series) }} series</span>
          <small v-if="overviewMetering?.signals.metrics">{{ formatBytes(overviewMetering.signals.metrics.bytes_count) }} ingested</small>
        </article>
        <article class="stats-snapshot-card">
          <div class="snapshot-label"><span class="snapshot-dot snapshot-dot-traces"></span>Spans</div>
          <strong>{{ formatCount(stats.spans.total_events) }}</strong>
          <span>{{ formatRate(stats.spans.events_per_sec) }} · {{ formatCount(stats.spans.events_today) }} today</span>
          <small v-if="overviewMetering?.signals.traces">{{ formatBytes(overviewMetering.signals.traces.bytes_count) }} ingested</small>
        </article>
        <article class="stats-snapshot-card">
          <div class="snapshot-label"><span class="snapshot-dot snapshot-dot-logs"></span>Logs</div>
          <strong>{{ formatCount(stats.logs.total_events) }}</strong>
          <span>{{ formatRate(stats.logs.events_per_sec) }} · {{ formatCount(stats.logs.events_today) }} today</span>
          <small v-if="overviewMetering?.signals.logs">{{ formatBytes(overviewMetering.signals.logs.bytes_count) }} ingested</small>
        </article>
        <article class="stats-snapshot-card stats-snapshot-card--storage">
          <div class="snapshot-label"><span class="snapshot-dot snapshot-dot-storage"></span>Storage</div>
          <strong>{{ formatBytes(totalDisk) }}</strong>
          <span>{{ formatCount(totalRows) }} rows · {{ overallCompression }} compression</span>
          <small>{{ objectStoreEnabled ? `${formatBytes(totalLocal)} local · ${formatBytes(totalObjectStore)} object store` : 'all data local' }}</small>
        </article>
      </div>

      <div v-if="isAdmin && ingestBuffer" class="ingest-status" :class="{ 'ingest-status--backlog': ingestBuffer.pending_count > 0 }">
        <span class="ingest-status-label">Ingest buffer</span>
        <span class="mono ingest-status-backend">{{ ingestBuffer.backend }}</span>
        <span class="ingest-status-separator">·</span>
        <template v-if="ingestBuffer.pending_count > 0">
          <strong class="mono">{{ ingestBuffer.pending_count }} pending</strong>
          <span class="mono">{{ formatBytes(ingestBuffer.pending_bytes) }} / {{ formatBytes(ingestBuffer.max_bytes) }} ({{ ingestBuffer.used_pct.toFixed(1) }}%)</span>
          <span v-if="ingestBuffer.oldest_age_secs > 0" class="mono">oldest {{ ingestBuffer.oldest_age_secs >= 60 ? Math.round(ingestBuffer.oldest_age_secs / 60) + 'm' : Math.round(ingestBuffer.oldest_age_secs) + 's' }}</span>
          <span class="ingest-status-note">ClickHouse is catching up</span>
        </template>
        <span v-else class="mono ingest-status-ok">empty · writing directly to ClickHouse</span>
      </div>

      <button type="button" class="storage-toggle" :aria-expanded="showStorage" @click="showStorage = !showStorage">
        <span><span class="section-kicker">Retention footprint</span><b>Storage details</b></span>
        <span class="storage-toggle-meta mono">{{ stats.storage.length }} tables · {{ showStorage ? 'hide' : 'inspect' }} <span :class="{ rotated: showStorage }">⌄</span></span>
      </button>

      <Transition name="usage-expand">
        <div v-if="showStorage" class="storage-detail-panel">
          <div class="tier-summary">
            <div class="tier-summary-head"><span class="tier-summary-title">Storage tiers</span><span class="mono tier-summary-note">{{ objectStoreEnabled ? 'object store enabled' : 'object-store tiering not configured' }}</span></div>
            <div class="tier-bar"><div class="tier-seg tier-seg-local" :style="{ width: `${localPct}%` }"></div><div v-if="objectStoreEnabled" class="tier-seg tier-seg-object" :style="{ width: `${100 - localPct}%` }"></div></div>
            <div class="tier-legend"><span><i class="tier-dot tier-dot-local"></i>local {{ formatBytes(totalLocal) }} · {{ localPct.toFixed(1) }}%</span><span v-if="objectStoreEnabled"><i class="tier-dot tier-dot-object"></i>object store {{ formatBytes(totalObjectStore) }} · {{ (100 - localPct).toFixed(1) }}%</span></div>
          </div>
          <div class="storage-table-wrap">
            <DataTable class="storage-table" bare><thead><tr><th>Table</th><th>Rows</th><th>Disk</th><th>Compressed</th><th>Uncompressed</th><th>Ratio</th></tr></thead><tbody>
              <tr v-for="table in stats.storage" :key="table.table_name"><td class="mono">{{ table.table_name }}</td><td class="mono">{{ formatCount(table.total_rows) }}</td><td class="mono">{{ formatBytes(table.bytes_on_disk) }}</td><td class="mono">{{ formatBytes(table.compressed_bytes) }}</td><td class="mono">{{ formatBytes(table.uncompressed_bytes) }}</td><td class="mono">{{ compressionRatio(table) }}</td></tr>
              <tr class="storage-total"><td>Total</td><td class="mono">{{ formatCount(totalRows) }}</td><td class="mono">{{ formatBytes(totalDisk) }}</td><td class="mono">{{ formatBytes(totalCompressed) }}</td><td class="mono">{{ formatBytes(totalUncompressed) }}</td><td class="mono">{{ overallCompression }}</td></tr>
            </tbody></DataTable>
          </div>
          <button v-if="isAdmin" type="button" class="partition-toggle" :aria-expanded="showPartitions" @click="togglePartitions"><span :class="{ rotated: showPartitions }">⌄</span>Partitions · local vs object store and retention timing</button>
          <div v-if="isAdmin && showPartitions" class="partition-panel">
            <div v-if="loadingPartitions" class="partition-message mono">Loading partitions…</div>
            <div v-else-if="partitionsError" class="partition-message mono">{{ partitionsError }}</div>
            <div v-else-if="!partitionGroups.length" class="partition-message mono">No partitions reported.</div>
            <template v-else>
              <div v-for="group in partitionGroups" :key="group.signal" class="partition-group">
                <div class="partition-group-head"><b>{{ group.signal }}</b><span class="mono">{{ group.partitionCount }} partitions · move {{ group.moveAfter }}d · keep {{ group.retention }}d</span></div>
                <div class="tier-bar"><div class="tier-seg tier-seg-local" :style="{ width: `${group.localPct}%` }"></div><div class="tier-seg tier-seg-object" :style="{ width: `${100 - group.localPct}%` }"></div></div>
                <div class="partition-tier-legend mono">local {{ formatBytes(group.bytesLocal) }} · S3 {{ formatBytes(group.bytesCold) }} · {{ group.cold.length }} cold</div>
                <div v-if="group.hot.length" class="partition-table-wrap"><DataTable class="storage-table partition-table" bare><thead><tr><th>Partition</th><th>Local</th><th>Object store</th><th>Tier</th><th>Moves</th><th>Deletes</th></tr></thead><tbody><tr v-for="partition in group.hot" :key="partition.table + partition.partition"><td class="mono">{{ partition.partition }}</td><td class="mono">{{ partition.bytes_local ? formatBytes(partition.bytes_local) : '—' }}</td><td class="mono">{{ partition.bytes_object_store ? formatBytes(partition.bytes_object_store) : '—' }}</td><td><span class="tier-pill" :class="`tier-pill-${partition.tier}`">{{ tierLabel(partition.tier) }}</span></td><td class="mono">{{ untilLabel(partition.move_at_estimate) }}</td><td class="mono">{{ untilLabel(partition.delete_at) }}</td></tr></tbody></DataTable></div>
                <button v-if="group.cold.length" type="button" class="cold-summary" @click="toggleCold(group.signal)"><span :class="{ rotated: expandedCold[group.signal] }">⌄</span><span class="mono">{{ group.cold.length }} partitions on S3 ({{ formatBytes(group.bytesCold) }})</span><span class="mono">deleting {{ untilLabel(group.coldDeleteMin) }} … {{ untilLabel(group.coldDeleteMax) }}</span></button>
                <div v-if="expandedCold[group.signal]" class="cold-list"><div v-for="partition in group.cold" :key="partition.table + partition.partition" class="cold-row mono"><span>{{ partition.partition }}</span><span>{{ formatBytes(partition.bytes_object_store) }}</span><span>{{ untilLabel(partition.delete_at) }}</span></div></div>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </section>

    <!-- Ingest volume is kept separate from query usage so an operator can
         distinguish collection cost from exploration. -->
    <section v-if="metering && activeUsageSection === 'ingest'" class="ingest-board">
      <div class="section-heading-row">
        <div>
          <div class="section-kicker">{{ isGlobalUsageScope ? 'Global ingest' : 'Tenant ingest' }} · {{ selectedUsageTenantLabel }}</div>
          <h2>Ingest footprint</h2>
          <p>{{ isGlobalUsageScope ? 'Combined ingestion from every tenant during the selected window.' : `Ingestion from ${selectedUsageTenantLabel} during the selected window.` }}</p>
        </div>
        <span class="scope-chip" :class="{ 'scope-chip--global': isGlobalUsageScope }"><span class="scope-dot"></span>{{ isGlobalUsageScope ? 'all tenants' : 'tenant scoped' }}</span>
      </div>

      <div class="ingest-summary-grid">
        <div class="ingest-summary-card">
          <span class="summary-label">Ingested</span>
          <strong>{{ formatBytes(metering.totals.bytes_count) }}</strong>
          <small>{{ formatCount(metering.totals.events_count) }} events</small>
        </div>
        <div class="ingest-summary-card">
          <span class="summary-label">Signals active</span>
          <strong>{{ ingestSignals.length }}</strong>
          <small>logs, traces, metrics, or RUM</small>
        </div>
        <div class="ingest-summary-card ingest-summary-card--accent">
          <span class="summary-label">Largest stream</span>
          <strong>{{ ingestSignals[0] ? signalLabel(ingestSignals[0].signal) : '—' }}</strong>
          <small>{{ ingestSignals[0] ? formatBytes(ingestSignals[0].bytes_count) : 'No ingest yet' }}</small>
        </div>
      </div>

      <div class="ingest-analysis-grid">
        <div class="ingest-panel">
          <div class="panel-heading">
            <div><span class="section-kicker">Composition</span><h3>Volume by signal</h3></div>
            <span class="panel-meta mono">bytes</span>
          </div>
          <div v-if="ingestSignals.length" class="signal-volume-list">
            <div v-for="row in ingestSignals" :key="row.signal" class="signal-volume-row">
              <div class="signal-volume-label"><span class="signal-dot" :style="{ background: signalColor(row.signal) }"></span><span>{{ signalLabel(row.signal) }}</span><span class="mono">{{ formatBytes(row.bytes_count) }}</span></div>
              <div class="signal-volume-track"><span :style="{ width: `${Math.max(2, row.bytes_count / Math.max(1, metering.totals.bytes_count) * 100)}%`, background: signalColor(row.signal) }"></span></div>
              <div class="signal-volume-foot mono">{{ formatCount(row.events_count) }} events</div>
            </div>
          </div>
          <div v-else class="inline-empty">No ingest has been recorded in this window.</div>
        </div>

        <TimeSeriesPanel
          class="ingest-timeline-panel"
          title="Ingest over time"
          description="Bytes received in each interval, stacked by signal. Hover over a bucket to compare its logs, traces, metrics, and RUM volume."
          :range-label="`${daysBack}d`"
          display-mode="stacked-bars"
          :bucket-seconds="ingestBucketSeconds"
          :time-domain="selectedTimeDomain"
          :series="ingestChartSeries"
          unit="B"
          empty-title="No ingest buckets"
          empty-message="No ingest was recorded in the selected window."
        />
      </div>
    </section>

    <section v-if="activeUsageSection === 'ingest' && isAdmin && isGlobalUsageScope && tenantRanking?.tenants.length" class="tenant-ranking-section">
      <div class="section-heading-row">
        <div><div class="section-kicker">Admin view · all tenants</div><h2>Collection load by tenant</h2><p>Use this ranking to spot noisy tenants before they dominate shared capacity.</p></div>
        <span class="scope-chip scope-chip--global"><span class="scope-dot"></span> global read</span>
      </div>
      <div class="tenant-ranking-table-wrap">
        <DataTable class="tenant-ranking-table" bare>
          <thead><tr><th>Tenant</th><th class="num">Events</th><th class="num">Ingest</th><th>Signal mix</th></tr></thead>
          <tbody>
            <tr v-for="tenant in tenantRanking.tenants" :key="tenant.tenant_id">
              <td><span class="tenant-name-cell">{{ tenant.tenant_id }}</span></td>
              <td class="num mono">{{ formatCount(tenant.events_count) }}</td>
              <td class="num mono">{{ formatBytes(tenant.bytes_count) }}</td>
              <td><div class="tenant-signal-mix"><span v-for="row in Object.entries(tenant.signals).sort((a, b) => b[1].bytes_count - a[1].bytes_count)" :key="row[0]" class="tenant-signal-pill" :style="{ '--pill-color': signalColor(row[0]) }">{{ signalLabel(row[0]) }} {{ formatBytes(row[1].bytes_count) }}</span></div></td>
            </tr>
          </tbody>
        </DataTable>
      </div>
    </section>

    <div v-if="loadingUsage" class="loading-state">Loading usage data...</div>

    <section v-else-if="usage" class="usage-detail">
      <section v-if="activeUsageSection === 'overview'" class="usage-overview-section">
        <div class="usage-section-heading">
          <div>
            <div class="section-kicker">Query behavior</div>
            <h2>Query activity overview</h2>
            <p>Use the sub-navigation above to inspect one signal family at a time.</p>
          </div>
        </div>
        <div class="summary-row">
        <div class="summary-card">
          <div class="summary-value">{{ totalTracked }}</div>
          <div class="summary-label">Tracked signals</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ totalSeries.toLocaleString() }}</div>
          <div class="summary-label">Total series</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ cardinalityList.length }}</div>
          <div class="summary-label">Unique metrics</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ unusedList.length }}</div>
          <div class="summary-label">Unused metrics</div>
        </div>
        </div>
      </section>

      <TimeSeriesPanel
        v-if="activeUsageSection === 'overview'"
        class="usage-overview-ingest-panel"
        :title="isGlobalUsageScope ? 'Ingestion by tenant' : `Ingestion for ${selectedUsageTenantLabel}`"
        :description="isGlobalUsageScope
          ? 'Each bucket is the total bytes received. Tenant series stack to the combined ingestion total.'
          : `Bytes received from ${selectedUsageTenantLabel} in each interval.`"
        :range-label="`${daysBack}d`"
        display-mode="stacked-bars"
        :bucket-seconds="ingestBucketSeconds"
        :time-domain="selectedTimeDomain"
        :series="overviewIngestSeries"
        unit="B"
        empty-title="No ingestion in this window"
        :empty-message="isGlobalUsageScope ? 'No tenants sent data during the selected window.' : `${selectedUsageTenantLabel} did not send data during the selected window.`"
      />

      <!-- Keep each query family in its own surface so operators can scan one
           signal type without sorting through a mixed table. Metrics also owns
           inventory health because cardinality and unused series are metric-only. -->
      <section v-if="activeUsageGroup" class="usage-section usage-section--signal">
        <div class="usage-section-heading">
          <div>
            <div class="section-kicker">Query activity · {{ activeUsageGroup.key === 'span' ? 'apm' : activeUsageGroup.key }}</div>
            <h2>
              {{ activeUsageGroup.key === 'metric' ? 'Queried metrics' : activeUsageGroup.label }}
              <span v-if="activeUsageGroup.key === 'metric'" class="badge-count">{{ activeUsageGroup.entries.length }}</span>
            </h2>
            <p>{{ activeUsageGroup.description }}</p>
          </div>
          <span class="usage-section-marker" :class="`usage-section-marker--${activeUsageGroup.key}`"></span>
        </div>
        <div class="usage-table-wrap">
          <DataTable v-if="activeUsageGroup.entries.length > 0" class="usage-table" bare>
            <thead>
              <tr>
                <th>Signal Name</th>
                <th>Source</th>
                <th>Last Queried</th>
                <th v-if="activeUsageGroup.key === 'log'">Query time</th>
                <th v-if="activeUsageGroup.key === 'log'">Results returned</th>
                <th class="num">Queries</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in activeUsageGroup.entries" :key="i">
                <td class="signal-name">{{ row.signal_name }}</td>
                <td class="source-cell">{{ row.source }}</td>
                <td class="date-cell">{{ formatDate(row.last_queried_at) }}</td>
                <td v-if="activeUsageGroup.key === 'log'">
                  <div v-if="row.query_samples" class="query-stat-range" aria-label="Low, average, and high query time">
                    <span><small>LOW</small><strong>{{ formatQueryDuration(row.low_duration_ms) }}</strong></span>
                    <span><small>AVG</small><strong>{{ formatQueryDuration(row.avg_duration_ms) }}</strong></span>
                    <span><small>HIGH</small><strong>{{ formatQueryDuration(row.high_duration_ms) }}</strong></span>
                  </div>
                  <span v-else class="query-stat-unavailable">—</span>
                </td>
                <td v-if="activeUsageGroup.key === 'log'">
                  <div v-if="row.query_samples" class="query-stat-range" aria-label="Low, average, and high results returned">
                    <span><small>LOW</small><strong>{{ formatQueryResults(row.low_result_rows) }}</strong></span>
                    <span><small>AVG</small><strong>{{ formatQueryResults(row.avg_result_rows) }}</strong></span>
                    <span><small>HIGH</small><strong>{{ formatQueryResults(row.high_result_rows) }}</strong></span>
                  </div>
                  <span v-else class="query-stat-unavailable">—</span>
                </td>
                <td class="num">{{ row.query_count }}</td>
              </tr>
            </tbody>
          </DataTable>
          <div v-else class="empty-state">
            {{ activeUsageGroup.key === 'metric'
              ? 'No PromQL metric queries were recorded in this window. Cardinality and unused metrics are still available below.'
              : `No ${activeUsageGroup.label.toLowerCase()} usage in this window.` }}
          </div>
        </div>
      </section>

      <!-- Cardinality explorer -->
      <section class="usage-section" v-if="activeUsageSection === 'metrics'">
        <h2>Cardinality explorer <span class="badge-count">{{ totalSeries.toLocaleString() }} series</span></h2>
        <p class="section-desc">Click a metric to see which labels drive its cardinality.</p>
        <div v-if="cardinalityList.length > 0" class="usage-table-wrap">
          <DataTable class="usage-table usage-table-scroll cardinality-table" bare>
            <thead>
              <tr>
                <th>Metric Name</th>
                <th class="num">Series</th>
                <th class="num">Labels</th>
                <th>Cardinality</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, i) in cardinalityList" :key="i">
                <tr class="card-row" :class="{ expanded: expandedMetric === row.metric_name }" @click="toggleMetric(row.metric_name)">
                  <td class="signal-name">
                    <span class="expand-icon">{{ expandedMetric === row.metric_name ? '▾' : '▸' }}</span>
                    {{ row.metric_name }}
                  </td>
                  <td class="num">{{ row.series_count.toLocaleString() }}</td>
                  <td class="num">{{ row.label_count }}</td>
                  <td class="bar-cell">
                    <div class="cardinality-bar" :style="{ width: cardinalityPct(row.series_count) + '%' }" :class="cardinalityLevel(row.series_count)"></div>
                  </td>
                </tr>
                <!-- Expanded label breakdown -->
                <tr v-if="expandedMetric === row.metric_name" class="breakdown-row">
                  <td colspan="4">
                    <div v-if="loadingBreakdown" class="breakdown-loading">Loading label breakdown...</div>
                    <div v-else-if="labelBreakdown && labelBreakdown.labels.length > 0" class="breakdown-panel">
                      <div class="breakdown-header">
                        <span class="breakdown-title">Label Cardinality for {{ row.metric_name }}</span>
                        <span class="breakdown-total">{{ labelBreakdown.total_series.toLocaleString() }} total series</span>
                      </div>

                      <!-- Treemap visualization -->
                      <div class="treemap">
                        <div
                          v-for="(label, j) in labelBreakdown.labels"
                          :key="label.label_key"
                          class="treemap-block"
                          :style="{
                            flexBasis: Math.max(treemapPct(label), 8) + '%',
                            flexGrow: treemapPct(label),
                            background: treemapColors[j % treemapColors.length],
                          }"
                        >
                          <div class="treemap-label">{{ label.label_key }}</div>
                          <div class="treemap-value">{{ label.unique_values }} values</div>
                          <div class="treemap-pct">{{ treemapPct(label).toFixed(0) }}%</div>
                        </div>
                      </div>

                      <!-- Label table -->
                      <DataTable class="breakdown-table" bare>
                        <thead>
                          <tr>
                            <th>Label</th>
                            <th class="num">Unique Values</th>
                            <th>Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(label, j) in labelBreakdown.labels" :key="label.label_key">
                            <td class="label-key">
                              <span class="label-dot" :style="{ background: treemapColors[j % treemapColors.length] }"></span>
                              {{ label.label_key }}
                            </td>
                            <td class="num">{{ label.unique_values }}</td>
                            <td>
                              <div class="share-bar-wrap">
                                <div class="share-bar" :style="{ width: treemapPct(label) + '%', background: treemapColors[j % treemapColors.length] }"></div>
                                <span class="share-text">{{ treemapPct(label).toFixed(1) }}%</span>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </DataTable>
                    </div>
                    <div v-else class="breakdown-empty">No label data available.</div>
                  </td>
                </tr>
              </template>
            </tbody>
          </DataTable>
        </div>
        <div v-else class="empty-state">No cardinality data is available in this window.</div>
      </section>

      <!-- Unused metrics -->
      <section class="usage-section" v-if="activeUsageSection === 'metrics'">
        <h2>Unused metrics <span class="badge-count">{{ unusedList.length }}</span></h2>
        <p class="section-desc">These metrics are being collected but haven't been queried in the last {{ daysBack }} days.</p>
        <div v-if="unusedList.length > 0" class="usage-table-wrap">
          <DataTable class="usage-table usage-table-scroll" bare>
            <thead>
              <tr>
                <th>Metric Name</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in unusedList" :key="i">
                <td class="signal-name">{{ row.metric_name }}</td>
              </tr>
            </tbody>
          </DataTable>
        </div>
        <div v-else class="empty-state">No unused metrics were found in this window.</div>
      </section>
    </section>
  </div>
</template>

<style scoped src="../styles/views/UsageView.css"></style>
