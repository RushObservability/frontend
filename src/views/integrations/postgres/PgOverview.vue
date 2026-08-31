<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Stat extends Record<string, unknown> { label: string; value: string; sub?: string }
const stats = ref<Stat[]>([])
const overviewColumns: DataTableColumn[] = [
  { key: 'label', label: 'Signal', cellClass: 'overview-signal' },
  { key: 'value', label: 'Current', cellClass: 'overview-value' },
  { key: 'sub', label: 'Context', cellClass: 'overview-context' },
]
interface Finding { severity: 'critical' | 'warning' | 'info'; title: string; detail: string; action: string; page?: string }
const findings = ref<Finding[]>([])
const collectorState = ref<'healthy' | 'degraded' | 'offline'>('offline')
const collectorFreshness = ref('No collector signal')

function labels(extra: Record<string, string> = {}): string {
  const parts: string[] = []
  if (props.server) parts.push(`service_name="${props.server}"`)
  if (props.host) parts.push(`host="${props.host}"`)
  if (props.db) parts.push(`db="${props.db}"`)
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}="${v}"`)
  return parts.length ? `{${parts.join(',')}}` : ''
}

function serverLabels(extra: Record<string, string> = {}): string {
  const parts: string[] = []
  if (props.server) parts.push(`service_name="${props.server}"`)
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}="${v}"`)
  return parts.length ? `{${parts.join(',')}}` : ''
}

function sumVec(r: PromVectorResponse): number {
  return r.result.reduce((a, s) => a + (parseFloat(s.value?.[1] ?? '0') || 0), 0)
}

async function q(promql: string): Promise<number> {
  try { return sumVec(await api.promQuery(promql)) } catch { return NaN }
}

