<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Row extends Record<string, unknown> {
  schema: string
  table: string
  live: number
  dead: number
  sinceAutovac: number // seconds; NaN = never
  xidAge: number
  autovacCount: number
  modSinceAnalyze: number
}
interface MaintenanceRow extends Record<string, unknown> {
  kind: string
  table: string
  phase: string
  command: string
  ratio: number
  workers: number
}
const rows = ref<Row[]>([])
const maintenanceRows = ref<MaintenanceRow[]>([])
const vacuumColumns: DataTableColumn[] = [
  { key: 'table', label: 'Table', sortable: true },
  { key: 'dead', label: 'Dead %', align: 'right', sortable: true, cellClass: (row) => `num${deadPct(row as Row) >= 20 ? ' warn' : ''}` },
  { key: 'deadrows', label: 'Dead rows', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'autovac', label: 'Last autovacuum', align: 'right', sortable: true, cellClass: (row) => `num${!isFinite((row as Row).sinceAutovac) || (row as Row).sinceAutovac > 86400 ? ' warn' : ''}` },
  { key: 'avcount', label: 'Autovacuums', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'mod', label: 'Mods since analyze', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'xid', label: 'XID age', align: 'right', sortable: true, cellClass: (row) => `num${(row as Row).xidAge >= 1_500_000_000 ? ' crit' : (row as Row).xidAge >= 1_000_000_000 ? ' warn' : ''}` },
]
const dbXidAge = ref<number>(NaN)
const maintenanceColumns: DataTableColumn[] = [
  { key: 'kind', label: 'Operation', sortable: true },
  { key: 'table', label: 'Table', sortable: true },
  { key: 'phase', label: 'Phase', sortable: true },
  { key: 'ratio', label: 'Progress', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'workers', label: 'Workers', align: 'right', sortable: true, cellClass: 'num' },
]

function sel(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  if (props.db) p.push(`db="${props.db}"`)
  return p.length ? `{${p.join(',')}}` : ''
}
async function fetchMap(metric: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  try {
    const r: PromVectorResponse = await api.promQuery(`${metric}${sel()}`)
    for (const s of r.result) out[`${s.metric.schema}|${s.metric.table}`] = parseFloat(s.value?.[1] ?? '0') || 0
  } catch { /* ignore */ }
  return out
}
async function scalarMax(metric: string): Promise<number> {
  try {
    const r = await api.promQuery(`max(${metric}${sel()})`)
    return r.result.length ? parseFloat(r.result[0]!.value?.[1] ?? '0') : NaN
  } catch { return NaN }
}

async function fetchMaintenance(kind: string, workersMetric: string, progressMetric: string): Promise<MaintenanceRow[]> {
  try {
    const [workers, progress] = await Promise.all([
      api.promQuery(`${workersMetric}${sel()}`),
      api.promQuery(`${progressMetric}${sel()}`),
    ])
    const workerMap = new Map<string, number>()
    for (const item of workers.result) {
      const key = `${item.metric.schema || ''}|${item.metric.table || ''}|${item.metric.phase || ''}|${item.metric.command || ''}`
      workerMap.set(key, parseFloat(item.value?.[1] ?? '0') || 0)
    }
    return progress.result.map((item) => {
      const key = `${item.metric.schema || ''}|${item.metric.table || ''}|${item.metric.phase || ''}|${item.metric.command || ''}`
      return {
        kind,
        table: `${item.metric.schema || '—'}.${item.metric.table || '—'}`,
        phase: item.metric.phase || 'running',
        command: item.metric.command || '',
        ratio: Math.max(0, Math.min(1, parseFloat(item.value?.[1] ?? '0') || 0)),
        workers: workerMap.get(key) ?? 1,
      }
    })
  } catch { return [] }
}

