<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface IdxRow extends Record<string, unknown> { schema: string; table: string; index: string; scans: number; size: number }
interface TblRow extends Record<string, unknown> { schema: string; table: string; seq: number; idx: number; live: number; size: number }

const indexes = ref<IdxRow[]>([])
const tables = ref<TblRow[]>([])
const unusedColumns: DataTableColumn[] = [
  { key: 'index', label: 'Index', sortable: true },
  { key: 'table', label: 'Table', sortable: true },
  { key: 'size', label: 'Size', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'suggestion', label: 'Suggestion' },
]
const seqColumns: DataTableColumn[] = [
  { key: 'table', label: 'Table', sortable: true },
  { key: 'seq', label: 'Seq scans', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'idx', label: 'Index scans', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'live', label: 'Live rows', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'size', label: 'Size', align: 'right', sortable: true, cellClass: 'num' },
]

function sel(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  if (props.db) p.push(`db="${props.db}"`)
  return p.length ? `{${p.join(',')}}` : ''
}

// metric → map keyed by `${schema}|${table}|${index?}` → value
async function fetchMap(metric: string, keyLabels: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  try {
    const r: PromVectorResponse = await api.promQuery(`${metric}${sel()}`)
    for (const s of r.result) {
      const key = keyLabels.map((l) => s.metric[l] ?? '').join('|')
      out[key] = parseFloat(s.value?.[1] ?? '0') || 0
    }
  } catch { /* ignore */ }
  return out
}

async function load() {
  loading.value = true
  const idxKey = ['schema', 'table', 'index']
  const tblKey = ['schema', 'table']
  const [idxScans, idxSize, seq, idxScansT, live, tblSize] = await Promise.all([
    fetchMap('postgresql_index_scans', idxKey),
    fetchMap('postgresql_index_size', idxKey),
    fetchMap('postgresql_table_seq_scans', tblKey),
    fetchMap('postgresql_table_idx_scans', tblKey),
    fetchMap('postgresql_table_live_rows', tblKey),
    fetchMap('postgresql_table_size', tblKey),
  ])

  indexes.value = Object.keys({ ...idxScans, ...idxSize }).map((k) => {
    const [schema = '', table = '', index = ''] = k.split('|')
    return { schema, table, index, scans: idxScans[k] ?? 0, size: idxSize[k] ?? 0 }
  })

  tables.value = Object.keys({ ...seq, ...idxScansT }).map((k) => {
    const [schema = '', table = ''] = k.split('|')
    return { schema, table, seq: seq[k] ?? 0, idx: idxScansT[k] ?? 0, live: live[k] ?? 0, size: tblSize[k] ?? 0 }
  })
  loading.value = false
}

function cmp(a: number | string, b: number | string, dir: number): number {
  return typeof a === 'string' && typeof b === 'string'
    ? a.localeCompare(b) * dir
    : ((a as number) - (b as number)) * dir
}

// ── Unused-index table sort ──
type USort = 'index' | 'table' | 'size'
const uKey = ref<USort>('size')
const uDir = ref<'asc' | 'desc'>('desc')
function uSort(k: USort) {
  if (uKey.value === k) uDir.value = uDir.value === 'desc' ? 'asc' : 'desc'
  else { uKey.value = k; uDir.value = k === 'size' ? 'desc' : 'asc' }
}
// Unused = never scanned. Exclude *_pkey (back a constraint; must not be dropped).
const unused = computed(() => {
  const dir = uDir.value === 'desc' ? -1 : 1
  return indexes.value
    .filter((i) => i.scans === 0 && i.size > 0 && !/_pkey$/.test(i.index))
    .sort((a, b) => {
      const k = uKey.value
      const av = k === 'size' ? a.size : k === 'index' ? a.index : `${a.schema}.${a.table}`
      const bv = k === 'size' ? b.size : k === 'index' ? b.index : `${b.schema}.${b.table}`
      return cmp(av, bv, dir)
    })
})

