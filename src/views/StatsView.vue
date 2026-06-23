<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import TimePicker from '../components/TimePicker.vue'
import type {
  StatsResponse, TableStorage, UsageResponse,
  UsageEntry, UnusedMetric, CardinalityEntry,
  UsageMeteringSummary, UsageMeteringTenantsResponse,
  PartitionStorage,
} from '../types'

const api = useApi()
const route = useRoute()
const router = useRouter()

// `embedded` is set when rendered inside the Settings → Stats tab: sub-tabs are
// pure internal state (no /stats route navigation) and the page title is hidden
// (Settings supplies its own heading).
defineProps<{ embedded?: boolean }>()

// ── Sub-tab ──
type SubTab = 'metrics' | 'apm' | 'logs' | 'tenants'
const activeTab = ref<SubTab>((route.params.tab as SubTab) || 'metrics')

watch(() => route.params.tab, (t) => {
  if (t && ['metrics', 'apm', 'logs', 'tenants'].includes(t as string)) {
    activeTab.value = t as SubTab
  }
})

function setTab(tab: SubTab) {
  // Stats lives inside Settings now — sub-tabs are pure internal state.
  activeTab.value = tab
}

// ── Stats data ──
const stats = ref<StatsResponse | null>(null)
const loadingStats = ref(false)

const selectedPreset = ref(1440)

// ── Usage data ──
const usage = ref<UsageResponse | null>(null)
const loadingUsage = ref(false)

// ── Usage metering (per-tenant ingest volume) ──
const usageMetering = ref<UsageMeteringSummary | null>(null)
const usageTenants = ref<UsageMeteringTenantsResponse | null>(null)
const loadingMetering = ref(false)

// ── Ingest buffer (durable spool depth) ──
interface IngestBufferStatus { backend: string; pending_bytes: number; pending_count: number; max_bytes: number; used_pct: number; oldest_age_secs: number; committed_total: number }
const ingestBuffer = ref<IngestBufferStatus | null>(null)
async function loadIngestBuffer() {
  try { ingestBuffer.value = await api.getIngestBuffer() } catch { /* non-admin / unavailable */ }
}

// ── Expandable sections ──
const showStorage = ref(false)

// ── Per-partition tiered storage (admin-only; lazy-loaded on first expand) ──
const showPartitions = ref(false)
const partitions = ref<PartitionStorage[]>([])
const partitionsNow = ref(0)        // server epoch for consistent countdowns
const loadingPartitions = ref(false)
const partitionsLoaded = ref(false)
const partitionsError = ref('')

async function loadPartitions() {
  loadingPartitions.value = true
  partitionsError.value = ''
  try {
    const r = await api.getStoragePartitions()
    partitions.value = r.partitions
    partitionsNow.value = r.now
    partitionsLoaded.value = true
  } catch {
    partitionsError.value = 'Could not load partitions (admin only).'
  } finally {
    loadingPartitions.value = false
  }
}

function togglePartitions() {
  showPartitions.value = !showPartitions.value
  if (showPartitions.value && !partitionsLoaded.value) loadPartitions()
}

// Group partitions by signal. Split each into "hot" (still has local bytes — the
// few actionable, about-to-move partitions, shown in full) and the "cold" tail
// (fully on S3 — collapsed to one summary line so 365d of retention doesn't blow
// the table up). Newest partition first.
const partitionGroups = computed(() => {
  const groups: Record<string, PartitionStorage[]> = {}
  for (const p of partitions.value) {
    (groups[p.signal] ??= []).push(p)
  }
  const order = ['logs', 'traces', 'metrics', 'other']
  return order.filter(s => groups[s]?.length).map(s => {
    const rows = groups[s].slice().sort((a, b) => b.partition.localeCompare(a.partition))
    const hot = rows.filter(p => p.tier !== 'cold')   // local or mixed
    const cold = rows.filter(p => p.tier === 'cold')
    const bytesLocal = rows.reduce((n, p) => n + p.bytes_local, 0)
    const bytesCold = rows.reduce((n, p) => n + p.bytes_object_store, 0)
    const total = bytesLocal + bytesCold
    const coldDeletes = cold.map(p => p.delete_at).filter((x): x is number => !!x)
    return {
      signal: s,
      moveAfter: rows[0].move_after_days,
      retention: rows[0].retention_days,
      partitionCount: rows.length,
      hot, cold,
      bytesLocal, bytesCold,
      localPct: total > 0 ? (bytesLocal / total) * 100 : 100,
      coldDeleteMin: coldDeletes.length ? Math.min(...coldDeletes) : undefined,
      coldDeleteMax: coldDeletes.length ? Math.max(...coldDeletes) : undefined,
    }
  })
})