async function load() {
  loading.value = true
  const [live, dead, sinceAv, xid, avCount, mod, dbXid, vacuum, analyze, indexBuild] = await Promise.all([
    fetchMap('postgresql_table_live_rows'),
    fetchMap('postgresql_table_dead_rows'),
    fetchMap('postgresql_table_seconds_since_autovacuum'),
    fetchMap('postgresql_table_xid_age'),
    fetchMap('postgresql_table_autovacuum_count'),
    fetchMap('postgresql_table_mod_since_analyze'),
    scalarMax('postgresql_database_xid_age'),
    fetchMaintenance('Vacuum', 'postgresql_vacuum_workers', 'postgresql_vacuum_progress_ratio'),
    fetchMaintenance('Analyze', 'postgresql_analyze_workers', 'postgresql_analyze_progress_ratio'),
    fetchMaintenance('Index build', 'postgresql_index_builds', 'postgresql_index_build_progress_ratio'),
  ])
  dbXidAge.value = dbXid
  maintenanceRows.value = [...vacuum, ...analyze, ...indexBuild]
  const keys = new Set([...Object.keys(live), ...Object.keys(dead), ...Object.keys(xid)])
  rows.value = [...keys].map((k) => {
    const [schema = '', table = ''] = k.split('|')
    return {
      schema, table,
      live: live[k] ?? 0,
      dead: dead[k] ?? 0,
      sinceAutovac: sinceAv[k] ?? NaN,
      xidAge: xid[k] ?? 0,
      autovacCount: avCount[k] ?? 0,
      modSinceAnalyze: mod[k] ?? 0,
    }
  })
  loading.value = false
}

function deadPct(r: Row): number {
  const t = r.live + r.dead
  return t > 0 ? (r.dead / t) * 100 : 0
}

// Summary tiles.
const summary = computed(() => {
  const rs = rows.value
  return {
    tracked: rs.length,
    needVac: rs.filter((r) => deadPct(r) >= 20 && r.live + r.dead > 1000).length,
    neverVac: rs.filter((r) => !isFinite(r.sinceAutovac)).length,
  }
})

// Sortable; risk-first default (dead-row ratio, then XID age).
type SortKey = 'table' | 'dead' | 'deadrows' | 'autovac' | 'avcount' | 'mod' | 'xid'
const sortKey = ref<SortKey>('dead')
const sortDir = ref<'asc' | 'desc'>('desc')
function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else { sortKey.value = k; sortDir.value = k === 'table' ? 'asc' : 'desc' }
}
function sortVal(r: Row, k: SortKey): number | string {
  switch (k) {
    case 'table': return `${r.schema}.${r.table}`
    case 'dead': return deadPct(r)
    case 'deadrows': return r.dead
    case 'autovac': return isFinite(r.sinceAutovac) ? r.sinceAutovac : Infinity // never = most stale
    case 'avcount': return r.autovacCount
    case 'mod': return r.modSinceAnalyze
    case 'xid': return r.xidAge
  }
}
const sorted = computed(() => {
  const dir = sortDir.value === 'desc' ? -1 : 1
  return [...rows.value].sort((a, b) => {
    const av = sortVal(a, sortKey.value)
    const bv = sortVal(b, sortKey.value)
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
    return ((av as number) - (bv as number)) * dir
  })
})
function onVacuumSort(key: string) {
  if (key === 'table' || key === 'dead' || key === 'deadrows' || key === 'autovac' || key === 'avcount' || key === 'mod' || key === 'xid') setSort(key)
}
function vacuumRowKey(row: Record<string, unknown>): string {
  const r = row as Row
  return `${r.schema}.${r.table}`
}
function vacuumRow(row: Record<string, unknown>): Row { return row as Row }
function maintenanceRow(row: Record<string, unknown>): MaintenanceRow { return row as MaintenanceRow }
function maintenanceRowKey(row: Record<string, unknown>): string {
  const r = row as MaintenanceRow
  return `${r.kind}:${r.table}:${r.phase}:${r.command}`
}
function fmtProgress(ratio: number): string { return `${(ratio * 100).toFixed(1)}%` }
function progressCommand(row: MaintenanceRow): string { return row.command ? ` · ${row.command}` : '' }

const WRAP_DANGER = 2_100_000_000
const wrapSeverity = computed(() => {
  const v = dbXidAge.value
  if (!isFinite(v)) return 'info'
  if (v >= 1_500_000_000) return 'critical'
  if (v >= 1_000_000_000) return 'warn'
  return 'ok'
})

