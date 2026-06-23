<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import TimeseriesWidget from '../../../components/widgets/TimeseriesWidget.vue'
import type { Filter, LogRecord } from '../../../types'

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

interface QueryRow {
  queryid: string
  db: string
  user: string
  mean_ms: number
  calls: number
  rows: number
  blks_hit: number
  blks_read: number
  sql: string
  ts: number
}

const rows = ref<QueryRow[]>([])
const expanded = ref<string | null>(null)
type SortKey = 'mean_ms' | 'calls' | 'rows'
const sortKey = ref<SortKey>('mean_ms')

const sorted = computed(() =>
  [...rows.value].sort((a, b) => b[sortKey.value] - a[sortKey.value]).slice(0, 100),
)

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
        calls: num(a['calls']),
        rows: num(a['rows']),
        blks_hit: num(a['shared_blks_hit']),
        blks_read: num(a['shared_blks_read']),
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
    <table v-else class="pg-table">
      <thead>
        <tr>
          <th>Query</th>
          <th class="num" @click="sortKey = 'mean_ms'">Mean ms{{ sortKey === 'mean_ms' ? ' ▾' : '' }}</th>
          <th class="num" @click="sortKey = 'calls'">Calls{{ sortKey === 'calls' ? ' ▾' : '' }}</th>
          <th class="num" @click="sortKey = 'rows'">Rows{{ sortKey === 'rows' ? ' ▾' : '' }}</th>
          <th class="num">Cache %</th>
          <th>DB</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="r in sorted" :key="r.queryid">
          <tr @click="toggle(r.queryid)">
            <td><code class="pg-sql">{{ r.sql.length > 90 ? r.sql.slice(0, 90) + '…' : r.sql }}</code></td>
            <td class="num">{{ r.mean_ms.toFixed(2) }}</td>
            <td class="num">{{ Math.round(r.calls).toLocaleString() }}</td>
            <td class="num">{{ Math.round(r.rows).toLocaleString() }}</td>
            <td class="num">{{ r.blks_hit + r.blks_read > 0 ? ((r.blks_hit / (r.blks_hit + r.blks_read)) * 100).toFixed(0) + '%' : '—' }}</td>
            <td>{{ r.db }}</td>
          </tr>
          <tr v-if="expanded === r.queryid" class="q-detail-row">
            <td colspan="6">
              <div class="q-panel">
                <!-- Stat tiles (per-interval deltas) -->
                <div class="q-stats">
                  <div class="q-stat">
                    <div class="q-lbl">Mean latency</div>
                    <div class="q-val accent">{{ r.mean_ms.toFixed(2) }}<span class="q-unit">ms</span></div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Calls</div>
                    <div class="q-val">{{ Math.round(r.calls).toLocaleString() }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Rows</div>
                    <div class="q-val">{{ Math.round(r.rows).toLocaleString() }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Cache hit</div>
                    <div class="q-val">{{ cacheHit(r) }}</div>
                  </div>
                  <div class="q-stat">
                    <div class="q-lbl">Blocks hit / read</div>
                    <div class="q-val small">{{ Math.round(r.blks_hit).toLocaleString() }} / {{ Math.round(r.blks_read).toLocaleString() }}</div>
                  </div>
                </div>

                <!-- SQL -->
                <div class="q-sql-block">
                  <div class="q-sql-head">
                    <span class="q-sql-title">Normalized query</span>
                    <span class="q-meta">queryid {{ r.queryid }}<template v-if="r.user"> · {{ r.user }}</template></span>
                    <router-link
                      class="q-copy"
                      :to="{ name: 'integration-page', params: { addon: 'postgresql', page: 'explain' }, query: { server: props.server, q: r.sql } }"
                      @click.stop
                    >Explain →</router-link>
                    <button class="q-copy" @click.stop="copySql(r.queryid, r.sql)">
                      {{ copiedId === r.queryid ? '✓ Copied' : 'Copy' }}
                    </button>
                  </div>
                  <pre class="q-sql">{{ r.sql }}</pre>
                </div>

                <!-- Trend -->
                <div v-if="trends[r.queryid]" class="q-trend">
                  <div class="q-sub-label">Mean latency (ms) · last 6h</div>
                  <TimeseriesWidget :buckets="[]" :series="trends[r.queryid]" />
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Query inspector — the expanded row: recessed panel, stat tiles, copyable SQL, trend. */
.q-detail-row > td { padding: 0; border-bottom: 1px solid var(--border-subtle); }
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
