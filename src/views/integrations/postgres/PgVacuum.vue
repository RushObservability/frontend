<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import { usePollingTask } from '../../../composables/usePollingTask'
import type { PromMetric, PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'
import {
  VACUUM_PHASES,
  estimateVacuumPhase,
  formatDuration,
  phaseDefinition,
  phaseFromCode,
  phaseFromPostgresName,
  phaseProgressMetric,
  timelineState,
  type ProgressPoint,
  type VacuumEstimate,
  type VacuumPhaseId,
} from './vacuumPresentation'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Row extends Record<string, unknown> {
  schema: string
  table: string
  live: number
  dead: number
  sinceAutovac: number
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

interface VacuumRun {
  id: string
  schema: string
  table: string
  server: string
  host: string
  db: string
  operation: string
  pid: string
  phase: VacuumPhaseId
  elapsedSeconds: number
  totalBlocks: number
  scannedBlocks: number
  vacuumedBlocks: number
  indexCycles: number
  totalIndexes: number
  processedIndexes: number
  delaySeconds: number
  estimate: VacuumEstimate
  legacy: boolean
}

const rows = ref<Row[]>([])
const vacuumRuns = ref<VacuumRun[]>([])
const otherMaintenance = ref<MaintenanceRow[]>([])
const dbXidAge = ref<number>(NaN)

const vacuumColumns: DataTableColumn[] = [
  { key: 'table', label: 'Table', sortable: true },
  { key: 'dead', label: 'Dead %', align: 'right', sortable: true, cellClass: (row) => `num${deadPct(row as Row) >= 20 ? ' warn' : ''}` },
  { key: 'deadrows', label: 'Dead rows', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'autovac', label: 'Last autovacuum', align: 'right', sortable: true, cellClass: (row) => `num${!isFinite((row as Row).sinceAutovac) || (row as Row).sinceAutovac > 86400 ? ' warn' : ''}` },
  { key: 'avcount', label: 'Autovacuums', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'mod', label: 'Mods since analyze', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'xid', label: 'XID age', align: 'right', sortable: true, cellClass: (row) => `num${(row as Row).xidAge >= 1_500_000_000 ? ' crit' : (row as Row).xidAge >= 1_000_000_000 ? ' warn' : ''}` },
]
const maintenanceColumns: DataTableColumn[] = [
  { key: 'kind', label: 'Operation', sortable: true },
  { key: 'table', label: 'Table', sortable: true },
  { key: 'phase', label: 'Phase', sortable: true },
  { key: 'ratio', label: 'Progress', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'workers', label: 'Workers', align: 'right', sortable: true, cellClass: 'num' },
]

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function baseLabels(): Record<string, string> {
  const labels: Record<string, string> = {}
  if (props.server) labels.service_name = props.server
  if (props.host) labels.host = props.host
  if (props.db) labels.db = props.db
  return labels
}

function metricQuery(metric: string, extra: Record<string, string> = {}): string {
  const labels = { ...baseLabels(), ...extra }
  const selector = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')
  return selector ? `${metric}{${selector}}` : metric
}

async function safePromQuery(metric: string, signal?: AbortSignal): Promise<PromVectorResponse> {
  try {
    return await api.promQuery(metric, undefined, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    return { resultType: 'vector', result: [] }
  }
}

async function fetchMap(metric: string, signal?: AbortSignal): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const result = await safePromQuery(metricQuery(metric), signal)
  for (const sample of result.result) {
    out[`${sample.metric.schema}|${sample.metric.table}`] = Number(sample.value?.[1]) || 0
  }
  return out
}

async function scalarMax(metric: string, signal?: AbortSignal): Promise<number> {
  const result = await safePromQuery(`max(${metricQuery(metric)})`, signal)
  return result.result.length ? Number(result.result[0]!.value?.[1]) : NaN
}

function maintenanceIdentity(metric: PromMetric): string {
  return [metric.schema, metric.table, metric.phase, metric.command].join('|')
}

async function fetchMaintenance(kind: string, workersMetric: string, progressMetric: string, signal?: AbortSignal): Promise<MaintenanceRow[]> {
  const [workers, progress] = await Promise.all([
    safePromQuery(metricQuery(workersMetric), signal),
    safePromQuery(metricQuery(progressMetric), signal),
  ])
  const workerMap = new Map<string, number>()
  for (const item of workers.result) workerMap.set(maintenanceIdentity(item.metric), Number(item.value?.[1]) || 0)
  return progress.result.map((item) => {
    const key = maintenanceIdentity(item.metric)
    return {
      kind,
      table: `${item.metric.schema || '—'}.${item.metric.table || '—'}`,
      phase: item.metric.phase || 'running',
      command: item.metric.command || '',
      ratio: Math.max(0, Math.min(1, Number(item.value?.[1]) || 0)),
      workers: workerMap.get(key) ?? 1,
    }
  })
}

const DETAIL_METRICS = [
  'postgresql_vacuum_phase',
  'postgresql_vacuum_heap_blocks_total',
  'postgresql_vacuum_heap_blocks_scanned',
  'postgresql_vacuum_heap_blocks_vacuumed',
  'postgresql_vacuum_index_vacuum_count',
  'postgresql_vacuum_elapsed_seconds',
  'postgresql_vacuum_observed_timestamp_seconds',
  'postgresql_vacuum_indexes_total',
  'postgresql_vacuum_indexes_processed',
  'postgresql_vacuum_delay_seconds',
] as const

function vacuumIdentity(metric: PromMetric): string {
  return [
    metric.service_name,
    metric.host,
    metric.db,
    metric.schema,
    metric.table,
    metric.operation,
    metric.pid,
  ].join('|')
}

function estimateFor(run: Omit<VacuumRun, 'estimate'>, recentProgress?: ProgressPoint[]): VacuumEstimate {
  return estimateVacuumPhase({
    phase: run.phase,
    elapsedSeconds: run.elapsedSeconds,
    totalBlocks: run.totalBlocks,
    scannedBlocks: run.scannedBlocks,
    vacuumedBlocks: run.vacuumedBlocks,
    totalIndexes: run.totalIndexes,
    processedIndexes: run.processedIndexes,
    recentProgress,
  })
}

async function addRecentEstimate(run: VacuumRun, signal?: AbortSignal): Promise<void> {
  const metric = phaseProgressMetric(run.phase)
  if (!metric || run.legacy) return
  const end = Math.floor(Date.now() / 1_000)
  try {
    const response = await api.promQueryRange(metricQuery(metric, {
      service_name: run.server,
      host: run.host,
      db: run.db,
      schema: run.schema,
      table: run.table,
      operation: run.operation,
      pid: run.pid,
    }), end - 15 * 60, end, 60, undefined, signal)
    const points: ProgressPoint[] = (response.result[0]?.values ?? [])
      .map(([time, value]) => [time, Number(value)] as ProgressPoint)
      .filter(([, value]) => Number.isFinite(value))
    run.estimate = estimateFor(run, points)
  } catch (error) {
    if (signal?.aborted) throw error
  }
}

async function fetchVacuumRuns(signal?: AbortSignal): Promise<VacuumRun[]> {
  const responses = await Promise.all(DETAIL_METRICS.map(async (metric) => [metric, await safePromQuery(metricQuery(metric), signal)] as const))
  const byMetric = new Map(responses)
  const phaseSamples = byMetric.get('postgresql_vacuum_phase')?.result ?? []
  if (!phaseSamples.length) return []

  const values = new Map<string, Map<string, number>>()
  for (const [metric, response] of responses) {
    values.set(metric, new Map(response.result.map((sample) => [vacuumIdentity(sample.metric), Number(sample.value?.[1]) || 0])))
  }
  const value = (metric: typeof DETAIL_METRICS[number], key: string): number => values.get(metric)?.get(key) ?? 0
  const now = Date.now() / 1_000
  const runs: VacuumRun[] = []

  for (const sample of phaseSamples) {
    const key = vacuumIdentity(sample.metric)
    const observedAt = value('postgresql_vacuum_observed_timestamp_seconds', key)
    if (observedAt > 0 && now - observedAt > 180) continue
    const phase = phaseFromCode(Number(sample.value?.[1]))
    const base: Omit<VacuumRun, 'estimate'> = {
      id: key,
      schema: sample.metric.schema || '',
      table: sample.metric.table || '',
      server: sample.metric.service_name || '',
      host: sample.metric.host || '',
      db: sample.metric.db || '',
      operation: sample.metric.operation || 'manual',
      pid: sample.metric.pid || '',
      phase,
      elapsedSeconds: value('postgresql_vacuum_elapsed_seconds', key),
      totalBlocks: value('postgresql_vacuum_heap_blocks_total', key),
      scannedBlocks: value('postgresql_vacuum_heap_blocks_scanned', key),
      vacuumedBlocks: value('postgresql_vacuum_heap_blocks_vacuumed', key),
      indexCycles: value('postgresql_vacuum_index_vacuum_count', key),
      totalIndexes: value('postgresql_vacuum_indexes_total', key),
      processedIndexes: value('postgresql_vacuum_indexes_processed', key),
      delaySeconds: value('postgresql_vacuum_delay_seconds', key),
      legacy: false,
    }
    runs.push({ ...base, estimate: estimateFor(base) })
  }
  await Promise.all(runs.map((run) => addRecentEstimate(run, signal)))
  return runs
}

function legacyVacuumRun(row: MaintenanceRow): VacuumRun {
  const [schema = '', table = ''] = row.table.split('.', 2)
  const phase = phaseFromPostgresName(row.phase)
  const base: Omit<VacuumRun, 'estimate'> = {
    id: `legacy:${row.table}:${row.phase}:${row.command}`,
    schema,
    table,
    server: props.server || '',
    host: props.host || '',
    db: props.db || '',
    operation: row.command || 'vacuum',
    pid: '',
    phase,
    elapsedSeconds: 0,
    totalBlocks: phase === 'scanning-heap' ? 1 : 0,
    scannedBlocks: phase === 'scanning-heap' ? row.ratio : 0,
    vacuumedBlocks: 0,
    indexCycles: 0,
    totalIndexes: 0,
    processedIndexes: 0,
    delaySeconds: 0,
    legacy: true,
  }
  return { ...base, estimate: estimateFor(base) }
}

async function load(rethrow = false, signal?: AbortSignal) {
  loading.value = true
  try {
    const [live, dead, sinceAv, xid, avCount, mod, dbXid, detailedVacuum, legacyVacuum, analyze, indexBuild] = await Promise.all([
      fetchMap('postgresql_table_live_rows', signal),
      fetchMap('postgresql_table_dead_rows', signal),
      fetchMap('postgresql_table_seconds_since_autovacuum', signal),
      fetchMap('postgresql_table_xid_age', signal),
      fetchMap('postgresql_table_autovacuum_count', signal),
      fetchMap('postgresql_table_mod_since_analyze', signal),
      scalarMax('postgresql_database_xid_age', signal),
      fetchVacuumRuns(signal),
      fetchMaintenance('Vacuum', 'postgresql_vacuum_workers', 'postgresql_vacuum_progress_ratio', signal),
      fetchMaintenance('Analyze', 'postgresql_analyze_workers', 'postgresql_analyze_progress_ratio', signal),
      fetchMaintenance('Index build', 'postgresql_index_builds', 'postgresql_index_build_progress_ratio', signal),
    ])
    dbXidAge.value = dbXid
    vacuumRuns.value = detailedVacuum.length ? detailedVacuum : legacyVacuum.map(legacyVacuumRun)
    otherMaintenance.value = [...analyze, ...indexBuild]
    const keys = new Set([...Object.keys(live), ...Object.keys(dead), ...Object.keys(xid)])
    rows.value = [...keys].map((key) => {
      const [schema = '', table = ''] = key.split('|')
      return {
        schema,
        table,
        live: live[key] ?? 0,
        dead: dead[key] ?? 0,
        sinceAutovac: sinceAv[key] ?? NaN,
        xidAge: xid[key] ?? 0,
        autovacCount: avCount[key] ?? 0,
        modSinceAnalyze: mod[key] ?? 0,
      }
    })
  } catch (error) {
    if (signal?.aborted) return
    if (rethrow) throw error
  } finally {
    loading.value = false
  }
}

function deadPct(row: Row): number {
  const total = row.live + row.dead
  return total > 0 ? (row.dead / total) * 100 : 0
}

const summary = computed(() => ({
  tracked: rows.value.length,
  needVac: rows.value.filter((row) => deadPct(row) >= 20 && row.live + row.dead > 1_000).length,
  neverVac: rows.value.filter((row) => !isFinite(row.sinceAutovac)).length,
}))

type SortKey = 'table' | 'dead' | 'deadrows' | 'autovac' | 'avcount' | 'mod' | 'xid'
const sortKey = ref<SortKey>('dead')
const sortDir = ref<'asc' | 'desc'>('desc')
function setSort(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else { sortKey.value = key; sortDir.value = key === 'table' ? 'asc' : 'desc' }
}
function sortVal(row: Row, key: SortKey): number | string {
  switch (key) {
    case 'table': return `${row.schema}.${row.table}`
    case 'dead': return deadPct(row)
    case 'deadrows': return row.dead
    case 'autovac': return isFinite(row.sinceAutovac) ? row.sinceAutovac : Infinity
    case 'avcount': return row.autovacCount
    case 'mod': return row.modSinceAnalyze
    case 'xid': return row.xidAge
  }
}
const sorted = computed(() => {
  const direction = sortDir.value === 'desc' ? -1 : 1
  return [...rows.value].sort((a, b) => {
    const av = sortVal(a, sortKey.value)
    const bv = sortVal(b, sortKey.value)
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * direction
    return ((av as number) - (bv as number)) * direction
  })
})
function onVacuumSort(key: string) {
  if (['table', 'dead', 'deadrows', 'autovac', 'avcount', 'mod', 'xid'].includes(key)) setSort(key as SortKey)
}

function vacuumRowKey(row: Record<string, unknown>): string { return `${(row as Row).schema}.${(row as Row).table}` }
function vacuumRow(row: Record<string, unknown>): Row { return row as Row }
function maintenanceRow(row: Record<string, unknown>): MaintenanceRow { return row as MaintenanceRow }
function maintenanceRowKey(row: Record<string, unknown>): string {
  const item = row as MaintenanceRow
  return `${item.kind}:${item.table}:${item.phase}:${item.command}`
}
function fmtProgress(ratio: number): string { return `${(ratio * 100).toFixed(1)}%` }
function fmtNum(value: number): string { return Math.round(value).toLocaleString() }
function fmtBlocks(value: number): string { return `${fmtNum(value)} blocks` }
function operationLabel(operation: string): string { return operation === 'autovacuum' ? 'Autovacuum' : 'Manual vacuum' }
function etaLabel(run: VacuumRun): string {
  if (run.estimate.etaSeconds !== null) return `~${formatDuration(run.estimate.etaSeconds)}`
  if (run.phase === 'initializing') return 'Starting'
  if (run.phase === 'truncating-heap' || run.phase === 'final-cleanup') return 'Finishing'
  return 'Estimating'
}
function confidenceLabel(run: VacuumRun): string {
  return run.estimate.confidence === 'none' ? '' : `${run.estimate.confidence} confidence`
}
function phaseNumber(phase: VacuumPhaseId): number { return VACUUM_PHASES.findIndex((item) => item.id === phase) + 1 }

const WRAP_DANGER = 2_100_000_000
const wrapSeverity = computed(() => {
  const value = dbXidAge.value
  if (!isFinite(value)) return 'info'
  if (value >= 1_500_000_000) return 'critical'
  if (value >= 1_000_000_000) return 'warn'
  return 'ok'
})
function fmtAge(seconds: number): string {
  if (!isFinite(seconds)) return 'never'
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

const refreshLoop = usePollingTask({
  category: 'postgres_activity',
  intervalMs: 60_000,
  run: ({ signal }) => load(true, signal),
})
onMounted(() => {
  void load()
  refreshLoop.start()
})
onUnmounted(() => refreshLoop.stop())
watch(() => [props.server, props.host, props.db], () => refreshLoop.refreshNow())
</script>

<template>
  <div>
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

    <section class="maintenance-panel" aria-labelledby="live-vacuum-title">
      <div class="maintenance-head">
        <div>
          <div class="wrap-title">Right now</div>
          <h3 id="live-vacuum-title">Live VACUUM</h3>
          <p>See what PostgreSQL is doing, why it matters, and how long the current phase may take.</p>
        </div>
        <span v-if="vacuumRuns.length" class="maintenance-count"><i aria-hidden="true" />{{ vacuumRuns.length }} active</span>
      </div>

      <p v-if="loading && !vacuumRuns.length" class="pg-loading">Checking for active VACUUM jobs…</p>
      <div v-else-if="!vacuumRuns.length" class="vacuum-empty">
        <span class="vacuum-empty-icon" aria-hidden="true">✓</span>
        <div><strong>No VACUUM is running</strong><p>Active autovacuum and manual VACUUM jobs will appear here.</p></div>
      </div>
      <div v-else class="vacuum-runs" aria-live="polite">
        <article v-for="run in vacuumRuns" :key="run.id" class="vacuum-run">
          <header class="vacuum-run-head">
            <div class="vacuum-identity">
              <span :class="['vacuum-operation', { auto: run.operation === 'autovacuum' }]">{{ operationLabel(run.operation) }}</span>
              <h4>{{ run.schema || '—' }}.<strong>{{ run.table || '—' }}</strong></h4>
              <span v-if="run.pid" class="vacuum-pid">PID {{ run.pid }}</span>
            </div>
            <div class="vacuum-eta">
              <span>Current phase ETA</span>
              <strong>{{ etaLabel(run) }}</strong>
              <small v-if="confidenceLabel(run)">{{ confidenceLabel(run) }}</small>
            </div>
          </header>

          <div class="current-phase">
            <span class="current-phase-dot" aria-hidden="true" />
            <span>Stage {{ phaseNumber(run.phase) > 0 ? `${phaseNumber(run.phase)} of ${VACUUM_PHASES.length}` : 'in progress' }}</span>
            <strong>{{ phaseDefinition(run.phase).label }}</strong>
          </div>

          <ol class="vacuum-timeline" aria-label="VACUUM stages">
            <li
              v-for="(phase, index) in VACUUM_PHASES"
              :key="phase.id"
              :class="timelineState(run.phase, phase.id)"
              :aria-current="timelineState(run.phase, phase.id) === 'current' ? 'step' : undefined"
            >
              <span class="stage-marker">{{ timelineState(run.phase, phase.id) === 'complete' ? '✓' : index + 1 }}</span>
              <span class="stage-label">{{ phase.shortLabel }}</span>
            </li>
          </ol>

          <div class="phase-explainer">
            <div><span>What this means</span><p>{{ phaseDefinition(run.phase).meaning }}</p></div>
            <div v-if="run.estimate.progress !== null" class="phase-progress">
              <div class="progress-label"><span>Current phase</span><strong>{{ fmtProgress(run.estimate.progress) }}</strong></div>
              <div
                class="progress-track"
                role="progressbar"
                :aria-label="`${phaseDefinition(run.phase).label} progress`"
                :aria-valuenow="Math.round(run.estimate.progress * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
              ><span :style="{ width: `${run.estimate.progress * 100}%` }" /></div>
              <small>{{ run.estimate.status }}</small>
            </div>
            <div v-else class="phase-status"><span>Estimate</span><p>{{ run.estimate.status }}</p></div>
          </div>

          <details class="stage-guide">
            <summary>What do all seven stages mean?</summary>
            <ol>
              <li v-for="phase in VACUUM_PHASES" :key="`guide:${phase.id}`">
                <strong>{{ phase.label }}</strong>
                <p>{{ phase.meaning }}</p>
              </li>
            </ol>
          </details>

          <dl v-if="!run.legacy" class="vacuum-facts">
            <div><dt>Running for</dt><dd>{{ formatDuration(run.elapsedSeconds) }}</dd></div>
            <div><dt>Table scanned</dt><dd>{{ fmtBlocks(run.scannedBlocks) }} <small>of {{ fmtNum(run.totalBlocks) }}</small></dd></div>
            <div><dt>Space reclaimed</dt><dd>{{ fmtBlocks(run.vacuumedBlocks) }} <small>reusable</small></dd></div>
            <div><dt>Index passes</dt><dd>{{ fmtNum(run.indexCycles) }} <small>{{ run.indexCycles === 1 ? 'pass' : 'passes' }}</small></dd></div>
            <div v-if="run.totalIndexes > 0"><dt>Indexes this pass</dt><dd>{{ fmtNum(run.processedIndexes) }} <small>of {{ fmtNum(run.totalIndexes) }}</small></dd></div>
            <div v-if="run.delaySeconds > 0"><dt>Throttle delay</dt><dd>{{ formatDuration(run.delaySeconds) }} <small>PostgreSQL 18+</small></dd></div>
          </dl>
          <p v-else class="collector-note">Upgrade the PostgreSQL collector with this UI to add elapsed time, detailed counters, and ETA.</p>
          <p class="eta-note">ETA covers the current phase. Index and heap cleanup can repeat, so later work may add time.</p>
        </article>
      </div>

      <div v-if="otherMaintenance.length" class="other-maintenance">
        <div class="other-maintenance-head"><strong>Other maintenance</strong><span>{{ otherMaintenance.length }} active</span></div>
        <DataTable :columns="maintenanceColumns" :rows="otherMaintenance" :row-key="maintenanceRowKey">
          <template #cell-kind="{ row }">{{ maintenanceRow(row).kind }}<span v-if="maintenanceRow(row).command" class="command"> · {{ maintenanceRow(row).command }}</span></template>
          <template #cell-table="{ row }"><strong>{{ maintenanceRow(row).table }}</strong></template>
          <template #cell-ratio="{ row }">{{ fmtProgress(maintenanceRow(row).ratio) }}</template>
          <template #cell-workers="{ row }">{{ fmtNum(maintenanceRow(row).workers) }}</template>
        </DataTable>
      </div>
    </section>

    <div v-if="rows.length" class="pg-stat-grid">
      <div class="pg-stat"><div class="label">Tables tracked</div><div class="value">{{ summary.tracked }}</div></div>
      <div class="pg-stat"><div class="label">Needing vacuum</div><div class="value" :class="{ warn: summary.needVac }">{{ summary.needVac }}</div><div class="sub">≥20% dead rows</div></div>
      <div class="pg-stat"><div class="label">Never autovacuumed</div><div class="value">{{ summary.neverVac }}</div></div>
    </div>

    <p v-if="loading && !rows.length" class="pg-loading">Loading table health…</p>
    <p v-else-if="!rows.length" class="pg-empty">No table statistics yet.</p>
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
.wrap-title { margin-bottom: 4px; color: var(--text-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.wrap-body { color: var(--text-secondary); font-size: 13px; }
.pg-stat .value.warn { color: var(--amber, #f59e0b); }

.maintenance-panel {
  container-type: inline-size;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md, 8px);
  padding: clamp(16px, 2.4cqi, 24px);
  margin-bottom: var(--sp-5, 20px);
}
.maintenance-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.maintenance-head h3 { margin: 0; color: var(--text-primary); font-size: 18px; line-height: 1.25; }
.maintenance-head p { max-width: 660px; margin: 5px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.maintenance-count { display: inline-flex; flex: none; align-items: center; gap: 7px; color: var(--text-secondary); font: 11px var(--font-mono, monospace); }
.maintenance-count i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok, #22c55e); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok, #22c55e) 14%, transparent); }

.vacuum-empty { display: flex; align-items: center; gap: 12px; min-height: 82px; padding: 16px; border: 1px dashed var(--border-subtle); border-radius: var(--r-md, 8px); background: color-mix(in srgb, var(--bg-hover) 55%, transparent); }
.vacuum-empty-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; color: var(--ok, #22c55e); background: color-mix(in srgb, var(--ok, #22c55e) 12%, transparent); font-weight: 700; }
.vacuum-empty strong { color: var(--text-primary); font-size: 13px; }
.vacuum-empty p { margin: 3px 0 0; color: var(--text-tertiary); font-size: 12px; }
.vacuum-runs { display: grid; gap: 16px; }
.vacuum-run { overflow: hidden; border: 1px solid var(--border-subtle); border-left: 3px solid var(--amber, #f59e0b); border-radius: var(--r-md, 8px); background: color-mix(in srgb, var(--bg-surface) 97%, var(--amber, #f59e0b) 3%); }
.vacuum-run-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; padding: 18px 20px 14px; }
.vacuum-identity { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; min-width: 0; }
.vacuum-identity h4 { width: 100%; margin: 2px 0 0; overflow-wrap: anywhere; color: var(--text-secondary); font: 15px/1.35 var(--font-mono, monospace); }
.vacuum-identity h4 strong { color: var(--text-primary); font-weight: 650; }
.vacuum-operation { padding: 3px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); background: var(--bg-hover); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.vacuum-operation.auto { border-color: color-mix(in srgb, var(--ok, #22c55e) 35%, var(--border-subtle)); color: var(--ok, #22c55e); background: color-mix(in srgb, var(--ok, #22c55e) 8%, transparent); }
.vacuum-pid { color: var(--text-tertiary); font: 11px var(--font-mono, monospace); }
.vacuum-eta { display: grid; justify-items: end; min-width: 132px; text-align: right; }
.vacuum-eta > span { color: var(--text-tertiary); font-size: 10px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.vacuum-eta strong { margin-top: 3px; color: var(--text-primary); font: 600 22px/1.1 var(--font-mono, monospace); }
.vacuum-eta small { margin-top: 3px; color: var(--text-tertiary); font-size: 10px; }

.current-phase { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 9px 20px; border-block: 1px solid var(--border-subtle); color: var(--text-tertiary); background: color-mix(in srgb, var(--bg-hover) 66%, transparent); font-size: 11px; }
.current-phase strong { color: var(--text-primary); font-size: 12px; }
.current-phase-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber, #f59e0b); box-shadow: 0 0 0 4px color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent); }

.vacuum-timeline { display: grid; grid-template-columns: repeat(7, minmax(66px, 1fr)); gap: 0; margin: 0; padding: 20px 16px 16px; list-style: none; }
.vacuum-timeline li { position: relative; display: grid; justify-items: center; gap: 7px; min-width: 0; color: var(--text-tertiary); text-align: center; }
.vacuum-timeline li::before { content: ''; position: absolute; z-index: 0; top: 11px; right: 50%; width: 100%; height: 1px; background: var(--border-subtle); }
.vacuum-timeline li:first-child::before { display: none; }
.vacuum-timeline li.complete::before, .vacuum-timeline li.current::before { background: color-mix(in srgb, var(--ok, #22c55e) 56%, var(--border-subtle)); }
.stage-marker { position: relative; z-index: 1; display: grid; place-items: center; width: 23px; height: 23px; border: 1px solid var(--border-subtle); border-radius: 50%; color: var(--text-tertiary); background: var(--bg-surface); font: 10px var(--font-mono, monospace); }
.complete .stage-marker { border-color: var(--ok, #22c55e); color: var(--ok, #22c55e); }
.current .stage-marker { border-color: var(--amber, #f59e0b); color: var(--amber, #f59e0b); background: color-mix(in srgb, var(--amber, #f59e0b) 10%, var(--bg-surface)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--amber, #f59e0b) 10%, transparent); font-weight: 700; }
.stage-label { max-width: 92px; overflow-wrap: anywhere; font-size: 10px; line-height: 1.25; }
.current .stage-label { color: var(--text-primary); font-weight: 650; }
.complete .stage-label { color: var(--text-secondary); }

.phase-explainer { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(230px, .7fr); gap: 24px; margin: 0 20px 18px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--amber, #f59e0b) 24%, var(--border-subtle)); border-radius: var(--r-sm, 6px); background: color-mix(in srgb, var(--amber, #f59e0b) 5%, transparent); }
.phase-explainer span { color: var(--text-tertiary); font-size: 10px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.phase-explainer p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.phase-progress { align-self: center; }
.progress-label { display: flex; justify-content: space-between; gap: 12px; }
.progress-label strong { color: var(--text-primary); font: 12px var(--font-mono, monospace); }
.progress-track { overflow: hidden; height: 6px; margin-top: 7px; border-radius: 999px; background: color-mix(in srgb, var(--text-tertiary) 14%, transparent); }
.progress-track > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--amber, #f59e0b) 72%, #fff), var(--amber, #f59e0b)); transition: width .35s ease; }
.phase-progress small { display: block; margin-top: 6px; color: var(--text-tertiary); font-size: 10px; }

.stage-guide { margin: -6px 20px 18px; border-bottom: 1px solid var(--border-subtle); }
.stage-guide summary { width: fit-content; margin-bottom: 12px; color: var(--text-secondary); font-size: 11px; cursor: pointer; }
.stage-guide summary:hover { color: var(--text-primary); }
.stage-guide ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; margin: 0 0 16px; padding: 0; list-style: none; counter-reset: vacuum-stage; }
.stage-guide li { position: relative; padding: 9px 0 9px 30px; border-top: 1px solid var(--border-subtle); counter-increment: vacuum-stage; }
.stage-guide li::before { content: counter(vacuum-stage); position: absolute; top: 9px; left: 0; display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--border-subtle); border-radius: 50%; color: var(--text-tertiary); font: 9px var(--font-mono, monospace); }
.stage-guide strong { color: var(--text-primary); font-size: 11px; }
.stage-guide p { margin: 3px 0 0; color: var(--text-tertiary); font-size: 10.5px; line-height: 1.45; }

.vacuum-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 1px; margin: 0; padding: 0 20px 18px; }
.vacuum-facts > div { min-width: 0; padding: 10px 12px; border-left: 1px solid var(--border-subtle); }
.vacuum-facts > div:first-child { border-left: 0; padding-left: 0; }
.vacuum-facts dt { color: var(--text-tertiary); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
.vacuum-facts dd { margin: 5px 0 0; color: var(--text-primary); font: 12px var(--font-mono, monospace); }
.vacuum-facts dd small { color: var(--text-tertiary); font: 10px var(--font-sans, sans-serif); }
.eta-note, .collector-note { margin: 0; padding: 10px 20px; border-top: 1px solid var(--border-subtle); color: var(--text-tertiary); font-size: 10.5px; line-height: 1.45; }
.collector-note { color: var(--amber, #f59e0b); }

.other-maintenance { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border-subtle); }
.other-maintenance-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--text-primary); font-size: 12px; }
.other-maintenance-head span { color: var(--text-tertiary); font: 11px var(--font-mono, monospace); }
.command { color: var(--text-tertiary); font-size: 11px; }

@container (max-width: 720px) {
  .vacuum-run-head { grid-template-columns: 1fr; }
  .vacuum-eta { justify-items: start; text-align: left; }
  .phase-explainer { grid-template-columns: 1fr; }
  .stage-guide ol { grid-template-columns: 1fr; }
  .vacuum-timeline { grid-template-columns: 1fr; gap: 0; padding: 16px 20px; }
  .vacuum-timeline li { grid-template-columns: 23px 1fr; justify-items: start; align-items: center; gap: 10px; min-height: 38px; text-align: left; }
  .vacuum-timeline li::before { top: -50%; left: 11px; width: 1px; height: 100%; }
  .stage-label { max-width: none; }
  .vacuum-facts > div, .vacuum-facts > div:first-child { padding: 10px 12px; border-left: 1px solid var(--border-subtle); }
}
@container (max-width: 480px) {
  .maintenance-head { display: grid; }
  .vacuum-run-head, .current-phase { padding-inline: 14px; }
  .phase-explainer { margin-inline: 14px; }
  .stage-guide { margin-inline: 14px; }
  .vacuum-timeline { padding-inline: 14px; }
  .vacuum-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-inline: 14px; }
  .eta-note, .collector-note { padding-inline: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .progress-track > span { transition: none; }
}
</style>
