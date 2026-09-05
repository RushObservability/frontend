<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { usePollingTask } from '../composables/usePollingTask'
import {
  appendCapacitySnapshot,
  capacityGuideRows,
  evaluateCapacity,
  type CapacityRecommendation,
  type CapacitySeverity,
  type CapacitySnapshot,
} from '../lib/capacityModel'
import type { StatsResponse } from '../types'

const api = useApi()
const rawMetrics = ref('')
const stats = ref<StatsResponse | null>(null)
const ingestBuffer = ref<{ pending_bytes: number; pending_count: number; max_bytes: number; used_pct: number; oldest_age_secs: number } | null>(null)
const capacityHistory = ref<CapacitySnapshot[]>([])
const loading = ref(false)
const error = ref('')
const refreshedAt = ref<Date | null>(null)

function parseMetrics(text: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+0-9.eEInfNa]+)$/)
    if (!match) continue
    const name = match[1]
    const sample = match[2]
    if (!name || sample === undefined) continue
    const value = Number(sample)
    if (!Number.isFinite(value)) continue
    values.set(name, (values.get(name) || 0) + value)
  }
  return values
}

const metrics = computed(() => parseMetrics(rawMetrics.value))
function metric(name: string): number { return metrics.value.get(name) || 0 }
function optionalMetric(name: string): number | null { return metrics.value.get(name) ?? null }
function positiveMetric(name: string): number | null {
  const value = optionalMetric(name)
  return value !== null && value > 0 ? value : null
}
function ratio(value: number | null, limit: number | null): number | null {
  return value !== null && limit !== null && limit > 0 ? value / limit : null
}

const storageBytes = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.bytes_on_disk, 0) || 0)
const storageRows = computed(() => stats.value?.storage.reduce((sum, table) => sum + table.total_rows, 0) || 0)
const diskFree = computed(() => metric('rush_stats_disk_local_free_bytes'))
const diskTotal = computed(() => metric('rush_stats_disk_local_total_bytes'))
const diskUsedPct = computed<number | null>(() => optionalMetric('rush_ch_max_disk_used_pct')
  ?? (diskTotal.value > 0 ? ((diskTotal.value - diskFree.value) / diskTotal.value) * 100 : null))
const processMemory = computed(() => metric('rush_process_resident_memory_bytes'))
const processMemoryLimit = computed(() => positiveMetric('rush_process_memory_limit_bytes'))
const processMemoryRatio = computed(() => ratio(processMemory.value, processMemoryLimit.value))
const processCpuRatio = computed(() => optionalMetric('rush_process_cpu_utilization_ratio'))
const processOpenFds = computed(() => positiveMetric('rush_process_open_fds'))
const processOpenFdsLimit = computed(() => positiveMetric('rush_process_open_fds_limit'))
const chMemory = computed(() => Math.max(metric('rush_ch_memory_tracking_bytes'), metric('rush_ch_memory_resident_bytes')))
const chMemoryLimit = computed(() => positiveMetric('rush_ch_memory_capacity_bytes'))
const chMemoryRatio = computed(() => ratio(chMemory.value, chMemoryLimit.value))
const recentQueries = computed(() => optionalMetric('rush_ch_query_log_recent_queries'))
const queryP95 = computed<number | null>(() => (recentQueries.value ?? 0) > 0
  ? optionalMetric('rush_ch_query_log_p95_duration_ms')
  : null)
