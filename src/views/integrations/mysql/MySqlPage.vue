<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../../../composables/useApi'
import { useTimeRangePreference } from '../../../composables/useTimeRangePreference'
import { StatPanel, TablePanel, TimeSeriesPanel, type TimeSeriesPanelSeries } from '../../../components/panels'
import {
  MYSQL_TABLE_COLUMNS,
  MYSQL_VIEW_META,
  presentMySqlRows,
  type MySqlView,
} from './mysqlPresentation'
import type { Filter, LogRecord, PromVectorResponse } from '../../../types'

const props = defineProps<{ view: string; server?: string; host?: string; db?: string }>()
const api = useApi()
const route = useRoute()
const rangeMinutes = useTimeRangePreference()
const loading = ref(false)
const error = ref('')
const tableRows = ref<Record<string, unknown>[]>([])
const charts = ref<Array<{ title: string; description: string; unit: string; series: TimeSeriesPanelSeries[] }>>([])
const stats = ref<Array<{
  title: string
  description: string
  value: number
  unit: string
  label: string
  precision?: number
  tone?: 'default' | 'positive' | 'warning' | 'danger'
}>>([])
const health = ref({ connected: 0, running: 0, maximum: 0, dbBytes: 0, lockEdges: 0, history: 0 })

const view = computed<MySqlView>(() => props.view in MYSQL_VIEW_META ? props.view as MySqlView : 'overview')
const meta = computed(() => MYSQL_VIEW_META[view.value])
const tableColumns = computed(() => MYSQL_TABLE_COLUMNS[view.value] || [])
const rangeLabel = computed(() => rangeMinutes.value >= 60 ? `${rangeMinutes.value / 60}h` : `${rangeMinutes.value}m`)

const attention = computed(() => {
  const snapshot = health.value
  const connectionUse = snapshot.maximum > 0 ? snapshot.connected / snapshot.maximum * 100 : 0
  if (snapshot.lockEdges > 0) return {
    tone: 'danger',
    label: 'Action needed',
    title: `${snapshot.lockEdges} blocked ${snapshot.lockEdges === 1 ? 'request' : 'requests'} right now`,
    message: 'One connection is waiting for another to release a lock. Check the blocker before stopping either connection.',
    page: 'locks',
    action: 'Review blocked work',
  }
  if (connectionUse >= 90) return {
    tone: 'danger',
    label: 'Action needed',
    title: 'Connection capacity is almost full',
    message: `${snapshot.connected} of ${snapshot.maximum} allowed connections are open. New clients may soon be refused.`,
    page: 'capacity',
    action: 'Review capacity',
  }
  if (connectionUse >= 75 || snapshot.history >= 10_000) return {
    tone: 'warning',
    label: 'Watch closely',
    title: 'Database pressure is building',
    message: 'Connection use or the InnoDB purge backlog is above the review threshold. Check the trend before it becomes an incident.',
    page: 'capacity',
    action: 'Review capacity',
  }
  return {
    tone: 'positive',
    label: 'No urgent pressure',
    title: 'MySQL looks steady right now',
    message: 'Connections have headroom, no work is blocked, and the InnoDB purge backlog is below the review threshold.',
    page: 'queries',
    action: 'Review expensive queries',
  }
})

const attentionRoute = computed(() => ({
  name: 'integration-page',
  params: { addon: 'mysql', page: attention.value.page },
  query: route.query,
}))

function promValue(value: string): string { return JSON.stringify(value) }
function selector(extra: Record<string, string> = {}): string {
  const labels: string[] = []
  if (props.server) labels.push(`service_name=${promValue(props.server)}`)
  if (props.host) labels.push(`host=${promValue(props.host)}`)
  if (props.db) labels.push(`db=${promValue(props.db)}`)
  for (const [key, value] of Object.entries(extra)) labels.push(`${key}=${promValue(value)}`)
  return labels.length ? `{${labels.join(',')}}` : ''
}

