<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string }>()
const api = useApi()
const loading = ref(false)

interface Replica extends Record<string, unknown> { replica: string; state: string; sync: string; writeBytes: number; flushBytes: number; replayBytes: number; write: number; flush: number; replay: number }
interface Slot extends Record<string, unknown> { slot: string; active: number; lag: number; safe: number; status: string }
const replicas = ref<Replica[]>([])
const slots = ref<Slot[]>([])
const archiver = ref({ failed: NaN, successAge: NaN, failureAge: NaN })
const replicaColumns: DataTableColumn[] = [
  { key: 'replica', label: 'Standby', sortable: true }, { key: 'state', label: 'State', sortable: true },
  { key: 'sync', label: 'Sync mode', sortable: true }, { key: 'writeBytes', label: 'Write lag', sortable: true, align: 'right', cellClass: 'num' },
  { key: 'flushBytes', label: 'Flush lag', sortable: true, align: 'right', cellClass: 'num' }, { key: 'replayBytes', label: 'Replay lag', sortable: true, align: 'right', cellClass: 'num' },
]
const slotColumns: DataTableColumn[] = [
  { key: 'slot', label: 'Slot', sortable: true }, { key: 'status', label: 'WAL status', sortable: true },
  { key: 'active', label: 'Active', sortable: true }, { key: 'lag', label: 'Retained WAL', sortable: true, align: 'right', cellClass: 'num' },
  { key: 'safe', label: 'Safe WAL remaining', sortable: true, align: 'right', cellClass: 'num' },
]
function selector(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  return p.length ? `{${p.join(',')}}` : ''
}
async function vector(metric: string): Promise<PromVectorResponse['result']> {
  try { return (await api.promQuery(`${metric}${selector()}`)).result } catch { return [] }
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
function fmtBytes(value: number): string {
  if (!isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = value
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
function fmtAge(value: number): string { return !isFinite(value) ? '—' : value < 60 ? `${Math.round(value)}s` : `${Math.round(value / 60)}m` }
function replicaRow(row: Record<string, unknown>): Replica { return row as Replica }
function slotRow(row: Record<string, unknown>): Slot { return row as Slot }

async function load() {
  loading.value = true
  const [replayBytes, writeBytes, flushBytes, write, flush, replay, state, slotLag, slotActive, slotSafe, slotStatus, failed, successAge, failureAge] = await Promise.all([
    vector('postgresql_replication_replay_lag_bytes'), vector('postgresql_replication_write_lag_bytes'), vector('postgresql_replication_flush_lag_bytes'),
    vector('postgresql_replication_write_lag'), vector('postgresql_replication_flush_lag'), vector('postgresql_replication_replay_lag'), vector('postgresql_replication_state'),
    vector('postgresql_replication_slot_lag'), vector('postgresql_replication_slot_active'), vector('postgresql_replication_slot_safe_wal_bytes'), vector('postgresql_replication_slot_status'),
    vector('postgresql_archiver_failed_total'), vector('postgresql_archiver_last_success_age'), vector('postgresql_archiver_last_failure_age'),
  ])
  const replicaMap = new Map<string, Replica>()
  const ensure = (name: string) => {
    const current = replicaMap.get(name) || { replica: name || 'unnamed', state: '—', sync: '—', writeBytes: 0, flushBytes: 0, replayBytes: 0, write: 0, flush: 0, replay: 0 }
    replicaMap.set(name, current); return current
  }
  for (const item of replayBytes) ensure(item.metric.replica || '').replayBytes = n(item.value?.[1])
  for (const item of writeBytes) ensure(item.metric.replica || '').writeBytes = n(item.value?.[1])
  for (const item of flushBytes) ensure(item.metric.replica || '').flushBytes = n(item.value?.[1])
  for (const item of write) ensure(item.metric.replica || '').write = n(item.value?.[1])
  for (const item of flush) ensure(item.metric.replica || '').flush = n(item.value?.[1])
  for (const item of replay) ensure(item.metric.replica || '').replay = n(item.value?.[1])
  for (const item of state) { const row = ensure(item.metric.replica || ''); row.state = item.metric.state || '—'; row.sync = item.metric.sync_state || '—' }
  replicas.value = Array.from(replicaMap.values()).sort((a, b) => b.replayBytes - a.replayBytes)

  const slotMap = new Map<string, Slot>()
  const ensureSlot = (name: string) => { const row = slotMap.get(name) || { slot: name, active: 0, lag: 0, safe: 0, status: '—' }; slotMap.set(name, row); return row }
  for (const item of slotLag) ensureSlot(item.metric.slot || '').lag = n(item.value?.[1])
  for (const item of slotActive) ensureSlot(item.metric.slot || '').active = n(item.value?.[1])
  for (const item of slotSafe) ensureSlot(item.metric.slot || '').safe = n(item.value?.[1])
  for (const item of slotStatus) ensureSlot(item.metric.slot || '').status = item.metric.wal_status || '—'
  slots.value = Array.from(slotMap.values()).sort((a, b) => b.lag - a.lag)
  archiver.value = { failed: failed.length ? n(failed[0]?.value?.[1]) : NaN, successAge: successAge.length ? n(successAge[0]?.value?.[1]) : NaN, failureAge: failureAge.length ? n(failureAge[0]?.value?.[1]) : NaN }
  loading.value = false
}

const lagging = computed(() => replicas.value.filter((r) => r.replayBytes >= 64 * 1024 * 1024).length)
onMounted(load)
watch(() => [props.server, props.host], load)
</script>

<template>
  <div class="pg-replication">
    <section class="replication-head"><div><div class="eyebrow">Topology and durability</div><h2>Replication health</h2><p>Write, flush, and replay stages are shown separately so lag can be tied to the failing part of the pipeline.</p></div><div class="replication-summary"><strong>{{ replicas.length }}</strong><span>standbys</span><strong :class="{ warn: lagging }">{{ lagging }}</strong><span>lagging</span></div></section>
    <section class="replication-section"><div class="section-head"><div><h3>Standbys</h3><p>PostgreSQL reports these lag values for directly connected replicas.</p></div></div><p v-if="loading && !replicas.length" class="pg-empty">Loading replication…</p><p v-else-if="!replicas.length" class="pg-empty">No directly connected standbys are reporting.</p><DataTable v-else :columns="replicaColumns" :rows="replicas" row-key="replica"><template #cell-writeBytes="{ row }">{{ fmtBytes(replicaRow(row).writeBytes) }}<small v-if="replicaRow(row).write"> · {{ fmtAge(replicaRow(row).write) }}</small></template><template #cell-flushBytes="{ row }">{{ fmtBytes(replicaRow(row).flushBytes) }}<small v-if="replicaRow(row).flush"> · {{ fmtAge(replicaRow(row).flush) }}</small></template><template #cell-replayBytes="{ row }">{{ fmtBytes(replicaRow(row).replayBytes) }}<small v-if="replicaRow(row).replay"> · {{ fmtAge(replicaRow(row).replay) }}</small></template></DataTable></section>
    <section class="replication-section"><div class="section-head"><div><h3>Replication slots</h3><p>Retained WAL can consume storage even when no standby is connected.</p></div></div><p v-if="!slots.length" class="pg-empty">No replication slots are reporting.</p><DataTable v-else :columns="slotColumns" :rows="slots" row-key="slot"><template #cell-active="{ row }">{{ slotRow(row).active ? 'Yes' : 'No' }}</template><template #cell-lag="{ row }">{{ fmtBytes(slotRow(row).lag) }}</template><template #cell-safe="{ row }">{{ fmtBytes(slotRow(row).safe) }}</template></DataTable></section>
    <section class="archiver-strip"><div><span class="label">WAL archiver failures</span><strong>{{ isFinite(archiver.failed) ? Math.round(archiver.failed).toLocaleString() : '—' }}</strong></div><div><span class="label">Last successful archive</span><strong>{{ fmtAge(archiver.successAge) }} ago</strong></div><div><span class="label">Last failed archive</span><strong>{{ fmtAge(archiver.failureAge) }} ago</strong></div></section>
  </div>
</template>

<style scoped>
.pg-replication { display: grid; gap: 22px; }
.replication-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.replication-head p, .section-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.replication-summary { display: grid; grid-template-columns: auto auto; align-content: start; column-gap: 8px; color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
.replication-summary strong { color: var(--text-primary); font: 600 22px var(--font-mono, monospace); text-align: right; }
.replication-summary strong.warn { color: var(--amber, #f59e0b); }
.replication-section { min-width: 0; }
.section-head { margin-bottom: 10px; }
h3 { margin: 0 0 3px; font-size: 15px; }
.num, small { font-family: var(--font-mono, monospace); font-size: 11px; }
small { color: var(--text-tertiary); }
.archiver-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; border: 1px solid var(--border-subtle); background: var(--border-subtle); }
.archiver-strip > div { display: grid; gap: 5px; padding: 16px; background: var(--bg-surface); }
.label { color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.archiver-strip strong { color: var(--text-primary); font: 600 16px var(--font-mono, monospace); }
@media (max-width: 760px) { .replication-head { display: block; } .replication-summary { margin-top: 16px; } .archiver-strip { grid-template-columns: 1fr; } }
</style>
