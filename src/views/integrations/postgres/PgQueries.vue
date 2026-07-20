<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import TimeseriesWidget from '../../../components/widgets/TimeseriesWidget.vue'
import type { Filter, LogRecord } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

// Per-queryid mean-time trend (loaded lazily when a row is expanded).
type Series = Array<{ name: string; points: [number, number][] }>
const trends = ref<Record<string, Series>>({})

async function loadTrend(queryid: string) {
  if (trends.value[queryid]) return
  const sel = props.server
    ? `{queryid="${queryid}",service_name="${props.server}"}`
    : `{queryid="${queryid}"}`
  const end = Math.floor(Date.now() / 1000)
  const start = end - 6 * 3600
  try {
    const res = await api.promQueryRange(`postgresql_query_mean_time${sel}`, start, end, 300)
    const points = (res.result[0]?.values ?? []).map(
      ([ts, v]) => [ts, parseFloat(v) || 0] as [number, number],
    )
    trends.value = { ...trends.value, [queryid]: [{ name: 'mean ms', points }] }
  } catch { /* leave trend absent */ }
}

interface QueryRow extends Record<string, unknown> {
  queryid: string
  db: string
  user: string
  mean_ms: number
  total_ms: number
  calls: number
  rows: number
  rows_per_call: number
  blks_hit: number
  blks_read: number
  temp_blocks: number
  io_ms: number
  sql: string
  ts: number
}

const rows = ref<QueryRow[]>([])
const expanded = ref<string | null>(null)
type SortKey = 'sql' | 'total_ms' | 'mean_ms' | 'calls' | 'rows' | 'cache' | 'db'
const sortKey = ref<SortKey>('mean_ms')
const sortDir = ref<'asc' | 'desc'>('desc')
const queryColumns: DataTableColumn[] = [
  { key: 'sql', label: 'Query', sortable: true },
  { key: 'total_ms', label: 'DB time', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'mean_ms', label: 'Mean ms', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'calls', label: 'Calls', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'rows', label: 'Rows', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'cache', label: 'Cache %', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'db', label: 'DB', sortable: true },
]

function sortVal(row: QueryRow, key: SortKey): number | string {
  switch (key) {
    case 'sql': return row.sql
    case 'db': return row.db
    case 'cache': return row.blks_hit / Math.max(row.blks_hit + row.blks_read, 1)
    case 'total_ms': return row.total_ms
    case 'mean_ms': return row.mean_ms
    case 'calls': return row.calls
    case 'rows': return row.rows
  }
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'sql' || key === 'db' ? 'asc' : 'desc'
  }
}

const sorted = computed(() => {
  const direction = sortDir.value === 'desc' ? -1 : 1
  return [...rows.value]
    .sort((a, b) => {
      const av = sortVal(a, sortKey.value)
      const bv = sortVal(b, sortKey.value)
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * direction
      return ((av as number) - (bv as number)) * direction
    })
    .slice(0, 100)
})

const num = (s: string | undefined) => parseFloat(s ?? '0') || 0