async function scalar(query: string): Promise<number> {
  const response: PromVectorResponse = await api.promQuery(query)
  return response.result.reduce((sum, item) => sum + (Number(item.value?.[1]) || 0), 0)
}

function metricName(metric: Record<string, string>, fallback: string): string {
  return metric.category || metric.state || metric.wait_event || metric.channel || metric.db || fallback
}

async function series(query: string, fallback: string): Promise<TimeSeriesPanelSeries[]> {
  const end = Math.floor(Date.now() / 1000)
  const start = end - rangeMinutes.value * 60
  const step = Math.max(10, Math.ceil((end - start) / 240))
  const response = await api.promQueryRange(query, start, end, step)
  return response.result.map((item) => ({
    name: metricName(item.metric || {}, fallback),
    points: (item.values || []).map(([timestamp, value]) => [timestamp, Number(value) || 0] as [number, number]),
  }))
}

function logFilters(event: string): Filter[] {
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: event }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
  if (props.db) filters.push({ field: 'log.db', op: '=', value: props.db })
  return filters
}

async function loadLogs() {
  if (!meta.value.events.length) { tableRows.value = []; return }
  const now = Date.now()
  const responses = await Promise.all(meta.value.events.map((event) => api.queryLogs({
    time_range: { from: new Date(now - rangeMinutes.value * 60_000).toISOString(), to: new Date(now).toISOString() },
    filters: logFilters(event),
    limit: 1000,
  })))
  const sourceRows = responses.flatMap((response) => response.rows as LogRecord[])
  tableRows.value = presentMySqlRows(view.value, sourceRows).slice(0, 250)
}

async function loadStats() {
  if (!['overview', 'capacity'].includes(props.view)) { stats.value = []; return }
  const s = selector()
  const [connected, running, maximum, dbBytes, lockEdges, history] = await Promise.all([
    scalar(`sum(mysql_threads_connected${s})`), scalar(`sum(mysql_threads_running${s})`),
    scalar(`max(mysql_max_connections${s})`), scalar(`sum(mysql_database_size_bytes${s})`),
    scalar(`sum(mysql_lock_wait_edges${s})`), scalar(`max(mysql_innodb_history_list_length${s})`),
  ])
  const used = maximum > 0 ? connected / maximum * 100 : 0
  health.value = { connected, running, maximum, dbBytes, lockEdges, history }
  stats.value = [
    { title: 'Open connections', description: 'Client sessions open now, including idle sessions.', value: connected, unit: '', label: maximum > 0 ? `${connected} of ${maximum} allowed` : 'configured limit unavailable', tone: used >= 90 ? 'danger' : used >= 75 ? 'warning' : 'default' },
    { title: 'Working now', description: 'Connections actively executing a statement.', value: running, unit: '', label: 'connections executing a statement' },
    { title: 'Data stored', description: 'Combined table data and index storage for the selected scope.', value: dbBytes / 1024 / 1024 / 1024, unit: 'GiB', label: 'table data and indexes', precision: 2 },
    { title: 'Blocked requests', description: 'Transactions waiting for another transaction to release a lock.', value: lockEdges, unit: '', label: lockEdges === 1 ? 'transaction waiting on a lock' : 'transactions waiting on a lock', tone: lockEdges > 0 ? 'danger' : 'positive' },
    { title: 'Purge backlog', description: 'Old InnoDB row versions still waiting for cleanup.', value: history, unit: '', label: 'old row versions awaiting cleanup', tone: history >= 10_000 ? 'warning' : 'default' },
  ]
}