function fmtBytes(n: number): string {
  if (!isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
const fmtNum = (n: number) => (isFinite(n) ? Math.round(n).toLocaleString() : '—')
const fmtRate = (n: number) => (isFinite(n) ? n.toFixed(1) : '—')
function fmtAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

async function load() {
  loading.value = true
  const L = labels()
  const [backends, dbSize, active, idle, idleTx, hit, read, commits, rollbacks, deadlocks, repl] =
    await Promise.all([
      q(`sum(postgresql_backends${L})`),
      q(`sum(postgresql_db_size${L})`),
      q(`sum(postgresql_connection_count${labels({ state: 'active' })})`),
      q(`sum(postgresql_connection_count${labels({ state: 'idle' })})`),
      q(`sum(postgresql_connection_count${labels({ state: 'idle in transaction' })})`),
      q(`sum(postgresql_blocks_read${labels({ source: 'hit' })})`),
      q(`sum(postgresql_blocks_read${labels({ source: 'read' })})`),
      q(`sum(rate(postgresql_commits${L}[5m]))`),
      q(`sum(rate(postgresql_rollbacks${L}[5m]))`),
      q(`sum(postgresql_deadlocks${L})`),
      q(`max(postgresql_replication_data_delay${L})`),
    ])

  const cacheHit = hit + read > 0 ? (hit / (hit + read)) * 100 : NaN
  stats.value = [
    { label: 'Connections', value: fmtNum(backends), sub: `${fmtNum(active)} active · ${fmtNum(idle)} idle · ${fmtNum(idleTx)} idle-in-txn` },
    { label: 'Database size', value: fmtBytes(dbSize) },
    { label: 'Cache hit ratio', value: isFinite(cacheHit) ? `${cacheHit.toFixed(1)}%` : '—' },
    { label: 'Commits / s', value: fmtRate(commits), sub: `${fmtRate(rollbacks)} rollbacks/s` },
    { label: 'Deadlocks', value: fmtNum(deadlocks), sub: 'cumulative' },
    { label: 'Replication delay', value: isFinite(repl) && repl > 0 ? fmtBytes(repl) : '—' },
  ]

  const [collectorUp, metricsAge, queryAge, connectionMax, oldestTx, waits] = await Promise.all([
    q(`max(postgresql_collector_up${serverLabels()})`),
    q(`max(postgresql_collector_signal_age${serverLabels({ signal: 'metrics' })})`),
    q(`max(postgresql_collector_signal_age${serverLabels({ signal: 'queries' })})`),
    q(`max(postgresql_max_connections${L})`),
    q(`max(postgresql_oldest_transaction_age${serverLabels()})`),
    q(`sum(postgresql_wait_events${serverLabels()})`),
  ])
  const connectionPct = connectionMax > 0 ? (backends / connectionMax) * 100 : NaN
  collectorState.value = collectorUp >= 1 && metricsAge < 180 ? 'healthy' : collectorUp >= 1 ? 'degraded' : 'offline'
  collectorFreshness.value = isFinite(metricsAge) && metricsAge < 1_000_000_000
    ? `Metrics ${Math.round(metricsAge)}s ago · queries ${isFinite(queryAge) && queryAge < 1_000_000_000 ? `${Math.round(queryAge)}s ago` : 'not reporting'}`
    : 'No recent collector signal'

  const next: Finding[] = []
  if (collectorState.value === 'offline') next.push({ severity: 'critical', title: 'Collector is not reporting', detail: 'PostgreSQL data may be stale or unavailable.', action: 'Open setup guide' })
  else if (collectorState.value === 'degraded') next.push({ severity: 'warning', title: 'Collector data is stale', detail: collectorFreshness.value, action: 'Check collector health', page: 'overview' })
  if (isFinite(connectionPct) && connectionPct >= 85) next.push({ severity: connectionPct >= 95 ? 'critical' : 'warning', title: 'Connection headroom is low', detail: `${connectionPct.toFixed(0)}% of max connections are in use.`, action: 'Inspect connections', page: 'connections' })
  if (isFinite(waits) && waits > 0) next.push({ severity: 'warning', title: 'Sessions are waiting', detail: `${fmtNum(waits)} active sessions currently report a wait event.`, action: 'Inspect activity', page: 'connections' })
  if (isFinite(oldestTx) && oldestTx > 300) next.push({ severity: oldestTx > 3600 ? 'critical' : 'warning', title: 'Long transaction detected', detail: `The oldest transaction is ${fmtAge(oldestTx)} old.`, action: 'Inspect vacuum and activity', page: 'vacuum' })
  if (isFinite(cacheHit) && cacheHit < 95) next.push({ severity: 'warning', title: 'Cache efficiency is low', detail: `${cacheHit.toFixed(1)}% of block reads came from cache.`, action: 'Review IO-heavy queries', page: 'queries' })
  findings.value = next.slice(0, 5)
  loading.value = false
}

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <div v-if="loading && !stats.length" class="pg-loading">Loading…</div>
    <section class="control-room" aria-label="PostgreSQL control room">
      <div class="control-room-head">
        <div>
          <div class="eyebrow">Database control room</div>
          <h2>What needs attention</h2>
          <p class="freshness">{{ collectorFreshness }}</p>
        </div>
        <div :class="['collector-status', collectorState]">
          <span class="status-dot"></span>
          {{ collectorState === 'healthy' ? 'Reporting normally' : collectorState === 'degraded' ? 'Reporting with gaps' : 'No recent signal' }}
        </div>
      </div>
      <div v-if="findings.length" class="finding-list">
        <article v-for="finding in findings" :key="finding.title" :class="['finding', finding.severity]">
          <div class="finding-severity">{{ finding.severity }}</div>
          <div class="finding-content">
            <strong>{{ finding.title }}</strong>
            <span>{{ finding.detail }}</span>
          </div>
          <router-link v-if="finding.page" class="finding-action" :to="{ name: 'integration-page', params: { addon: 'postgresql', page: finding.page }, query: { server: props.server, host: props.host, db: props.db } }">{{ finding.action }}</router-link>
          <span v-else class="finding-action">{{ finding.action }}</span>
        </article>
      </div>
      <div v-else-if="!loading" class="all-clear">
        No active findings in the current window. Continue to the Queries or Connections tabs for detail.
      </div>
    </section>
    <DataTable
      :columns="overviewColumns"
      :rows="stats"
      row-key="label"
      :loading="loading && !stats.length"
      empty-label="No PostgreSQL signal data yet"
    />
  </div>
</template>

<style scoped>
.control-room {
  margin-bottom: 24px;
  padding: 22px 24px 20px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md, 8px);
}
.control-room-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0 3px; font-size: clamp(20px, 2vw, 27px); letter-spacing: -.025em; }
.freshness { margin: 0; color: var(--text-tertiary); font-size: 12px; }
.collector-status { display: inline-flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-tertiary); }
.collector-status.healthy .status-dot { background: var(--ok, #22c55e); }
.collector-status.degraded .status-dot { background: var(--amber, #f59e0b); }
.collector-status.offline .status-dot { background: var(--error, #ef4444); }
.finding-list { display: grid; gap: 8px; margin-top: 22px; }
.finding { display: grid; grid-template-columns: 78px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid var(--border-subtle); }
.finding-severity { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text-tertiary); }
.finding.critical .finding-severity { color: var(--error, #ef4444); }
.finding.warning .finding-severity { color: var(--amber, #f59e0b); }
.finding-content { display: grid; gap: 2px; min-width: 0; }
.finding-content strong { color: var(--text-primary); font-size: 13px; }
.finding-content span { color: var(--text-secondary); font-size: 12px; }
.finding-action { color: var(--text-tertiary); font-size: 11px; white-space: nowrap; }
.all-clear { margin-top: 20px; color: var(--text-secondary); font-size: 13px; }
:deep(.overview-signal) { color: var(--text-primary); font-weight: 600; }
:deep(.overview-value) { color: var(--text-primary); font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; }
:deep(.overview-context) { color: var(--text-tertiary); font-size: 11px; }
@media (max-width: 680px) {
  .control-room-head, .finding { display: block; }
  .collector-status { margin-top: 14px; }
  .finding-severity, .finding-action { display: block; margin-bottom: 4px; }
}
</style>