async function load() {
  loading.value = true
  rows.value = []
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.query_stats' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
  if (props.db) filters.push({ field: 'log.db', op: '=', value: props.db })
  const now = Date.now()
  try {
    // Backend returns newest-first; fetch a window and keep the latest row per queryid.
    const res = await api.queryLogs({
      time_range: { from: new Date(now - 6 * 3600_000).toISOString(), to: new Date(now).toISOString() },
      filters,
      limit: 1000,
    })
    const latest = new Map<string, LogRecord>()
    for (const r of res.rows) {
      const id = r.LogAttributes['queryid'] || ''
      if (!id) continue
      if (!latest.has(id)) latest.set(id, r) // first seen = newest (DESC order)
    }
    rows.value = Array.from(latest.values()).map((r) => {
      const a = r.LogAttributes
      return {
        queryid: a['queryid'] || '',
        db: a['db'] || '',
        user: a['user'] || '',
        mean_ms: num(a['mean_ms']),
        total_ms: num(a['total_ms']),
        calls: num(a['calls']),
        rows: num(a['rows']),
        rows_per_call: num(a['rows_per_call']) || (num(a['calls']) > 0 ? num(a['rows']) / num(a['calls']) : 0),
        blks_hit: num(a['shared_blks_hit']),
        blks_read: num(a['shared_blks_read']),
        temp_blocks: num(a['temp_blks_read']) + num(a['temp_blks_written']),
        io_ms: num(a['blk_read_ms']) + num(a['blk_write_ms']),
        sql: r.Body,
        ts: r.Timestamp,
      }
    })
  } catch { /* surfaced via empty state */ }
  loading.value = false
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
  if (expanded.value === id) loadTrend(id)
}
function queryRow(row: Record<string, unknown>): QueryRow { return row as QueryRow }
function toggleQueryRow(row: Record<string, unknown>) { toggle(queryRow(row).queryid) }
function onQuerySort(key: string) {
  if (key === 'sql' || key === 'total_ms' || key === 'mean_ms' || key === 'calls' || key === 'rows' || key === 'cache' || key === 'db') setSort(key)
}