function chartDefinitions(): Array<{ title: string; description: string; unit: string; query: string; fallback: string }> {
  const s = selector()
  const definitions: Record<string, Array<{ title: string; description: string; unit: string; query: string; fallback: string }>> = {
    overview: [
      { title: 'Queries each second', description: 'Statements MySQL handled per second. Use this to separate load changes from slower execution.', unit: 'queries/s', query: `sum(rate(mysql_queries_total${s}[5m]))`, fallback: 'queries/s' },
      { title: 'Connections doing work', description: 'Open connections actively executing a statement.', unit: 'sessions', query: `sum(mysql_threads_running${s})`, fallback: 'working' },
    ],
    queries: [
      { title: 'Database time', description: 'Total time MySQL spent executing the observed query patterns.', unit: 's', query: `sum(mysql_query_db_time_ms${s}) / 1000`, fallback: 'database time' },
      { title: 'Time waiting on locks', description: 'Part of query time spent waiting for another transaction.', unit: 's', query: `sum(mysql_query_lock_time_ms${s}) / 1000`, fallback: 'lock time' },
    ],
    activity: [{ title: 'Connections by state', description: 'Foreground connections grouped by what they are doing.', unit: 'sessions', query: `sum by (state) (mysql_sessions${s})`, fallback: 'connections' }],
    waits: [{ title: 'Wait time by type', description: 'Time MySQL could not make progress, grouped by the resource it needed.', unit: 's', query: `sum by (category) (mysql_wait_time_ms${s}) / 1000`, fallback: 'wait' }],
    locks: [{ title: 'Blocked requests', description: 'Transactions currently waiting for another transaction to release a lock.', unit: 'requests', query: `sum(mysql_lock_wait_edges${s})`, fallback: 'blocked' }],
    replication: [{ title: 'Replica delay', description: 'Reported delay behind each replication source.', unit: 's', query: `max by (channel) (mysql_replication_lag_seconds${s})`, fallback: 'delay' }],
    capacity: [
      { title: 'Stored data', description: 'Combined table data and index storage.', unit: 'GiB', query: `sum(mysql_database_size_bytes${s}) / 1073741824`, fallback: 'stored data' },
      { title: 'Open connections', description: 'Client sessions open during the selected range.', unit: 'sessions', query: `sum(mysql_threads_connected${s})`, fallback: 'connections' },
    ],
  }
  return definitions[props.view] || []
}

async function loadCharts() {
  charts.value = await Promise.all(chartDefinitions().map(async (definition) => ({
    title: definition.title,
    description: definition.description,
    unit: definition.unit,
    series: await series(definition.query, definition.fallback),
  })))
}

async function load() {
  loading.value = true
  error.value = ''
  try { await Promise.all([loadStats(), loadCharts(), loadLogs()]) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'MySQL data could not be loaded.' }
  finally { loading.value = false }
}

onMounted(load)
watch(() => [props.view, props.server, props.host, props.db, rangeMinutes.value], load)
</script>

