<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord, PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string }>()
const api = useApi()
const loading = ref(false)

interface Session extends Record<string, unknown> {
  pid: string
  state: string
  db: string
  user: string
  waitType: string
  waitEvent: string
  queryAge: number
  xactAge: number
  blockedBy: string[]
  query: string
}
const sessions = ref<Session[]>([])
const sessionColumns: DataTableColumn[] = [
  { key: 'pid', label: 'PID', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'state', label: 'State', sortable: true },
  { key: 'db', label: 'DB', sortable: true },
  { key: 'user', label: 'User', sortable: true },
  { key: 'wait', label: 'Wait', sortable: true },
  { key: 'duration', label: 'Duration', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'blocked', label: 'Blocked by', sortable: true },
  { key: 'query', label: 'Query' },
]
interface Wait { type: string; event: string; count: number }
const waits = ref<Wait[]>([])
const stateCounts = ref<Record<string, number>>({})
let timer: ReturnType<typeof setInterval> | null = null

const num = (s: string | undefined) => parseFloat(s ?? '0') || 0

async function load() {
  if (!loading.value) loading.value = true
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.activity' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  const now = Date.now()
  try {
    const res = await api.queryLogs({
      time_range: { from: new Date(now - 90_000).toISOString(), to: new Date(now).toISOString() },
      filters,
      limit: 500,
    })
    // Keep the newest sample per pid (rows arrive newest-first).
    const seen = new Set<string>()
    const out: Session[] = []
    for (const r of res.rows as LogRecord[]) {
      const a = r.LogAttributes
      const pid = a['pid'] || ''
      if (!pid || seen.has(pid)) continue
      seen.add(pid)
      out.push({
        pid,
        state: a['state'] || '',
        db: a['db'] || '',
        user: a['user'] || '',
        waitType: a['wait_event_type'] || '',
        waitEvent: a['wait_event'] || '',
        queryAge: num(a['query_age_s']),
        xactAge: num(a['xact_age_s']),
        blockedBy: (a['blocked_by'] || '').split(',').map((x) => x.trim()).filter(Boolean),
        query: r.Body,
      })
    }
    sessions.value = out

    const wq: PromVectorResponse = await api.promQuery(
      `postgresql_wait_events${props.server ? `{service_name="${props.server}"}` : ''}`,
    )
    waits.value = wq.result
      .map((s) => ({ type: s.metric.wait_event_type || '', event: s.metric.wait_event || '', count: num(s.value?.[1]) }))
      .filter((w) => w.count > 0)
      .sort((a, b) => b.count - a.count)

    // Session-state breakdown from the metric — present even when the DB is fully
    // idle (the activity logs only carry non-idle sessions).
    const sq: PromVectorResponse = await api.promQuery(
      `postgresql_active_sessions${props.server ? `{service_name="${props.server}"}` : ''}`,
    )
    const sc: Record<string, number> = {}
    for (const s of sq.result) sc[s.metric.state || 'unknown'] = num(s.value?.[1])
    stateCounts.value = sc
  } catch { /* surfaced via empty state */ } finally {
    loading.value = false
  }
}

// Active (non-idle / blocked) sessions, sortable; longest-running first by default.
type SortKey = 'pid' | 'state' | 'db' | 'user' | 'wait' | 'duration' | 'blocked'
const sortKey = ref<SortKey>('duration')
const sortDir = ref<'asc' | 'desc'>('desc')
function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else { sortKey.value = k; sortDir.value = k === 'duration' ? 'desc' : 'asc' }
}
function sortVal(s: Session, k: SortKey): number | string {
  switch (k) {
    case 'pid': return Number(s.pid) || 0
    case 'duration': return s.queryAge
    case 'blocked': return s.blockedBy.length
    case 'wait': return s.waitType ? `${s.waitType}:${s.waitEvent}` : ''
    case 'state': return s.state
    case 'db': return s.db
    case 'user': return s.user
  }
}
const active = computed(() => {
  const dir = sortDir.value === 'desc' ? -1 : 1
  return sessions.value
    .filter((s) => s.state !== 'idle' || s.blockedBy.length)
    .sort((a, b) => {
      const av = sortVal(a, sortKey.value)
      const bv = sortVal(b, sortKey.value)
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
      return ((av as number) - (bv as number)) * dir
    })
})
function sessionRowClass(s: Record<string, unknown>): string {
  const row = s as Session
  return [row.queryAge > 30 ? 'slow' : '', row.blockedBy.length ? 'blocked' : ''].filter(Boolean).join(' ')
}
function sessionFromRow(row: Record<string, unknown>): Session { return row as Session }
function waitText(row: Record<string, unknown>): string {
  const s = sessionFromRow(row)
  return s.waitType ? s.waitType + (s.waitEvent ? ':' + s.waitEvent : '') : '—'
}
function blockedText(row: Record<string, unknown>): string { return sessionFromRow(row).blockedBy.join(', ') || '—' }
function queryText(row: Record<string, unknown>): string {
  const query = sessionFromRow(row).query
  return query.length > 80 ? query.slice(0, 80) + '…' : (query || '—')
}
function onSessionSort(key: string) {
  if (key === 'pid' || key === 'state' || key === 'db' || key === 'user' || key === 'wait' || key === 'duration' || key === 'blocked') setSort(key)
}

