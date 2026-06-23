<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord, PromVectorResponse } from '../../../types'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Col { name: string; type: string; nullable: boolean }
interface Idx { name: string; def: string }
interface TableRow {
  host: string
  db: string
  schema: string
  table: string
  size_bytes: number
  columns: Col[]
  indexes: Idx[]
  live: number
  dead: number
}
const rows = ref<TableRow[]>([])
const expanded = ref<string | null>(null)

type SortKey = 'table' | 'size' | 'columns' | 'indexes' | 'live' | 'dead'
const sortKey = ref<SortKey>('size')
const sortDir = ref<'asc' | 'desc'>('desc')

function deadRatio(r: TableRow): number {
  const total = r.live + r.dead
  return isFinite(total) && total > 0 ? r.dead / total : -1
}
function sortVal(r: TableRow, k: SortKey): number | string {
  switch (k) {
    case 'table': return `${r.schema}.${r.table}`
    case 'size': return r.size_bytes
    case 'columns': return r.columns.length
    case 'indexes': return r.indexes.length
    case 'live': return isFinite(r.live) ? r.live : -1
    case 'dead': return deadRatio(r)
  }
}
function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else { sortKey.value = k; sortDir.value = k === 'table' ? 'asc' : 'desc' }
}
function arrow(k: SortKey): string {
  return sortKey.value === k ? (sortDir.value === 'desc' ? ' ▾' : ' ▴') : ''
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

function labels(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  if (props.db) p.push(`db="${props.db}"`)
  return p.length ? `{${p.join(',')}}` : ''
}

// metric series → { "db|schema|table": value } (db-qualified to avoid cross-DB collisions)
async function metricByTable(metric: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  try {
    const r: PromVectorResponse = await api.promQuery(`${metric}${labels()}`)
    for (const s of r.result) {
      const k = `${s.metric.host || ''}|${s.metric.db || ''}|${s.metric.schema}|${s.metric.table}`
      out[k] = (out[k] || 0) + (parseFloat(s.value?.[1] ?? '0') || 0)
    }
  } catch { /* ignore */ }
  return out
}

function parseJson<T>(s: string | undefined): T[] {
  if (!s) return []
  try { return JSON.parse(s) as T[] } catch { return [] }
}

async function load() {
  loading.value = true
  rows.value = []
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.schema.table' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
  if (props.db) filters.push({ field: 'log.db', op: '=', value: props.db })
  const now = Date.now()
  try {
    const [res, live, dead] = await Promise.all([
      api.queryLogs({
        time_range: { from: new Date(now - 3600_000).toISOString(), to: new Date(now).toISOString() },
        filters,
        limit: 2000,
      }),
      metricByTable('postgresql_table_live_rows'),
      metricByTable('postgresql_table_dead_rows'),
    ])
    const latest = new Map<string, LogRecord>()
    for (const r of res.rows) {
      const a = r.LogAttributes
      const k = `${a['host'] || ''}|${a['db'] || ''}|${a['schema']}|${a['table']}`
      if (!latest.has(k)) latest.set(k, r) // newest first
    }
    rows.value = Array.from(latest.values()).map((r) => {
      const a = r.LogAttributes
      const key = `${a['host'] || ''}|${a['db'] || ''}|${a['schema']}|${a['table']}`
      return {
        host: a['host'] || '',
        db: a['db'] || '',
        schema: a['schema'] || '',
        table: a['table'] || '',
        size_bytes: parseFloat(a['size_bytes'] ?? '0') || 0,
        columns: parseJson<Col>(a['columns']),
        indexes: parseJson<Idx>(a['indexes']),
        live: live[key] ?? NaN,
        dead: dead[key] ?? NaN,
      }
    })
  } catch { /* empty state */ }
  loading.value = false
}

function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
function deadPct(r: TableRow): string {
  const total = r.live + r.dead
  if (!isFinite(total) || total <= 0) return '—'
  return `${((r.dead / total) * 100).toFixed(1)}%`
}
function toggle(k: string) { expanded.value = expanded.value === k ? null : k }
const keyOf = (r: TableRow) => `${r.host}.${r.db}.${r.schema}.${r.table}`

// ── Schema-inspector parsing (for the expanded detail) ──
interface ParsedIndex { name: string; primary: boolean; unique: boolean; method: string; cols: string[] }
function indexCols(def: string): string[] {
  const m = def.match(/\((.*)\)/) // outermost parens (handles expression indexes)
  if (!m) return []
  return m[1]!
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0]!.replace(/[()"]/g, ''))
    .filter(Boolean)
}
function parseIndex(ix: Idx): ParsedIndex {
  const def = ix.def || ''
  const primary = /_pkey$/.test(ix.name)
  return {
    name: ix.name,
    primary,
    unique: primary || /UNIQUE INDEX/i.test(def),
    method: (def.match(/USING (\w+)/i)?.[1] || '').toLowerCase(),
    cols: indexCols(def),
  }
}
function pkSet(r: TableRow): Set<string> {
  const pk = r.indexes.find((ix) => /_pkey$/.test(ix.name))
  return new Set(pk ? indexCols(pk.def || '') : [])
}

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <p class="pg-empty" v-if="loading && !rows.length">Loading schema…</p>
    <p class="pg-empty" v-else-if="!rows.length">
      No schema snapshot yet. The collector emits one every
      <code>COLLECTOR_SCHEMA_INTERVAL_SECS</code> (default 600s).
    </p>
    <table v-else class="pg-table">
      <thead>
        <tr>
          <th v-if="!props.db">Host</th>
          <th v-if="!props.db">DB</th>
          <th @click="setSort('table')">Table{{ arrow('table') }}</th>
          <th class="num" @click="setSort('size')">Size{{ arrow('size') }}</th>
          <th class="num" @click="setSort('columns')">Columns{{ arrow('columns') }}</th>
          <th class="num" @click="setSort('indexes')">Indexes{{ arrow('indexes') }}</th>
          <th class="num" @click="setSort('live')">Live rows{{ arrow('live') }}</th>
          <th class="num" @click="setSort('dead')">Dead %{{ arrow('dead') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="r in sorted" :key="keyOf(r)">
          <tr @click="toggle(keyOf(r))">
            <td v-if="!props.db" class="db-cell">{{ r.host }}</td>
            <td v-if="!props.db" class="db-cell">{{ r.db }}</td>
            <td>{{ r.schema }}.<strong>{{ r.table }}</strong></td>
            <td class="num">{{ fmtBytes(r.size_bytes) }}</td>
            <td class="num">{{ r.columns.length }}</td>
            <td class="num">{{ r.indexes.length }}</td>
            <td class="num">{{ isFinite(r.live) ? Math.round(r.live).toLocaleString() : '—' }}</td>
            <td class="num">{{ deadPct(r) }}</td>
          </tr>
          <tr v-if="expanded === keyOf(r)" class="schema-row">
            <td :colspan="props.db ? 6 : 8">
              <div class="schema-panel">
                <!-- Columns -->
                <section class="schema-section">
                  <header class="schema-head">
                    <span class="sh-title">Columns</span>
                    <span class="sh-count">{{ r.columns.length }}</span>
                  </header>
                  <ul class="col-list">
                    <li v-for="c in r.columns" :key="c.name" class="col-item">
                      <span class="col-name">{{ c.name }}</span>
                      <span class="col-meta">
                        <span class="col-type">{{ c.type }}</span>
                        <span v-if="pkSet(r).has(c.name)" class="tag tag-pk">PK</span>
                        <span v-if="!c.nullable" class="tag tag-notnull">NOT NULL</span>
                      </span>
                    </li>
                  </ul>
                </section>

                <!-- Indexes -->
                <section class="schema-section">
                  <header class="schema-head">
                    <span class="sh-title">Indexes</span>
                    <span class="sh-count">{{ r.indexes.length }}</span>
                  </header>
                  <div v-if="!r.indexes.length" class="idx-empty">No indexes</div>
                  <ul v-else class="idx-list">
                    <li v-for="ix in r.indexes.map(parseIndex)" :key="ix.name" class="idx-item">
                      <div class="idx-top">
                        <span class="idx-name">{{ ix.name }}</span>
                        <span v-if="ix.primary" class="tag tag-pk">PRIMARY</span>
                        <span v-else-if="ix.unique" class="tag tag-uniq">UNIQUE</span>
                        <span v-if="ix.method" class="tag tag-method">{{ ix.method }}</span>
                      </div>
                      <div v-if="ix.cols.length" class="idx-cols">
                        <span v-for="c in ix.cols" :key="c" class="idx-colchip">{{ c }}</span>
                      </div>
                    </li>
                  </ul>
                </section>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Schema inspector — the expanded table detail. A recessed blueprint panel:
   monospace identifiers, type as the amber accent, structural tags, reveal animation. */
.schema-row > td {
  padding: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.db-cell { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-tertiary); }
.schema-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: var(--sp-6, 24px);
  padding: var(--sp-5, 20px);
  margin: 4px 0 12px;
  background: color-mix(in srgb, var(--amber, #f5a623) 4%, var(--bg-surface, #15181d));
  border: 1px solid var(--border-subtle, #2a2e35);
  border-left: 2px solid var(--amber, #f5a623);
  border-radius: var(--r-md, 8px);
  animation: schemaReveal 0.16s ease-out;
}
@keyframes schemaReveal {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

.schema-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}
.sh-title {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--text-tertiary);
}
.sh-count {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-hover);
  border-radius: 999px;
  padding: 1px 8px;
  font-variant-numeric: tabular-nums;
}

/* Columns */
.col-list { list-style: none; margin: 0; padding: 0; }
.col-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 8px;
  border-radius: var(--r-sm, 4px);
}
.col-item:hover { background: var(--bg-hover); }
.col-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.col-type {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: color-mix(in srgb, var(--amber, #f5a623) 80%, var(--text-secondary));
  white-space: nowrap;
}

/* Indexes */
.idx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.idx-item {
  padding: 8px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm, 4px);
}
.idx-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.idx-name {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-primary);
}
.idx-cols { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.idx-colchip {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-primary, #fff) 7%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
}
.idx-empty { font-size: 12px; color: var(--text-tertiary); padding: 2px; }

/* Tags */
.tag {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
}
.tag-pk { color: var(--amber, #f5a623); background: color-mix(in srgb, var(--amber, #f5a623) 16%, transparent); }
.tag-uniq { color: var(--ok, #22c55e); background: color-mix(in srgb, var(--ok, #22c55e) 15%, transparent); }
.tag-method { color: var(--text-tertiary); border: 1px solid var(--border-subtle); }
.tag-notnull { color: var(--text-tertiary); border: 1px solid var(--border-subtle); }

@media (max-width: 720px) {
  .schema-panel { grid-template-columns: 1fr; }
}
</style>