const activeQueries = computed(() => optionalMetric('rush_ch_active_queries'))
const queryLimit = computed(() => positiveMetric('rush_ch_max_concurrent_select_queries'))
const queryConcurrencyRatio = computed(() => ratio(activeQueries.value, queryLimit.value))
const longestQueryMs = computed(() => {
  const seconds = optionalMetric('rush_ch_longest_running_query_secs')
  return seconds !== null && seconds > 0 ? seconds * 1_000 : null
})
const activeMerges = computed(() => metric('rush_ch_active_merges'))
const activeMutations = computed(() => metric('rush_ch_active_mutations'))
const oldestMutationSecs = computed(() => metric('rush_ch_oldest_mutation_secs'))
const backgroundPoolSize = computed(() => positiveMetric('rush_ch_background_pool_size'))
const backgroundPoolRatio = computed(() => ratio(metric('rush_ch_background_pool_task'), backgroundPoolSize.value))
const maxParts = computed(() => metric('rush_ch_max_part_count_for_partition'))
const partsDelayThreshold = computed(() => positiveMetric('rush_ch_parts_delay_threshold'))
const spoolPct = computed(() => ingestBuffer.value?.used_pct || metric('rush_ingest_spool_bytes') / Math.max(1, ingestBuffer.value?.max_bytes || 1) * 100)

function recordCapacitySnapshot() {
  capacityHistory.value = appendCapacitySnapshot(capacityHistory.value, {
    capturedAt: Date.now(),
    queryP95Ms: queryP95.value,
    activeQueries: activeQueries.value,
    queryLimit: queryLimit.value,
    spoolUsedPct: spoolPct.value,
    spoolOldestAgeSecs: ingestBuffer.value?.oldest_age_secs || 0,
    diskUsedPct: diskUsedPct.value,
    maxParts: maxParts.value,
    partsDelayThreshold: partsDelayThreshold.value,
    delayedInserts: metric('rush_ch_delayed_inserts'),
    rejectedInsertsTotal: metric('rush_ch_rejected_inserts_total'),
    backgroundPoolTasks: metric('rush_ch_background_pool_task'),
    backgroundPoolSize: positiveMetric('rush_ch_background_pool_size'),
    oldestMutationSecs: metric('rush_ch_oldest_mutation_secs'),
    mutationPartsToDo: metric('rush_ch_mutation_parts_to_do'),
    failedMutations: metric('rush_ch_failed_mutations'),
    clickhouseMemoryBytes: chMemory.value,
    clickhouseMemoryLimitBytes: chMemoryLimit.value,
    apiMemoryBytes: processMemory.value,
    apiMemoryLimitBytes: processMemoryLimit.value,
    apiCpuUtilizationRatio: processCpuRatio.value,
    openFds: processOpenFds.value,
    openFdsLimit: processOpenFdsLimit.value,
  })
}

async function load() {
  await loadCapacity(false)
}

async function loadCapacity(rethrow: boolean, signal?: AbortSignal) {
  loading.value = true
  error.value = ''
  try {
    const now = new Date()
    const [metricText, currentStats, buffer] = await Promise.all([
      api.getSystemMetrics(signal),
      api.getStats({ time_range: { from: new Date(now.getTime() - 3600000).toISOString(), to: now.toISOString() } }, signal),
      api.getIngestBuffer(signal),
    ])
    rawMetrics.value = metricText
    stats.value = currentStats
    ingestBuffer.value = buffer
    refreshedAt.value = new Date()
    recordCapacitySnapshot()
  } catch (e: any) {
    if (signal?.aborted) return
    error.value = e?.message || 'Unable to load capacity telemetry.'
    if (rethrow) throw e
  } finally {
    loading.value = false
  }
}

const refreshLoop = usePollingTask({ category: 'capacity', intervalMs: 15_000, run: ({ signal }) => loadCapacity(true, signal) })

onMounted(() => {
  load()
  refreshLoop.start()
})
onUnmounted(() => refreshLoop.stop())

function formatBytes(bytes: number): string {
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(2)} TiB`
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GiB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${Math.round(bytes)} B`
}
function formatCount(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return Math.round(value).toLocaleString()
}
function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}
function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}
function highestSeverity(items: CapacityRecommendation[]): CapacitySeverity {
  if (items.some(item => item.severity === 'urgent')) return 'urgent'
  if (items.some(item => item.severity === 'watch')) return 'watch'
  return 'stable'
}