// Summary tiles. Active/idle come from the state metric (always present); the
// waiting/blocked/longest details come from the sampled non-idle sessions.
const summary = computed(() => {
  const ss = sessions.value
  const nonIdle = ss.filter((s) => s.state !== 'idle')
  return {
    active: stateCounts.value['active'] ?? ss.filter((s) => s.state === 'active').length,
    idle: stateCounts.value['idle'] ?? 0,
    waiting: nonIdle.filter((s) => s.waitType).length,
    blocked: ss.filter((s) => s.blockedBy.length).length,
    longest: ss.reduce((m, s) => Math.max(m, s.state !== 'idle' ? s.queryAge : 0), 0),
  }
})
const hasData = computed(() => sessions.value.length > 0 || Object.keys(stateCounts.value).length > 0)
// Blocking edges: waiter → blockers. Root blockers block others but aren't blocked.
const blockedEdges = computed(() => sessions.value.filter((s) => s.blockedBy.length))
const blockerPids = computed(() => new Set(blockedEdges.value.flatMap((s) => s.blockedBy)))
const blockedPids = computed(() => new Set(blockedEdges.value.map((s) => s.pid)))

function fmtAge(s: number): string {
  if (s < 1) return '<1s'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

onMounted(() => {
  load()
  timer = setInterval(load, 7000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
watch(() => props.server, load)
</script>

<template>
  <div>
    <p class="pg-loading" v-if="loading && !sessions.length">Loading activity…</p>

    <!-- Session summary -->
    <div class="pg-stat-grid" v-if="hasData">
      <div class="pg-stat"><div class="label">Active</div><div class="value">{{ summary.active }}</div></div>
      <div class="pg-stat"><div class="label">Idle</div><div class="value">{{ summary.idle }}</div></div>
      <div class="pg-stat"><div class="label">Waiting</div><div class="value" :class="{ warn: summary.waiting }">{{ summary.waiting }}</div></div>
      <div class="pg-stat"><div class="label">Blocked</div><div class="value" :class="{ crit: summary.blocked }">{{ summary.blocked }}</div></div>
      <div class="pg-stat"><div class="label">Longest running</div><div class="value">{{ fmtAge(summary.longest) }}</div></div>
    </div>

    <!-- Blocking -->
    <div v-if="blockedEdges.length" class="block-panel">
      <div class="block-head">Blocking detected</div>
      <div v-for="s in blockedEdges" :key="s.pid" class="block-edge">
        <span class="pid">pid {{ s.pid }}</span>
        <span class="muted">waiting on</span>
        <span v-for="b in s.blockedBy" :key="b" class="pid" :class="{ root: blockerPids.has(b) && !blockedPids.has(b) }">{{ b }}</span>
      </div>
    </div>

    <!-- Wait events -->
    <div v-if="waits.length" class="wait-row">
      <span class="wait-label">Wait events:</span>
      <span v-for="w in waits" :key="w.type + w.event" class="wait-chip">
        {{ w.type }}<span v-if="w.event">:{{ w.event }}</span> <b>{{ w.count }}</b>
      </span>
    </div>

    <!-- Running queries -->
    <p class="pg-empty" v-if="!active.length && !loading">No active sessions right now.</p>
    <DataTable
      v-else-if="active.length"
      :columns="sessionColumns"
      :rows="active"
      row-key="pid"
      :sort-key="sortKey"
      :sort-direction="sortDir"
      :row-class="sessionRowClass"
      @sort="onSessionSort"
    >
      <template #cell-wait="{ row }">{{ waitText(row) }}</template>
      <template #cell-duration="{ row }">{{ fmtAge(sessionFromRow(row).queryAge) }}</template>
      <template #cell-blocked="{ row }">{{ blockedText(row) }}</template>
      <template #cell-query="{ row }"><code class="pg-sql">{{ queryText(row) }}</code></template>
    </DataTable>
    <p class="auto-note">Auto-refreshes every 7s.</p>
  </div>
</template>

<style scoped>
.block-panel {
  border: 1px solid var(--error, #ef4444);
  border-left-width: 3px;
  background: color-mix(in srgb, var(--error, #ef4444) 7%, var(--bg-surface));
  border-radius: var(--r-md, 8px);
  padding: var(--sp-4, 16px);
  margin-bottom: var(--sp-4, 16px);
}
.block-head { font-weight: 600; font-size: 13px; margin-bottom: 8px; color: var(--error, #ef4444); }
.block-edge { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 2px 0; }
.block-edge .pid { font-family: var(--font-mono, monospace); color: var(--text-primary); }
.block-edge .pid.root { color: var(--error, #ef4444); font-weight: 600; }
.block-edge .muted { color: var(--text-tertiary); }
.wait-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: var(--sp-4, 16px); }
.wait-label { font-size: 12px; color: var(--text-tertiary); }
.wait-chip {
  font-size: 11.5px; font-family: var(--font-mono, monospace);
  color: var(--text-secondary); background: var(--bg-hover);
  padding: 2px 8px; border-radius: 999px;
}
.pg-stat .value.warn { color: var(--amber, #f59e0b); }
.pg-stat .value.crit { color: var(--error, #ef4444); }
.auto-note { font-size: 11px; color: var(--text-tertiary); margin-top: 10px; }
</style>