function fmtAge(secs: number): string {
  if (!isFinite(secs)) return 'never'
  if (secs < 60) return `${Math.round(secs)}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}
const fmtNum = (n: number) => Math.round(n).toLocaleString()

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <!-- Wraparound banner -->
    <div :class="['wrap-banner', wrapSeverity]">
      <div class="wrap-title">Transaction-ID wraparound</div>
      <div class="wrap-body">
        <template v-if="isFinite(dbXidAge)">
          Oldest database XID age <strong>{{ fmtNum(dbXidAge) }}</strong>
          — {{ ((dbXidAge / WRAP_DANGER) * 100).toFixed(1) }}% toward the ~2.1B wraparound limit.
        </template>
        <template v-else>No XID-age data yet.</template>
      </div>
    </div>

    <section class="maintenance-panel">
      <div class="maintenance-head"><div><div class="wrap-title">Live maintenance</div><h3>Operations in progress</h3></div><span v-if="maintenanceRows.length" class="maintenance-count">{{ maintenanceRows.length }} active</span></div>
      <p v-if="loading && !maintenanceRows.length" class="pg-loading">Loading maintenance progress…</p>
      <p v-else-if="!maintenanceRows.length" class="pg-empty">No vacuum, analyze, or index-build operations are active.</p>
      <DataTable v-else :columns="maintenanceColumns" :rows="maintenanceRows" :row-key="maintenanceRowKey">
        <template #cell-kind="{ row }">{{ maintenanceRow(row).kind }}<span class="command">{{ progressCommand(maintenanceRow(row)) }}</span></template>
        <template #cell-table="{ row }"><strong>{{ maintenanceRow(row).table }}</strong></template>
        <template #cell-ratio="{ row }">{{ fmtProgress(maintenanceRow(row).ratio) }}</template>
        <template #cell-workers="{ row }">{{ fmtNum(maintenanceRow(row).workers) }}</template>
      </DataTable>
    </section>

    <div class="pg-stat-grid" v-if="rows.length">
      <div class="pg-stat"><div class="label">Tables tracked</div><div class="value">{{ summary.tracked }}</div></div>
      <div class="pg-stat"><div class="label">Needing vacuum</div><div class="value" :class="{ warn: summary.needVac }">{{ summary.needVac }}</div><div class="sub">≥20% dead rows</div></div>
      <div class="pg-stat"><div class="label">Never autovacuumed</div><div class="value">{{ summary.neverVac }}</div></div>
    </div>

    <p class="pg-loading" v-if="loading && !rows.length">Loading…</p>
    <p class="pg-empty" v-else-if="!rows.length">No table statistics yet.</p>
    <DataTable
      v-else
      :columns="vacuumColumns"
      :rows="sorted"
      :row-key="vacuumRowKey"
      :sort-key="sortKey"
      :sort-direction="sortDir"
      @sort="onVacuumSort"
    >
      <template #cell-table="{ row }">{{ vacuumRow(row).schema }}.<strong>{{ vacuumRow(row).table }}</strong></template>
      <template #cell-dead="{ row }">{{ deadPct(vacuumRow(row)).toFixed(1) }}%</template>
      <template #cell-deadrows="{ row }">{{ fmtNum(vacuumRow(row).dead) }}</template>
      <template #cell-autovac="{ row }">{{ fmtAge(vacuumRow(row).sinceAutovac) }}</template>
      <template #cell-avcount="{ row }">{{ fmtNum(vacuumRow(row).autovacCount) }}</template>
      <template #cell-mod="{ row }">{{ fmtNum(vacuumRow(row).modSinceAnalyze) }}</template>
      <template #cell-xid="{ row }">{{ fmtNum(vacuumRow(row).xidAge) }}</template>
    </DataTable>
  </div>
</template>

<style scoped>
.wrap-banner {
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: var(--r-md, 8px);
  padding: var(--sp-4, 16px);
  margin-bottom: var(--sp-5, 20px);
}
.wrap-banner.ok { border-left-color: var(--ok, #22c55e); }
.wrap-banner.info { border-left-color: #6b7280; }
.wrap-banner.warn { border-left-color: var(--amber, #f59e0b); background: color-mix(in srgb, var(--amber, #f59e0b) 6%, transparent); }
.wrap-banner.critical { border-left-color: var(--error, #ef4444); background: color-mix(in srgb, var(--error, #ef4444) 8%, transparent); }
.wrap-title { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 4px; }
.wrap-body { font-size: 13px; color: var(--text-secondary); }
.pg-stat .value.warn { color: var(--amber, #f59e0b); }
.maintenance-panel { border: 1px solid var(--border-subtle); border-radius: var(--r-md, 8px); padding: var(--sp-4, 16px); }
.maintenance-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.maintenance-head h3 { margin: 0; font-size: 15px; }
.maintenance-count { color: var(--text-tertiary); font: 11px var(--font-mono, monospace); }
.command { color: var(--text-tertiary); font-size: 11px; }
</style>