const recommendations = computed(() => evaluateCapacity(capacityHistory.value))
const systemSeverity = computed(() => highestSeverity(recommendations.value))
const statusLabel = computed(() => systemSeverity.value === 'urgent' ? 'Action required' : systemSeverity.value === 'watch' ? 'Watch closely' : 'Within guide')
const guideRows = capacityGuideRows
</script>

<template>
  <div class="capacity-page">
    <header class="capacity-header">
      <div><div class="capacity-kicker">Control / capacity</div><h1>System state</h1><p>One place to decide whether the next move is more pods, more memory, more disk, or another ClickHouse shard.</p></div>
      <div class="capacity-actions"><span v-if="refreshedAt" class="capacity-updated mono">updated {{ refreshedAt.toLocaleTimeString() }}</span><button class="capacity-refresh" type="button" :disabled="loading" @click="load">{{ loading ? 'Refreshing…' : 'Refresh' }}</button></div>
    </header>

    <div v-if="error" class="capacity-error">{{ error }} <button type="button" @click="load">Retry</button></div>

    <section class="posture-banner" :class="`posture-${systemSeverity}`">
      <div class="posture-mark" aria-hidden="true"><span></span></div>
      <div class="posture-copy"><div class="posture-label">Current capacity posture</div><strong>{{ statusLabel }}</strong><p>{{ systemSeverity === 'urgent' ? 'A resource boundary is being approached now.' : systemSeverity === 'watch' ? 'The system is serving, but one or more signals are narrowing headroom.' : 'No measured signal currently calls for an immediate scale change.' }}</p></div>
      <div class="posture-refresh mono">polling every 15s</div>
    </section>

    <div class="capacity-grid">
      <section class="capacity-card capacity-card--wide">
        <div class="card-kicker">Read path</div><h2>Query pressure</h2>
        <div class="capacity-stat-grid">
          <div><span>Recent p95</span><strong>{{ formatDuration(queryP95) }}</strong><small>non-probe SELECTs · last 5m</small></div>
          <div><span>Active queries</span><strong>{{ formatCount(activeQueries) }}</strong><small>{{ queryLimit ? `${formatPercent(queryConcurrencyRatio)} of configured limit` : 'non-probe SELECTs · no limit configured' }}</small></div>
          <div><span>Longest query</span><strong>{{ formatDuration(longestQueryMs) }}</strong><small>non-probe SELECTs now</small></div>
          <div><span>Recent errors</span><strong>{{ formatCount(optionalMetric('rush_ch_query_log_recent_errors')) }}</strong><small>non-probe SELECTs · last 5m</small></div>
        </div>
      </section>
      <section class="capacity-card">
        <div class="card-kicker">Write path</div><h2>Ingest pressure</h2>
        <div class="capacity-primary"><strong>{{ spoolPct.toFixed(1) }}%</strong><span>spool used</span></div>
        <div class="meter"><span :class="{ warning: spoolPct >= 70, danger: spoolPct >= 85 }" :style="{ width: `${Math.min(100, spoolPct)}%` }"></span></div>
        <dl class="compact-facts"><div><dt>Pending</dt><dd>{{ formatBytes(ingestBuffer?.pending_bytes || 0) }}</dd></div><div><dt>Oldest</dt><dd>{{ Math.round(ingestBuffer?.oldest_age_secs || 0) }}s</dd></div><div><dt>Delayed inserts</dt><dd>{{ formatCount(metric('rush_ch_delayed_inserts')) }}</dd></div></dl>
      </section>
      <section class="capacity-card">
        <div class="card-kicker">Storage</div><h2>ClickHouse footprint</h2>
        <div class="capacity-primary"><strong>{{ formatBytes(storageBytes) }}</strong><span>stored locally</span></div>
        <div v-if="diskUsedPct !== null" class="meter"><span :class="{ warning: diskUsedPct >= 70, danger: diskUsedPct >= 85 }" :style="{ width: `${Math.min(100, diskUsedPct)}%` }"></span></div>
        <dl class="compact-facts"><div><dt>Fullest disk</dt><dd>{{ diskUsedPct === null ? 'unavailable' : `${diskUsedPct.toFixed(1)}% used` }}</dd></div><div><dt>CH memory</dt><dd>{{ formatPercent(chMemoryRatio) }}</dd></div><div><dt>Rows</dt><dd>{{ formatCount(storageRows) }}</dd></div><div><dt>Parts peak</dt><dd>{{ formatCount(maxParts) }}</dd></div></dl>
      </section>
      <section class="capacity-card">
        <div class="card-kicker">Background work</div><h2>Merges and mutations</h2>
        <div class="capacity-primary"><strong>{{ formatPercent(backgroundPoolRatio) }}</strong><span>{{ backgroundPoolSize ? 'background pool used' : 'pool limit unavailable' }}</span></div>
        <dl class="compact-facts"><div><dt>Active merges</dt><dd>{{ formatCount(activeMerges) }}</dd></div><div><dt>Mutations</dt><dd>{{ formatCount(activeMutations) }}</dd></div><div><dt>Oldest mutation</dt><dd>{{ oldestMutationSecs ? `${Math.round(oldestMutationSecs / 60)}m` : 'none' }}</dd></div><div><dt>Part delay at</dt><dd>{{ formatCount(partsDelayThreshold) }}</dd></div></dl>
      </section>
      <section class="capacity-card">
        <div class="card-kicker">Process</div><h2>API runtime</h2>
        <div class="capacity-primary"><strong>{{ processMemoryRatio === null ? formatBytes(processMemory) : formatPercent(processMemoryRatio) }}</strong><span>{{ processMemoryRatio === null ? 'resident memory · limit unavailable' : 'memory used' }}</span></div>
        <dl class="compact-facts"><div><dt>CPU</dt><dd>{{ formatPercent(processCpuRatio) }}</dd></div><div><dt>Open files</dt><dd>{{ formatCount(processOpenFds) }} / {{ formatCount(processOpenFdsLimit) }}</dd></div><div><dt>Tokio tasks</dt><dd>{{ formatCount(metric('rush_runtime_alive_tasks')) }}</dd></div></dl>
      </section>
    </div>

    <section class="recommendations-section"><div class="section-heading"><div><div class="capacity-kicker">Decision support</div><h2>What to do next</h2><p>Read and runtime pressure must persist for three 15-second samples. Disk, ingest failure, and exhausted memory remain immediate signals.</p></div><span class="threshold-note">measured limits when available</span></div><div class="recommendation-list"><article v-for="item in recommendations" :key="item.title" class="recommendation" :class="`recommendation--${item.severity}`"><div class="recommendation-icon" aria-hidden="true"></div><div class="recommendation-body"><div class="recommendation-top"><h3>{{ item.title }}</h3><span>{{ item.severity === 'urgent' ? 'act now' : item.severity === 'watch' ? 'watch' : 'stable' }}</span></div><p>{{ item.body }}</p><div class="recommendation-evidence mono">{{ item.evidence }}</div><div class="recommendation-action"><b>Next move</b> {{ item.action }}</div></div></article></div></section>

    <section class="guide-section"><div class="section-heading"><div><div class="capacity-kicker">Runbook thresholds</div><h2>Scale signals</h2></div><span class="threshold-note">configured limits replace fixed counts</span></div><div class="guide-table-wrap"><table class="guide-table"><thead><tr><th>Signal</th><th>Watch / urgent</th><th>Preferred response</th></tr></thead><tbody><tr v-for="row in guideRows" :key="row.signal"><td>{{ row.signal }}</td><td class="mono">{{ row.threshold }}</td><td>{{ row.move }}</td></tr></tbody></table></div></section>
  </div>
</template>

<style scoped src="../styles/views/CapacityView.css"></style>