// ── Seq-scan table sort ──
type SSort = 'table' | 'seq' | 'idx' | 'live' | 'size'
const sKey = ref<SSort>('seq')
const sDir = ref<'asc' | 'desc'>('desc')
function sSort(k: SSort) {
  if (sKey.value === k) sDir.value = sDir.value === 'desc' ? 'asc' : 'desc'
  else { sKey.value = k; sDir.value = k === 'table' ? 'asc' : 'desc' }
}
// Missing-index candidates: meaningful tables read mostly via sequential scans.
const seqHeavy = computed(() => {
  const dir = sDir.value === 'desc' ? -1 : 1
  return tables.value
    .filter((t) => t.seq > 50 && t.live > 1000 && t.seq > t.idx)
    .sort((a, b) => {
      const k = sKey.value
      const av = k === 'table' ? `${a.schema}.${a.table}` : a[k]
      const bv = k === 'table' ? `${b.schema}.${b.table}` : b[k]
      return cmp(av, bv, dir)
    })
    .slice(0, 25)
})

function indexRow(row: Record<string, unknown>): IdxRow { return row as IdxRow }
function tableRow(row: Record<string, unknown>): TblRow { return row as TblRow }
function unusedRowKey(row: Record<string, unknown>): string {
  const r = indexRow(row)
  return r.schema + r.table + r.index
}
function seqRowKey(row: Record<string, unknown>): string {
  const r = tableRow(row)
  return r.schema + r.table
}
function onUnusedSort(key: string) {
  if (key === 'index' || key === 'table' || key === 'size') uSort(key)
}
function onSeqSort(key: string) {
  if (key === 'table' || key === 'seq' || key === 'idx' || key === 'live' || key === 'size') sSort(key)
}

function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
const fmt = (n: number) => Math.round(n).toLocaleString()

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <p class="pg-loading" v-if="loading && !indexes.length && !tables.length">Loading…</p>

    <h3 style="margin:0 0 8px">Unused indexes</h3>
    <p class="sub" style="color:var(--text-tertiary);font-size:12px;margin:0 0 12px">
      No scans since statistics were last reset. Treat these as review candidates only; confirm
      constraint dependencies, workload seasonality, and an adequate observation window before removal.
    </p>
    <p class="pg-empty" v-if="!unused.length && !loading">No indexes currently need review.</p>
    <DataTable
      v-else-if="unused.length"
      class="index-review-table"
      :columns="unusedColumns"
      :rows="unused"
      :row-key="unusedRowKey"
      :sort-key="uKey"
      :sort-direction="uDir"
      @sort="onUnusedSort"
    >
      <template #cell-index="{ row }"><code>{{ indexRow(row).index }}</code></template>
      <template #cell-table="{ row }">{{ indexRow(row).schema }}.{{ indexRow(row).table }}</template>
      <template #cell-size="{ row }">{{ fmtBytes(indexRow(row).size) }}</template>
      <template #cell-suggestion><span class="review-note">Review usage history before changing</span></template>
    </DataTable>

    <h3 style="margin:0 0 8px">Tables with heavy sequential scans</h3>
    <p class="sub" style="color:var(--text-tertiary);font-size:12px;margin:0 0 12px">
      Larger tables read mostly via sequential scans — candidates for a new index (check the
      Queries tab for the predicates being filtered).
    </p>
    <p class="pg-empty" v-if="!seqHeavy.length && !loading">No sequential-scan-heavy tables.</p>
    <DataTable
      v-else-if="seqHeavy.length"
      :columns="seqColumns"
      :rows="seqHeavy"
      :row-key="seqRowKey"
      :sort-key="sKey"
      :sort-direction="sDir"
      @sort="onSeqSort"
    >
      <template #cell-table="{ row }">{{ tableRow(row).schema }}.<strong>{{ tableRow(row).table }}</strong></template>
      <template #cell-seq="{ row }">{{ fmt(tableRow(row).seq) }}</template>
      <template #cell-idx="{ row }">{{ fmt(tableRow(row).idx) }}</template>
      <template #cell-live="{ row }">{{ fmt(tableRow(row).live) }}</template>
      <template #cell-size="{ row }">{{ fmtBytes(tableRow(row).size) }}</template>
    </DataTable>
  </div>
</template>

<style scoped>
.index-review-table { margin-bottom: 28px; }
.review-note { color: var(--text-tertiary); font-size: 12px; }
</style>
