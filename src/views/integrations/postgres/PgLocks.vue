<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord, PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)
interface LockRow extends Record<string, unknown> {
  id: string
  locktype: string
  mode: string
  relation: string
  waiting: number
  age: number
}
const rows = ref<LockRow[]>([])
const prepared = ref(0)
const preparedAge = ref(0)
const columns: DataTableColumn[] = [
  { key: 'locktype', label: 'Lock type', sortable: true },
  { key: 'mode', label: 'Mode', sortable: true },
  { key: 'relation', label: 'Object', sortable: true },
  { key: 'waiting', label: 'Waiting', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'age', label: 'Oldest wait', align: 'right', sortable: true, cellClass: 'num' },
]
function selector(): string {
  const p: string[] = []
  if (props.server) p.push('service_name="' + props.server + '"')
  if (props.host) p.push('host="' + props.host + '"')
  // Lock state is cluster-wide and is emitted once per host, not per database.
  return p.length ? '{' + p.join(',') + '}' : ''
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
function fmtAge(value: number): string {
  if (!isFinite(value)) return '—'
  if (value < 60) return Math.round(value) + 's'
  if (value < 3600) return Math.round(value / 60) + 'm'
  return (value / 3600).toFixed(1) + 'h'
}
async function vector(query: string): Promise<PromVectorResponse['result']> {
  try { return (await api.promQuery(query)).result } catch { return [] }
}
async function load() {
  loading.value = true
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.lock_wait' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
  const now = Date.now()
  try {
    const [logs, waiters, ages, preparedCount, preparedOldest] = await Promise.all([
      api.queryLogs({ time_range: { from: new Date(now - 120_000).toISOString(), to: new Date(now).toISOString() }, filters, limit: 500 }),
      vector('postgresql_lock_waiters' + selector()),
      vector('postgresql_lock_wait_age' + selector()),
      vector('postgresql_prepared_transactions' + selector()),
      vector('postgresql_prepared_transaction_age' + selector()),
    ])
    const latest = new Map<string, LockRow>()
    for (const item of logs.rows as LogRecord[]) {
      const a = item.LogAttributes
      const id = (a.locktype || '') + '|' + (a.mode || '') + '|' + (a.relation || '')
      latest.set(id, { id, locktype: a.locktype || '—', mode: a.mode || '—', relation: (a.schema ? a.schema + '.' : '') + (a.relation || 'database'), waiting: n(a.waiting), age: n(a.max_age_s) })
    }
    const byKey = new Map<string, LockRow>()
    for (const item of waiters) {
      const key = (item.metric.locktype || '') + '|' + (item.metric.mode || '') + '|' + (item.metric.relation || '')
      const row = byKey.get(key) || { id: key, locktype: item.metric.locktype || '—', mode: item.metric.mode || '—', relation: (item.metric.schema ? item.metric.schema + '.' : '') + (item.metric.relation || 'database'), waiting: 0, age: 0 }
      row.waiting = n(item.value?.[1]); byKey.set(key, row)
    }
    for (const item of ages) {
      const key = (item.metric.locktype || '') + '|' + (item.metric.mode || '') + '|' + (item.metric.relation || '')
      const row = byKey.get(key); if (row) row.age = n(item.value?.[1])
    }
    for (const [key, row] of latest) if (!byKey.has(key)) byKey.set(key, row)
    rows.value = Array.from(byKey.values()).sort((a, b) => b.age - a.age)
    prepared.value = preparedCount.reduce((sum, item) => sum + n(item.value?.[1]), 0)
    preparedAge.value = preparedOldest.reduce((max, item) => Math.max(max, n(item.value?.[1])), 0)
  } catch {
    rows.value = []
  } finally { loading.value = false }
}
function lockRow(row: Record<string, unknown>): LockRow { return row as LockRow }
onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-locks">
    <section class="locks-head"><div><div class="eyebrow">Contention evidence</div><h2>Locks and transactions</h2><p>Find the object, lock mode, and age behind blocked work before changing application or database settings.</p></div><div class="locks-note">Read-only diagnostics</div></section>
    <section class="stat-strip"><div><span>Lock groups</span><strong>{{ rows.length }}</strong></div><div><span>Prepared transactions</span><strong :class="{ warn: prepared }">{{ Math.round(prepared) }}</strong></div><div><span>Oldest prepared</span><strong>{{ prepared ? fmtAge(preparedAge) : '—' }}</strong></div></section>
    <p v-if="loading && !rows.length" class="pg-empty">Loading lock evidence…</p>
    <p v-else-if="!rows.length" class="pg-empty">No lock waits are reporting in the current window.</p>
    <DataTable v-else :columns="columns" :rows="rows" row-key="id">
      <template #cell-locktype="{ row }">{{ lockRow(row).locktype }}</template>
      <template #cell-mode="{ row }"><span class="mono">{{ lockRow(row).mode }}</span></template>
      <template #cell-relation="{ row }">{{ lockRow(row).relation }}</template>
      <template #cell-waiting="{ row }">{{ Math.round(lockRow(row).waiting) }}</template>
      <template #cell-age="{ row }">{{ fmtAge(lockRow(row).age) }}</template>
    </DataTable>
  </div>
</template>

<style scoped>
.pg-locks { display: grid; gap: 22px; }
.locks-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.locks-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.locks-note { color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.stat-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; border: 1px solid var(--border-subtle); background: var(--border-subtle); }
.stat-strip > div { display: grid; gap: 5px; padding: 16px; background: var(--bg-surface); }
.stat-strip span { color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.stat-strip strong { color: var(--text-primary); font: 600 18px var(--font-mono, monospace); }
.stat-strip strong.warn { color: var(--amber, #f59e0b); }
.mono, .num { font-family: var(--font-mono, monospace); font-size: 11px; }
@media (max-width: 700px) { .locks-head { display: block; } .locks-note { margin-top: 16px; } .stat-strip { grid-template-columns: 1fr; } }
</style>