const copiedId = ref<string | null>(null)
async function copySql(id: string, sql: string) {
  try {
    await navigator.clipboard.writeText(sql)
    copiedId.value = id
    setTimeout(() => { if (copiedId.value === id) copiedId.value = null }, 1500)
  } catch { /* clipboard unavailable */ }
}
function cacheHit(r: { blks_hit: number; blks_read: number }): string {
  const t = r.blks_hit + r.blks_read
  return t > 0 ? `${((r.blks_hit / t) * 100).toFixed(0)}%` : '—'
}

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <p class="pg-empty" v-if="loading && !rows.length">Loading queries…</p>
    <p class="pg-empty" v-else-if="!rows.length">
      No query statistics yet. The collector emits these from <code>pg_stat_statements</code>
      every interval (deltas; the first interval only primes a baseline).
    </p>
    <DataTable
      v-else
      :columns="queryColumns"
      :rows="sorted"
      row-key="queryid"
      :sort-key="sortKey"
      :sort-direction="sortDir"
      clickable-rows
      :expanded-row-key="expanded"
      @sort="onQuerySort"
      @row-click="toggleQueryRow"
    >
      <template #cell-sql="{ row }"><code class="pg-sql">{{ queryRow(row).sql.length > 90 ? queryRow(row).sql.slice(0, 90) + '…' : queryRow(row).sql }}</code></template>
      <template #cell-total_ms="{ row }">{{ queryRow(row).total_ms.toFixed(0) }} ms</template>
      <template #cell-mean_ms="{ row }">{{ queryRow(row).mean_ms.toFixed(2) }}</template>
      <template #cell-calls="{ row }">{{ Math.round(queryRow(row).calls).toLocaleString() }}</template>
      <template #cell-rows="{ row }">{{ Math.round(queryRow(row).rows).toLocaleString() }}</template>
      <template #cell-cache="{ row }">{{ cacheHit(queryRow(row)) }}</template>
      <template #row-detail="{ row }">
              <div class="q-panel">
                <!-- Stat tiles (per-interval deltas) -->
                <div class="q-stats">
                  <div class="q-stat">
                    <div class="q-lbl">DB time</div>
                    <div class="q-val">{{ queryRow(row).total_ms.toFixed(0) }}<span class="q-unit">ms</span></div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Mean latency</div>
                    <div class="q-val accent">{{ queryRow(row).mean_ms.toFixed(2) }}<span class="q-unit">ms</span></div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Calls</div>
                    <div class="q-val">{{ Math.round(queryRow(row).calls).toLocaleString() }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Rows</div>
                    <div class="q-val">{{ Math.round(queryRow(row).rows).toLocaleString() }}<span class="q-unit"> · {{ queryRow(row).rows_per_call.toFixed(1) }}/call</span></div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Cache hit</div>
                    <div class="q-val">{{ cacheHit(queryRow(row)) }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Blocks hit / read</div>
                    <div class="q-val small">{{ Math.round(queryRow(row).blks_hit).toLocaleString() }} / {{ Math.round(queryRow(row).blks_read).toLocaleString() }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Temp blocks</div>
                    <div class="q-val small">{{ Math.round(queryRow(row).temp_blocks).toLocaleString() }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">IO time</div>
                    <div class="q-val small">{{ queryRow(row).io_ms.toFixed(1) }} ms</div>
                  </div>
                </div>

                <!-- SQL -->
                <div class="q-sql-block">
                  <div class="q-sql-head">
                    <span class="q-sql-title">Normalized query</span>
                    <span class="q-meta">queryid {{ queryRow(row).queryid }}<template v-if="queryRow(row).user"> · {{ queryRow(row).user }}</template></span>
                    <router-link
                      class="q-copy"
                      :to="{ name: 'integration-page', params: { addon: 'postgresql', page: 'explain' }, query: { server: props.server, q: queryRow(row).sql } }"
                      @click.stop
                    >Explain →</router-link>
                    <button class="q-copy" @click.stop="copySql(queryRow(row).queryid, queryRow(row).sql)">
                      {{ copiedId === queryRow(row).queryid ? '✓ Copied' : 'Copy' }}
                    </button>
                  </div>
                  <pre class="q-sql">{{ queryRow(row).sql }}</pre>
                </div>

                <!-- Trend -->
                <div v-if="trends[queryRow(row).queryid]" class="q-trend">
                  <div class="q-sub-label">Mean latency (ms) · last 6h</div>
                  <TimeseriesWidget :buckets="[]" :series="trends[queryRow(row).queryid]" />
                </div>
              </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
/* Query inspector — the expanded row: recessed panel, stat tiles, copyable SQL, trend. */
.q-panel {
  margin: 4px 0 12px;
  padding: var(--sp-5, 20px);
  background: color-mix(in srgb, var(--amber, #f5a623) 4%, var(--bg-surface, #15181d));
  border: 1px solid var(--border-subtle);
  border-left: 2px solid var(--amber, #f5a623);
  border-radius: var(--r-md, 8px);
  animation: qReveal 0.16s ease-out;
}
@keyframes qReveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.q-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--sp-3, 12px);
  margin-bottom: var(--sp-4, 16px);
}
.q-stat {
  background: var(--bg-hover);
  border-radius: var(--r-sm, 4px);
  padding: 10px 12px;
}
.q-lbl { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.q-val { font-size: 19px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.q-val.small { font-size: 14px; font-family: var(--font-mono, monospace); }
.q-val.accent { color: var(--amber, #f5a623); }
.q-unit { font-size: 12px; color: var(--text-tertiary); margin-left: 3px; font-weight: 400; }

.q-sql-block {
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm, 4px);
  overflow: hidden;
  background: color-mix(in srgb, var(--text-primary, #fff) 3%, transparent);
}
.q-sql-head {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-hover);
}
.q-sql-title { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; }
.q-meta { flex: 1; font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-copy {
  flex-shrink: 0;
  font-size: 11px; padding: 3px 10px;
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-subtle); border-radius: var(--r-sm, 4px);
  cursor: pointer; transition: color 0.12s, border-color 0.12s;
}
.q-copy:hover { color: var(--amber, #f5a623); border-color: var(--amber, #f5a623); }
.q-sql {
  margin: 0; padding: 12px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px; line-height: 1.55;
  color: var(--text-primary);
  white-space: pre-wrap; word-break: break-word;
  max-height: 320px; overflow: auto;
}

.q-trend { margin-top: var(--sp-4, 16px); max-width: 620px; }
.q-sub-label { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; }
</style>