// Per-signal expand state for the collapsed cold tail.
const expandedCold = ref<Record<string, boolean>>({})
function toggleCold(sig: string) { expandedCold.value[sig] = !expandedCold.value[sig] }

// Humanize "time until <epoch>" relative to the server clock.
function untilLabel(epoch?: number): string {
  if (!epoch) return '—'
  const now = partitionsNow.value || Math.floor(Date.now() / 1000)
  let s = epoch - now
  if (s <= 0) return 'due'
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600)
  if (d >= 1) return h ? `in ${d}d ${h}h` : `in ${d}d`
  const m = Math.floor((s % 3600) / 60)
  return h ? `in ${h}h ${m}m` : `in ${m}m`
}

function tierLabel(t: string): string {
  return t === 'cold' ? 'S3' : t === 'mixed' ? 'local + S3' : 'local'
}

// Navigate to metric detail
function goToMetric(metric: string) {
  router.push({ name: 'metric-detail', params: { metricName: metric } })
}

onMounted(() => {
  loadStats()
  loadUsage()
  loadUsageMetering()
  loadIngestBuffer()
})

async function loadStats() {
  loadingStats.value = true
  try {
    const to = new Date()
    const from = new Date(to.getTime() - selectedPreset.value * 60 * 1000)
    stats.value = await api.getStats({
      time_range: { from: from.toISOString(), to: to.toISOString() },
    })
  } catch { /* api.error */ }
  finally { loadingStats.value = false }
}

async function loadUsage() {
  loadingUsage.value = true
  try {
    const days = Math.max(1, Math.ceil(selectedPreset.value / 1440))
    usage.value = await api.getUsage({ days, limit: 200 })
  } catch { /* api.error */ }
  finally { loadingUsage.value = false }
}

async function loadUsageMetering() {
  loadingMetering.value = true
  try {
    const to = new Date()
    const from = new Date(to.getTime() - selectedPreset.value * 60 * 1000)
    const [summary, tenants] = await Promise.all([
      api.getUsageMeteringSummary({ from: from.toISOString(), to: to.toISOString() }),
      api.getUsageMeteringTenants({ from: from.toISOString(), to: to.toISOString(), limit: 50 }),
    ])
    usageMetering.value = summary
    usageTenants.value = tenants
  } catch { /* api.error */ }
  finally { loadingMetering.value = false }
}

watch(selectedPreset, () => { loadStats(); loadUsage(); loadUsageMetering() })

// ── Computed: filtered usage by tab ──
const signalTypeMap: Partial<Record<SubTab, string>> = { metrics: 'metric', apm: 'span', logs: 'log' }

const filteredUsage = computed<UsageEntry[]>(() => {
  if (!usage.value) return []
  const t = signalTypeMap[activeTab.value] || ''
  return usage.value.usage.filter(u => u.signal_type === t)
})

const cardinalityList = computed<CardinalityEntry[]>(() => usage.value?.cardinality ?? [])
const unusedList = computed<UnusedMetric[]>(() => usage.value?.unused ?? [])
const totalSeries = computed(() => cardinalityList.value.reduce((s, c) => s + c.series_count, 0))

// ── Format helpers ──
function formatRate(rate: number): string {
  if (rate >= 1000) return (rate / 1000).toFixed(1) + 'k/s'
  if (rate >= 1) return rate.toFixed(1) + '/s'
  if (rate >= 0.01) return rate.toFixed(2) + '/s'
  return rate.toFixed(3) + '/s'
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_099_511_627_776) return (bytes / 1_099_511_627_776).toFixed(2) + ' TiB'
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + ' GiB'
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MiB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return bytes + ' B'
}

function compressionRatio(row: TableStorage): string {
  if (row.compressed_bytes === 0) return '-'
  return (row.uncompressed_bytes / row.compressed_bytes).toFixed(1) + 'x'
}

