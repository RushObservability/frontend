<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)
interface Signal extends Record<string, unknown> { label: string; value: string; detail: string }
const signals = ref<Signal[]>([])
const columns: DataTableColumn[] = [
  { key: 'label', label: 'Signal' },
  { key: 'value', label: 'Current', sortable: true },
  { key: 'detail', label: 'Context' },
]
function selector(): string {
  const p: string[] = []
  if (props.server) p.push('service_name="' + props.server + '"')
  if (props.host) p.push('host="' + props.host + '"')
  return p.length ? '{' + p.join(',') + '}' : ''
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
function bytes(value: number): string {
  if (!isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = value
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i]
}
function age(value: number): string {
  if (!isFinite(value)) return '—'
  if (value < 60) return Math.round(value) + 's'
  if (value < 3600) return Math.round(value / 60) + 'm'
  return (value / 3600).toFixed(1) + 'h'
}
async function scalar(metric: string): Promise<number> {
  try { const r = await api.promQuery(metric + selector()); return r.result.reduce((sum, item) => sum + n(item.value?.[1]), 0) } catch { return NaN }
}
async function load() {
  loading.value = true
  const [recovery, receive, replay, replayAge, backups, backupRatio, archiveFailed, archiveAge, prefetch, prefetchHits, prefetchSkips, slruFlushes] = await Promise.all([
    scalar('postgresql_recovery'),
    scalar('postgresql_recovery_receive_lsn'),
    scalar('postgresql_recovery_replay_lsn'),
    scalar('postgresql_recovery_replay_age'),
    scalar('postgresql_basebackup_workers'),
    scalar('postgresql_basebackup_progress_ratio'),
    scalar('postgresql_archiver_failed_total'),
    scalar('postgresql_archiver_last_success_age'),
    scalar('postgresql_recovery_prefetch'),
    scalar('postgresql_recovery_prefetch_hits'),
    scalar('postgresql_recovery_prefetch_skip_init'),
    scalar('postgresql_slru_flushes'),
  ])
  signals.value = [
    { label: 'Instance mode', value: recovery > 0 ? 'standby / recovery' : 'primary / writable', detail: 'Derived from pg_is_in_recovery().' },
    { label: 'Receive LSN', value: bytes(receive), detail: 'Cumulative LSN position when the instance is receiving WAL.' },
    { label: 'Replay LSN', value: bytes(replay), detail: 'Cumulative replay position for recovery diagnostics.' },
    { label: 'Replay freshness', value: recovery > 0 ? age(replayAge) : 'not applicable', detail: recovery > 0 ? 'Age of the last replayed transaction.' : 'Primary instances do not expose replay age.' },
    { label: 'Active base backups', value: isFinite(backups) ? Math.round(backups).toString() : '—', detail: isFinite(backupRatio) && backups > 0 ? Math.round(backupRatio * 100) + '% streamed' : 'No base backup progress is active.' },
    { label: 'Archived WAL failures', value: isFinite(archiveFailed) ? Math.round(archiveFailed).toLocaleString() : '—', detail: 'Cumulative pg_stat_archiver failure count.' },
    { label: 'Last successful archive', value: age(archiveAge), detail: 'Freshness of the last WAL archived by PostgreSQL.' },
    { label: 'Recovery prefetch', value: isFinite(prefetch) ? Math.round(prefetch).toLocaleString() : '—', detail: isFinite(prefetchHits) ? Math.round(prefetchHits).toLocaleString() + ' cache hits · ' + Math.round(prefetchSkips).toLocaleString() + ' init skips.' : 'Available on PostgreSQL 18 recovery instances.' },
    { label: 'SLRU flushes', value: isFinite(slruFlushes) ? Math.round(slruFlushes).toLocaleString() : '—', detail: 'Cumulative internal SLRU flush activity; interpret with wraparound and transaction-age signals.' },
  ]
  loading.value = false
}
onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-recovery">
    <section class="recovery-head"><div><div class="eyebrow">Durability and recoverability</div><h2>Recovery and backups</h2><p>Separate PostgreSQL’s built-in recovery signals from external backup freshness. The collector never assumes that WAL archiving alone proves a restorable backup.</p></div><div class="recovery-note">External pgBackRest/Barman status is not yet connected.</div></section>
    <DataTable :columns="columns" :rows="signals" row-key="label" :loading="loading && !signals.length"><template #cell-value="{ row }"><span class="mono">{{ row.value }}</span></template></DataTable>
    <section class="next-step"><span class="eyebrow">Operational next step</span><strong>Pair archive freshness with a scheduled restore test.</strong><p>WAL archive success is necessary for point-in-time recovery, but it does not prove that a recent base backup and complete WAL chain can be restored.</p></section>
  </div>
</template>

<style scoped>
.pg-recovery { display: grid; gap: 22px; }
.recovery-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.recovery-head p, .next-step p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.recovery-note { max-width: 280px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.mono { font-family: var(--font-mono, monospace); font-size: 11px; }
.next-step { display: grid; gap: 7px; padding: 18px 20px; border: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--blue, #3b82f6) 5%, var(--bg-surface)); border-radius: var(--r-md, 8px); }
.next-step strong { color: var(--text-primary); font-size: 14px; }
@media (max-width: 760px) { .recovery-head { display: block; } .recovery-note { margin-top: 16px; max-width: none; } }
</style>