<template>
  <div class="mysql-page">
    <header class="mysql-page-head">
      <div>
        <p class="mysql-eyebrow">{{ meta.eyebrow }}</p>
        <h2>{{ meta.title }}</h2>
        <p>{{ meta.description }}</p>
      </div>
      <span class="mysql-range">{{ rangeLabel }}</span>
    </header>

    <section v-if="view === 'overview'" class="mysql-attention" :class="`mysql-attention--${attention.tone}`" aria-live="polite">
      <div class="mysql-attention-copy">
        <span class="mysql-attention-label">{{ attention.label }}</span>
        <strong>{{ attention.title }}</strong>
        <p>{{ attention.message }}</p>
      </div>
      <router-link class="mysql-attention-action" :to="attentionRoute">{{ attention.action }} <span aria-hidden="true">→</span></router-link>
    </section>

    <section class="mysql-guide" aria-label="How to read this view">
      <div class="mysql-guide-intro">
        <span>How to read this</span>
        <p>{{ meta.guide }}</p>
      </div>
      <dl class="mysql-terms">
        <div v-for="item in meta.terms" :key="item.term">
          <dt>{{ item.term }}</dt>
          <dd>{{ item.meaning }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="stats.length" class="mysql-stats" aria-label="MySQL summary">
      <StatPanel v-for="stat in stats" :key="stat.title" :title="stat.title" :description="stat.description" :value="stat.value" :unit="stat.unit" :label="stat.label" :precision="stat.precision" :tone="stat.tone" :loading="loading" :error="error || null" source-label="MySQL" :range-label="rangeLabel" />
    </section>

    <section v-if="charts.length || loading" class="mysql-charts">
      <TimeSeriesPanel v-for="chart in charts" :key="chart.title" :title="chart.title" :description="chart.description" :series="chart.series" :unit="chart.unit" :loading="loading" :error="error || null" source-label="Metrics" :range-label="rangeLabel" />
    </section>

    <TablePanel
      v-if="meta.events.length"
      :title="view === 'overview' ? 'Current findings' : meta.title"
      :description="meta.guide"
      :rows="tableRows"
      :columns="tableColumns"
      :loading="loading"
      :error="error || null"
      source-label="MySQL diagnostics"
      :range-label="rangeLabel"
      empty-title="No matching MySQL evidence"
      :empty-message="`Rush found no matching rows during the last ${rangeLabel}.`"
    />
  </div>
</template>

<style scoped>
.mysql-page {
  container-type: inline-size;
  display: grid;
  min-width: 0;
  gap: clamp(20px, 3vw, 32px);
}

.mysql-page-head {
  display: grid;
  gap: 12px;
  padding: 2px 2px 0;
}

.mysql-eyebrow,
.mysql-guide-intro > span,
.mysql-attention-label {
  margin: 0 0 6px !important;
  color: var(--text-tertiary) !important;
  font-size: 10px !important;
  font-weight: 750;
  letter-spacing: .13em;
  text-transform: uppercase;
}

.mysql-page-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(24px, 4vw, 34px);
  font-weight: 720;
  letter-spacing: -.04em;
  line-height: 1.04;
}

.mysql-page-head p {
  max-width: 700px;
  margin: 9px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.mysql-range {
  width: fit-content;
  padding: 5px 8px;
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm, 4px);
  font: 10px var(--font-mono, monospace);
}

.mysql-attention {
  position: relative;
  display: grid;
  gap: 16px;
  padding: clamp(18px, 3vw, 26px);
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-surface) 92%, var(--amber-dim));
  border-block: 1px solid var(--border-subtle);
}

.mysql-attention::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  content: '';
  background: var(--text-tertiary);
}

.mysql-attention--danger::before { background: var(--error); }
.mysql-attention--warning::before { background: var(--warning, var(--amber)); }
.mysql-attention--positive::before { background: var(--ok); }

.mysql-attention-copy { min-width: 0; }
.mysql-attention-copy strong {
  display: block;
  color: var(--text-primary);
  font-size: clamp(17px, 2.5vw, 22px);
  font-weight: 700;
  letter-spacing: -.025em;
}

.mysql-attention-copy p {
  max-width: 720px;
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.mysql-attention-action {
  align-self: center;
  width: fit-content;
  color: var(--amber);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}

.mysql-attention-action:hover { text-decoration: underline; text-underline-offset: 3px; }
.mysql-attention-action:focus-visible { outline: 2px solid var(--amber); outline-offset: 4px; }

.mysql-guide {
  display: grid;
  gap: 18px;
  padding: 0 2px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.mysql-guide-intro p {
  max-width: 760px;
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.55;
}

.mysql-terms {
  display: grid;
  gap: 12px;
  margin: 0;
}

.mysql-terms > div {
  display: grid;
  grid-template-columns: minmax(92px, 120px) minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
}

.mysql-terms dt {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 720;
}

.mysql-terms dd {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 1.45;
}

.mysql-stats,
.mysql-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

@container (min-width: 500px) {
  .mysql-page-head {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 24px;
  }

  .mysql-guide { grid-template-columns: minmax(220px, .9fr) minmax(280px, 1.1fr); gap: 32px; }
  .mysql-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mysql-attention { grid-template-columns: minmax(0, 1fr) auto; }
}

@container (min-width: 820px) {
  .mysql-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .mysql-charts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