// Tenant color palette — deterministic from tenant name hash
const TENANT_COLORS = ['#3b82f6', '#47b881', '#5b8dd9', '#e5584f', '#9b7dd4', '#60a5fa', '#4db6ac', '#ff7043', '#7986cb', '#aed581']
function tenantColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return TENANT_COLORS[Math.abs(hash) % TENANT_COLORS.length] ?? '#3b82f6'
}

// Signal type colors
function signalColor(sig: string): string {
  switch (sig) {
    case 'traces': return '#5b8dd9'
    case 'logs': return '#47b881'
    case 'metrics': return '#3b82f6'
    case 'rum': return '#9b7dd4'
    default: return '#6b7490'
  }
}

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
  const total = totalSeries.value || 1
  return (count / total) * 100
}

function cardinalityLevel(count: number): string {
  if (count >= 1000) return 'card-high'
  if (count >= 100) return 'card-medium'
  return 'card-low'
}

const totalDisk = computed(() => stats.value?.storage.reduce((s, t) => s + t.bytes_on_disk, 0) ?? 0)
const totalRows = computed(() => stats.value?.storage.reduce((s, t) => s + t.total_rows, 0) ?? 0)
const totalCompressed = computed(() => stats.value?.storage.reduce((s, t) => s + t.compressed_bytes, 0) ?? 0)
const totalUncompressed = computed(() => stats.value?.storage.reduce((s, t) => s + t.uncompressed_bytes, 0) ?? 0)
const overallCompression = computed(() => {
  if (totalCompressed.value === 0 || totalUncompressed.value === 0) return '-'
  return (totalUncompressed.value / totalCompressed.value).toFixed(1) + 'x'
})

// ── Tiered storage: local disk vs object store (S3/MinIO) ──
const objectStoreEnabled = computed(() => stats.value?.object_store_enabled ?? false)
const totalLocal = computed(() => stats.value?.storage.reduce((s, t) => s + (t.bytes_local ?? 0), 0) ?? 0)
const totalObjectStore = computed(() => stats.value?.storage.reduce((s, t) => s + (t.bytes_object_store ?? 0), 0) ?? 0)
const localPct = computed(() => {
  const tot = totalLocal.value + totalObjectStore.value
  return tot > 0 ? (totalLocal.value / tot) * 100 : 100
})
</script>

