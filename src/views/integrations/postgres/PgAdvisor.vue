<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Finding extends Record<string, unknown> { id: string; severity: string; check: string; db: string; current: string; evidence: string; recommendation: string; ts: number }
interface Setting extends Record<string, unknown> { setting: string; value: string; unit: string; source: string; context: string; pending: boolean }
const findings = ref<Finding[]>([])
const settings = ref<Setting[]>([])
const findingColumns: DataTableColumn[] = [
  { key: 'severity', label: 'Severity', sortable: true }, { key: 'check', label: 'Check', sortable: true },
  { key: 'db', label: 'Database', sortable: true }, { key: 'current', label: 'Observed', sortable: true },
  { key: 'evidence', label: 'Evidence' }, { key: 'recommendation', label: 'Recommended action' },
]
const settingColumns: DataTableColumn[] = [
  { key: 'setting', label: 'Setting', sortable: true }, { key: 'value', label: 'Current value', sortable: true },
  { key: 'source', label: 'Source', sortable: true }, { key: 'context', label: 'Change context', sortable: true },
  { key: 'pending', label: 'Restart pending', sortable: true },
]

function filters(event: string): Filter[] {
  const out: Filter[] = [{ field: 'log.event', op: '=', value: event }]
  if (props.server) out.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) out.push({ field: 'log.host', op: '=', value: props.host })
  if (props.db) out.push({ field: 'log.db', op: '=', value: props.db })
  return out
}
function severityRank(value: string): number { return value === 'critical' ? 0 : value === 'warning' ? 1 : 2 }
function findingRow(row: Record<string, unknown>): Finding { return row as Finding }
function settingRow(row: Record<string, unknown>): Setting { return row as Setting }

async function load() {
  loading.value = true
  const now = Date.now()
  try {
    const [advisor, setting] = await Promise.all([
      api.queryLogs({ time_range: { from: new Date(now - 24 * 3600_000).toISOString(), to: new Date(now).toISOString() }, filters: filters('postgresql.advisor'), limit: 2000 }),
      api.queryLogs({ time_range: { from: new Date(now - 24 * 3600_000).toISOString(), to: new Date(now).toISOString() }, filters: filters('postgresql.setting'), limit: 2000 }),
    ])
    const latestFindings = new Map<string, LogRecord>()
    for (const row of advisor.rows as LogRecord[]) {
      const a = row.LogAttributes; const key = `${a['check'] || ''}|${a['db'] || ''}`
      if (key !== '|' && !latestFindings.has(key)) latestFindings.set(key, row)
    }
    findings.value = Array.from(latestFindings.values()).map((row) => {
      const a = row.LogAttributes
      return { id: `${a['check'] || ''}|${a['db'] || ''}`, severity: a['severity'] || 'info', check: a['check'] || 'unknown', db: a['db'] || 'cluster', current: a['current'] || '—', evidence: row.Body, recommendation: a['recommendation'] || 'Review the evidence and validate the change before applying it.', ts: row.Timestamp }
    }).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.ts - a.ts)

    const latestSettings = new Map<string, LogRecord>()
    for (const row of setting.rows as LogRecord[]) {
      const name = row.LogAttributes['setting'] || ''
      if (name && !latestSettings.has(name)) latestSettings.set(name, row)
    }
    settings.value = Array.from(latestSettings.values()).map((row) => {
      const a = row.LogAttributes
      return { setting: a['setting'] || '', value: a['value'] || '—', unit: a['unit'] || '', source: a['source'] || '—', context: a['context'] || '—', pending: a['pending_restart'] === 'true' }
    }).sort((a, b) => a.setting.localeCompare(b.setting))
  } finally { loading.value = false }
}

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-advisor">
    <section class="advisor-intro">
      <div><div class="eyebrow">Evidence-based operations</div><h2>Settings and recommendations</h2><p>Recommendations are generated from observed PostgreSQL state. They are guidance only; validate changes against the workload before applying them.</p></div>
      <div class="advisor-meta"><span class="status-mark"></span>{{ findings.length }} active findings</div>
    </section>
    <section class="advisor-section">
      <div class="section-head"><div><h3>What needs attention</h3><p>Latest recommendation per check and database.</p></div></div>
      <p v-if="loading && !findings.length" class="pg-empty">Loading advisor data…</p>
      <p v-else-if="!findings.length" class="pg-empty">No recommendations have been emitted for this target.</p>
      <DataTable v-else :columns="findingColumns" :rows="findings" row-key="id">
        <template #cell-severity="{ row }"><span :class="['severity-label', `severity-${findingRow(row).severity}`]">{{ findingRow(row).severity }}</span></template>
        <template #cell-check="{ row }"><span class="mono">{{ findingRow(row).check }}</span></template>
        <template #cell-current="{ row }"><span class="mono">{{ findingRow(row).current }}</span></template>
      </DataTable>
    </section>
    <section class="advisor-section">
      <div class="section-head"><div><h3>Observed settings</h3><p>Allowlisted settings only. Credential-bearing settings are excluded.</p></div></div>
      <p v-if="loading && !settings.length" class="pg-empty">Loading settings…</p>
      <p v-else-if="!settings.length" class="pg-empty">No settings snapshot is available yet.</p>
      <DataTable v-else :columns="settingColumns" :rows="settings" row-key="setting">
        <template #cell-setting="{ row }"><span class="mono">{{ settingRow(row).setting }}</span></template>
        <template #cell-value="{ row }"><span class="mono">{{ settingRow(row).value }}<small v-if="settingRow(row).unit"> {{ settingRow(row).unit }}</small></span></template>
        <template #cell-pending="{ row }"><span :class="settingRow(row).pending ? 'pending' : 'settled'">{{ settingRow(row).pending ? 'Required' : 'Applied' }}</span></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.pg-advisor { display: grid; gap: 22px; }
.advisor-intro { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.advisor-intro p, .section-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.advisor-meta { display: flex; align-items: center; gap: 8px; align-self: flex-start; color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.status-mark { width: 7px; height: 7px; border-radius: 50%; background: var(--amber, #f59e0b); }
.advisor-section { min-width: 0; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 10px; }
h3 { margin: 0 0 3px; font-size: 15px; }
.severity-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.severity-critical { color: var(--error, #ef4444); }
.severity-warning { color: var(--amber, #f59e0b); }
.severity-info { color: var(--text-tertiary); }
.mono { font-family: var(--font-mono, monospace); font-size: 11px; }
.mono small { color: var(--text-tertiary); }
.pending { color: var(--amber, #f59e0b); font-size: 12px; }
.settled { color: var(--ok, #22c55e); font-size: 12px; }
@media (max-width: 760px) { .advisor-intro { display: block; } .advisor-meta { margin-top: 16px; } }
</style>