<template>
  <div class="stats-page">
    <!-- Page header -->
    <div class="page-header">
      <h1 v-if="!embedded" class="page-title">Stats</h1>
      <TimePicker
        v-model="selectedPreset"
        :presets="[
          { label: '1h', value: 60 },
          { label: '6h', value: 360 },
          { label: '24h', value: 1440 },
          { label: '7d', value: 10080 },
          { label: '30d', value: 43200 },
          { label: '60d', value: 86400 },
          { label: '90d', value: 129600 },
        ]"
      />
    </div>

    <!-- Loading shimmer -->
    <div v-if="loadingStats && !stats" class="overview-grid">
      <div class="overview-card card" v-for="i in 4" :key="i">
        <div class="ov-shimmer"></div>
      </div>
    </div>

    <!-- Empty / error state -->
    <div v-else-if="!loadingStats && !stats" class="empty-state card">
      <div class="empty-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 3v18h18" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 16l4-6 4 4 5-8" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
        </svg>
      </div>
      <div class="empty-title">No data yet</div>
      <div class="empty-sub">Stats will appear once telemetry is flowing into ClickHouse.</div>
    </div>

    <!-- Ingest buffer (durable spool) status — prominent only when there's a backlog -->
    <div v-if="ingestBuffer" class="ingest-buffer-bar card" :class="{ 'ibb-backlog': ingestBuffer.pending_count > 0 }">
      <span class="ibb-label">Ingest buffer</span>
      <span class="ibb-backend mono">{{ ingestBuffer.backend }}</span>
      <span class="ibb-dot">&middot;</span>
      <template v-if="ingestBuffer.pending_count > 0">
        <span class="ibb-pending mono">{{ ingestBuffer.pending_count }} pending</span>
        <span class="ibb-bytes text-muted mono">{{ formatBytes(ingestBuffer.pending_bytes) }} / {{ formatBytes(ingestBuffer.max_bytes) }} ({{ ingestBuffer.used_pct.toFixed(1) }}%)</span>
        <span v-if="ingestBuffer.oldest_age_secs > 0" class="ibb-bytes text-muted mono">oldest {{ ingestBuffer.oldest_age_secs >= 60 ? Math.round(ingestBuffer.oldest_age_secs / 60) + 'm' : ingestBuffer.oldest_age_secs + 's' }}</span>
        <span class="ibb-hint text-muted">spooled — ClickHouse unavailable or catching up</span>
      </template>
      <span v-else class="ibb-ok mono">empty · writing directly to ClickHouse</span>
    </div>

    <!-- ═══ OVERVIEW: all signals at a glance ═══ -->
    <template v-if="stats">
      <div class="overview-grid">
        <!-- Metrics -->
        <div class="overview-card card" @click="setTab('metrics')">
          <div class="ov-top">
            <div class="ov-icon ov-icon-metrics">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 13L5 6L8 9L13 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="ov-label">Metrics</div>
          </div>
          <div class="ov-hero mono">{{ formatCount(stats.metrics.total_datapoints) }}</div>
          <div class="ov-sub">
            <span class="ov-rate mono">{{ formatRate(stats.metrics.datapoints_per_sec) }}</span>
            <span class="ov-dot">&middot;</span>
            <span class="mono">{{ formatCount(stats.metrics.unique_series) }} series</span>
          </div>
          <div v-if="usageMetering?.signals?.metrics?.events_count" class="ov-ingest text-muted mono">
            {{ formatBytes(usageMetering.signals.metrics.bytes_count) }} ingested
          </div>
        </div>

        <!-- Spans -->
        <div class="overview-card card" @click="setTab('apm')">
          <div class="ov-top">
            <div class="ov-icon ov-icon-spans">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L13 7L7 13L1 7Z" stroke="currentColor" stroke-width="1.3"/></svg>
            </div>
            <div class="ov-label">Spans</div>
          </div>
          <div class="ov-hero mono">{{ formatCount(stats.spans.total_events) }}</div>
          <div class="ov-sub">
            <span class="ov-rate mono">{{ formatRate(stats.spans.events_per_sec) }}</span>
            <span class="ov-dot">&middot;</span>
            <span class="mono">{{ formatCount(stats.spans.events_today) }} today</span>
          </div>
          <div v-if="usageMetering?.signals?.traces?.events_count" class="ov-ingest text-muted mono">
            {{ formatBytes(usageMetering.signals.traces.bytes_count) }} ingested
          </div>
        </div>

        <!-- Logs -->
        <div class="overview-card card" @click="setTab('logs')">
          <div class="ov-top">
            <div class="ov-icon ov-icon-logs">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h8M2 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </div>
            <div class="ov-label">Logs</div>
          </div>
          <div class="ov-hero mono">{{ formatCount(stats.logs.total_events) }}</div>
          <div class="ov-sub">
            <span class="ov-rate mono">{{ formatRate(stats.logs.events_per_sec) }}</span>
            <span class="ov-dot">&middot;</span>
            <span class="mono">{{ formatCount(stats.logs.events_today) }} today</span>
          </div>
          <div v-if="usageMetering?.signals?.logs?.events_count" class="ov-ingest text-muted mono">
            {{ formatBytes(usageMetering.signals.logs.bytes_count) }} ingested
          </div>
        </div>

        <!-- Storage -->
        <div class="overview-card card ov-storage" @click="showStorage = !showStorage">
          <div class="ov-top">
            <div class="ov-icon ov-icon-storage">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><ellipse cx="7" cy="3.5" rx="5.5" ry="2" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 3.5v7c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-7" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 7c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" stroke-width="1.2"/></svg>
            </div>
            <div class="ov-label">Storage</div>
            <svg class="ov-chevron" :class="{ 'ov-chevron-open': showStorage }" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="ov-hero mono">{{ formatBytes(totalDisk) }}</div>
          <div class="ov-sub">
            <span class="mono">{{ formatCount(totalRows) }} rows</span>
            <span class="ov-dot">&middot;</span>
            <span class="mono">{{ overallCompression }} compression</span>
          </div>
          <div v-if="objectStoreEnabled" class="ov-ingest text-muted mono">
            {{ formatBytes(totalLocal) }} local &middot; {{ formatBytes(totalObjectStore) }} object store
          </div>
        </div>
      </div>

      <!-- ═══ STORAGE DETAIL (expandable) ═══ -->
      <Transition name="expand">
        <section v-if="showStorage" class="storage-detail card">
          <!-- Tier breakdown: local disk vs object store -->
          <div class="tier-summary">
            <div class="tier-summary-head">
              <span class="tier-summary-title">Storage tiers</span>
              <span v-if="objectStoreEnabled" class="tier-flag tier-flag-on mono">object store enabled</span>
              <span v-else class="tier-flag mono">object-store tiering not configured — all data is local</span>
            </div>
            <div class="tier-bar">
              <div class="tier-seg tier-seg-local" :style="{ width: localPct + '%' }"></div>
              <div v-if="objectStoreEnabled" class="tier-seg tier-seg-object" :style="{ width: (100 - localPct) + '%' }"></div>
            </div>
            <div class="tier-legend">
              <div class="tier-leg">
                <span class="tier-dot tier-dot-local"></span>
                <span class="tier-leg-label">Local disk</span>
                <span class="tier-leg-val mono">{{ formatBytes(totalLocal) }}</span>
                <span class="tier-leg-pct mono">{{ localPct.toFixed(1) }}%</span>
              </div>
              <div class="tier-leg" v-if="objectStoreEnabled">
                <span class="tier-dot tier-dot-object"></span>
                <span class="tier-leg-label">Object store</span>
                <span class="tier-leg-val mono">{{ formatBytes(totalObjectStore) }}</span>
                <span class="tier-leg-pct mono">{{ (100 - localPct).toFixed(1) }}%</span>
              </div>
            </div>
          </div>
          <div class="st-header">
            <div class="st-col st-name">Table</div>
            <div class="st-col st-rows">Rows</div>
            <div class="st-col st-disk">Disk</div>
            <div class="st-col st-compressed">Compressed</div>
            <div class="st-col st-uncompressed">Uncompressed</div>
            <div class="st-col st-ratio">Ratio</div>
          </div>
          <div v-for="t in stats.storage" :key="t.table_name" class="st-row">
            <div class="st-col st-name mono">{{ t.table_name }}</div>
            <div class="st-col st-rows mono">{{ formatCount(t.total_rows) }}</div>
            <div class="st-col st-disk mono">{{ formatBytes(t.bytes_on_disk) }}</div>
            <div class="st-col st-compressed mono">{{ formatBytes(t.compressed_bytes) }}</div>
            <div class="st-col st-uncompressed mono">{{ formatBytes(t.uncompressed_bytes) }}</div>
            <div class="st-col st-ratio mono">{{ compressionRatio(t) }}</div>
          </div>
          <div class="st-row st-totals">
            <div class="st-col st-name">Total</div>
            <div class="st-col st-rows mono">{{ formatCount(totalRows) }}</div>
            <div class="st-col st-disk mono">{{ formatBytes(totalDisk) }}</div>
            <div class="st-col st-compressed mono">{{ formatBytes(totalCompressed) }}</div>
            <div class="st-col st-uncompressed mono">{{ formatBytes(totalUncompressed) }}</div>
            <div class="st-col st-ratio mono">{{ overallCompression }}</div>
          </div>

          <!-- ── Per-partition tiering drill-down ── -->
          <div class="part-toggle" @click="togglePartitions">
            <svg class="ov-chevron" :class="{ 'ov-chevron-open': showPartitions }" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Partitions — local vs object store, and when each moves &amp; deletes</span>
          </div>
          <div v-if="showPartitions" class="part-body">
            <div v-if="loadingPartitions" class="part-msg mono">Loading…</div>
            <div v-else-if="partitionsError" class="part-msg mono">{{ partitionsError }}</div>
            <div v-else-if="!partitionGroups.length" class="part-msg mono">No partitions.</div>
            <template v-else>
              <div v-for="g in partitionGroups" :key="g.signal" class="part-group">
                <!-- Per-signal summary: counts + tier split bar -->
                <div class="part-group-head">
                  <span class="part-group-title">{{ g.signal }}</span>
                  <span class="part-group-meta mono">{{ g.partitionCount }} partitions · move {{ g.moveAfter || '—' }}d · keep {{ g.retention }}d</span>
                </div>
                <div class="part-tierbar">
                  <div class="part-tierbar-seg part-tierbar-local" :style="{ width: g.localPct + '%' }"></div>
                  <div class="part-tierbar-seg part-tierbar-cold" :style="{ width: (100 - g.localPct) + '%' }"></div>
                </div>
                <div class="part-tier-legend mono">
                  <span><i class="part-dot part-dot-local"></i> local {{ formatBytes(g.bytesLocal) }}</span>
                  <span><i class="part-dot part-dot-cold"></i> S3 {{ formatBytes(g.bytesCold) }} · {{ g.cold.length }} partitions</span>
                </div>

                <!-- Hot (still-local) partitions in full — the actionable ones -->
                <template v-if="g.hot.length">
                  <div class="part-header">
                    <div class="pc pc-part">Partition</div>
                    <div class="pc pc-num">Local</div>
                    <div class="pc pc-num">Object store</div>
                    <div class="pc pc-tier">Tier</div>
                    <div class="pc pc-num">Moves to S3</div>
                    <div class="pc pc-num">Deletes</div>
                  </div>
                  <div v-for="p in g.hot" :key="p.table + p.partition" class="part-row">
                    <div class="pc pc-part mono">{{ p.partition }}</div>
                    <div class="pc pc-num mono">{{ p.bytes_local ? formatBytes(p.bytes_local) : '—' }}</div>
                    <div class="pc pc-num mono">{{ p.bytes_object_store ? formatBytes(p.bytes_object_store) : '—' }}</div>
                    <div class="pc pc-tier"><span class="tier-pill" :class="'tier-pill-' + p.tier">{{ tierLabel(p.tier) }}</span></div>
                    <div class="pc pc-num mono">
                      <template v-if="p.move_at_estimate">{{ untilLabel(p.move_at_estimate) }} <span class="part-est">est</span></template>
                      <template v-else><span class="part-muted">—</span></template>
                    </div>
                    <div class="pc pc-num mono">{{ untilLabel(p.delete_at) }}</div>
                  </div>
                </template>

                <!-- Cold tail collapsed into one line (expandable) -->
                <template v-if="g.cold.length">
                  <div class="part-cold-summary" @click="toggleCold(g.signal)">
                    <svg class="ov-chevron" :class="{ 'ov-chevron-open': expandedCold[g.signal] }" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span class="mono">{{ g.cold.length }} partitions on S3 ({{ formatBytes(g.bytesCold) }})</span>
                    <span class="part-cold-range mono">deleting {{ untilLabel(g.coldDeleteMin) }} … {{ untilLabel(g.coldDeleteMax) }}</span>
                  </div>
                  <div v-if="expandedCold[g.signal]" class="part-cold-list">
                    <div v-for="p in g.cold" :key="p.table + p.partition" class="part-cold-row mono">
                      <span class="pcc-part">{{ p.partition }}</span>
                      <span class="pcc-size">{{ formatBytes(p.bytes_object_store) }}</span>
                      <span class="pcc-del">{{ untilLabel(p.delete_at) }}</span>
                    </div>
                  </div>
                </template>
              </div>
              <div class="part-foot mono">"Moves to S3" is estimated from partition date + move-after policy; "Deletes" is the exact ClickHouse TTL.</div>
            </template>
          </div>
        </section>
      </Transition>

      <!-- ═══ PER-TENANT USAGE (when multiple tenants exist) ═══ -->
      <!-- ═══ DRILL-DOWN TABS ═══ -->
      <div class="drill-header">
        <div class="sub-tabs">
          <button class="sub-tab" :class="{ active: activeTab === 'metrics' }" @click="setTab('metrics')">
            <span class="tab-dot tab-dot-metrics"></span> Metrics
          </button>
          <button class="sub-tab" :class="{ active: activeTab === 'apm' }" @click="setTab('apm')">
            <span class="tab-dot tab-dot-apm"></span> APM
          </button>
          <button class="sub-tab" :class="{ active: activeTab === 'logs' }" @click="setTab('logs')">
            <span class="tab-dot tab-dot-logs"></span> Logs
          </button>
          <button class="sub-tab" :class="{ active: activeTab === 'tenants' }" @click="setTab('tenants')">
            <span class="tab-dot tab-dot-tenants"></span> Tenants
          </button>
        </div>
      </div>

      <!-- ═══ METRICS TAB ═══ -->
      <template v-if="activeTab === 'metrics'">
        <!-- Cardinality explorer -->
        <section class="section" v-if="cardinalityList.length > 0">
          <div class="section-head">
            <h2 class="section-title">Cardinality Explorer</h2>
            <span class="badge-count">{{ totalSeries.toLocaleString() }} series</span>
            <span class="badge-count badge-muted" v-if="unusedList.length > 0">{{ unusedList.length }} unused</span>
          </div>
          <div class="table-wrap card">
            <table class="data-table cardinality-table">
              <thead><tr><th>Metric Name</th><th class="num">Series</th><th class="num">Labels</th><th class="num">% of Total</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in cardinalityList" :key="i" class="card-row" @click="goToMetric(row.metric_name)">
                  <td class="mono cell-name">
                    <span class="row-arrow">&rsaquo;</span>
                    {{ row.metric_name }}
                  </td>
                  <td class="num mono">{{ row.series_count.toLocaleString() }}</td>
                  <td class="num mono">{{ row.label_count }}</td>
                  <td class="num mono"><span :class="cardinalityLevel(row.series_count)">{{ cardinalityPct(row.series_count).toFixed(1) }}%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Queried metrics -->
        <section class="section" v-if="filteredUsage.length > 0">
          <div class="section-head">
            <h2 class="section-title">Queried Metrics</h2>
            <span class="badge-count badge-muted">{{ filteredUsage.length }}</span>
          </div>
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr><th>Signal Name</th><th>Source</th><th>Last Queried</th><th class="num">Queries</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in filteredUsage" :key="i">
                  <td class="mono cell-name">{{ row.signal_name }}</td>
                  <td class="cell-source">{{ row.source }}</td>
                  <td class="cell-date mono">{{ formatDate(row.last_queried_at) }}</td>
                  <td class="num mono">{{ row.query_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Unused metrics -->
        <section class="section" v-if="unusedList.length > 0">
          <div class="section-head">
            <h2 class="section-title">Unused Metrics</h2>
            <span class="badge-count badge-warn">{{ unusedList.length }}</span>
          </div>
          <p class="section-desc">Collected but not queried in the last {{ Math.max(1, Math.ceil(selectedPreset / 1440)) }} days.</p>
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr><th>Metric Name</th></tr></thead>
              <tbody><tr v-for="(row, i) in unusedList" :key="i"><td class="mono cell-name cell-unused">{{ row.metric_name }}</td></tr></tbody>
            </table>
          </div>
        </section>

        <div v-if="!loadingUsage && cardinalityList.length === 0 && filteredUsage.length === 0" class="empty-state card">
          <div class="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none"><path d="M1 13L5 6L8 9L13 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div>No metric data tracked yet.</div>
        </div>
      </template>

      <!-- ═══ APM TAB ═══ -->
      <template v-if="activeTab === 'apm'">
        <section class="section" v-if="filteredUsage.length > 0">
          <div class="section-head">
            <h2 class="section-title">Queried Spans</h2>
            <span class="badge-count badge-muted">{{ filteredUsage.length }}</span>
          </div>
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr><th>Signal Name</th><th>Source</th><th>Last Queried</th><th class="num">Queries</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in filteredUsage" :key="i">
                  <td class="mono cell-name">{{ row.signal_name }}</td>
                  <td class="cell-source">{{ row.source }}</td>
                  <td class="cell-date mono">{{ formatDate(row.last_queried_at) }}</td>
                  <td class="num mono">{{ row.query_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div v-if="!loadingUsage && filteredUsage.length === 0" class="empty-state card">
          <div class="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none"><path d="M7 1L13 7L7 13L1 7Z" stroke="currentColor" stroke-width="1.3"/></svg>
          </div>
          <div>No span queries tracked yet.</div>
        </div>
      </template>

      <!-- ═══ LOGS TAB ═══ -->
      <template v-if="activeTab === 'logs'">
        <section class="section" v-if="filteredUsage.length > 0">
          <div class="section-head">
            <h2 class="section-title">Queried Logs</h2>
            <span class="badge-count badge-muted">{{ filteredUsage.length }}</span>
          </div>
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr><th>Signal Name</th><th>Source</th><th>Last Queried</th><th class="num">Queries</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in filteredUsage" :key="i">
                  <td class="mono cell-name">{{ row.signal_name }}</td>
                  <td class="cell-source">{{ row.source }}</td>
                  <td class="cell-date mono">{{ formatDate(row.last_queried_at) }}</td>
                  <td class="num mono">{{ row.query_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div v-if="!loadingUsage && filteredUsage.length === 0" class="empty-state card">
          <div class="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h8M2 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </div>
          <div>No log queries tracked yet.</div>
        </div>
      </template>

      <!-- ═══ TENANTS TAB ═══ -->
      <template v-if="activeTab === 'tenants'">
        <div v-if="!usageTenants || loadingMetering" class="empty-state card">
          <div class="ov-shimmer" style="height: 120px; border-radius: var(--r-md);"></div>
        </div>
        <template v-else-if="usageTenants.tenants.length > 0">
          <!-- Global proportion bar -->
          <section class="section">
            <div class="section-head">
              <h2 class="section-title">Ingest Volume by Tenant</h2>
            </div>
            <div class="tenant-proportion-card card">
              <div class="tenant-bar">
                <div
                  v-for="t in usageTenants.tenants"
                  :key="t.tenant_id"
                  class="tenant-bar-seg"
                  :style="{
                    width: Math.max(2, (t.bytes_count / Math.max(1, usageTenants.tenants.reduce((s, x) => s + x.bytes_count, 0))) * 100) + '%',
                    background: tenantColor(t.tenant_id),
                  }"
                  :title="`${t.tenant_id}: ${formatBytes(t.bytes_count)} (${((t.bytes_count / Math.max(1, usageTenants.tenants.reduce((s, x) => s + x.bytes_count, 0))) * 100).toFixed(1)}%)`"
                ></div>
              </div>
              <div class="tenant-bar-legend">
                <div v-for="t in usageTenants.tenants" :key="t.tenant_id" class="tenant-legend-item">
                  <span class="tenant-legend-dot" :style="{ background: tenantColor(t.tenant_id) }"></span>
                  <span class="mono" style="font-size: 11px;">{{ t.tenant_id }}</span>
                  <span class="text-muted" style="font-size: 10px;">
                    {{ ((t.bytes_count / Math.max(1, usageTenants.tenants.reduce((s, x) => s + x.bytes_count, 0))) * 100).toFixed(1) }}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- Per-tenant detail cards -->
          <section class="section">
            <div class="section-head">
              <h2 class="section-title">Tenant Details</h2>
              <span class="badge-count">{{ usageTenants.tenants.length }}</span>
            </div>
            <div class="tenant-detail-grid">
              <div v-for="t in usageTenants.tenants" :key="t.tenant_id" class="tenant-detail-card card">
                <div class="tdc-header">
                  <span class="tdc-dot" :style="{ background: tenantColor(t.tenant_id) }"></span>
                  <span class="tdc-name mono">{{ t.tenant_id }}</span>
                  <span class="tdc-pct mono">
                    {{ ((t.bytes_count / Math.max(1, usageTenants.tenants.reduce((s, x) => s + x.bytes_count, 0))) * 100).toFixed(1) }}%
                  </span>
                </div>
                <div class="tdc-totals">
                  <span class="tdc-total-val mono">{{ formatCount(t.events_count) }} events</span>
                  <span class="ov-dot">&middot;</span>
                  <span class="tdc-total-val mono">{{ formatBytes(t.bytes_count) }}</span>
                </div>
                <!-- Signal breakdown mini-bars -->
                <div class="tdc-signals">
                  <div v-for="sig in ['traces', 'logs', 'metrics', 'rum']" :key="sig" class="tdc-signal-row">
                    <span class="tdc-signal-name">{{ sig }}</span>
                    <div class="tdc-signal-bar-wrap">
                      <div
                        class="tdc-signal-bar"
                        :style="{
                          width: Math.max(0, ((t.signals[sig]?.events_count ?? 0) / Math.max(1, t.events_count)) * 100) + '%',
                          background: signalColor(sig),
                        }"
                      ></div>
                    </div>
                    <span class="tdc-signal-val mono">{{ formatCount(t.signals[sig]?.events_count ?? 0) }}</span>
                    <span class="tdc-signal-bytes mono text-muted">{{ formatBytes(t.signals[sig]?.bytes_count ?? 0) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
        <div v-else class="empty-state card">
          <div class="empty-state-icon">&#9671;</div>
          <div>No tenant usage data yet</div>
          <div class="text-muted" style="font-size: 11px">Ingest data to see tenant breakdown.</div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../styles/views/StatsView.css"></style>
