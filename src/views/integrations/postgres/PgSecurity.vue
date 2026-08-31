<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)
interface Finding extends Record<string, unknown> { id: string; severity: string; check: string; current: string; recommendation: string }
interface Posture extends Record<string, unknown> { label: string; value: string; detail: string }
const findings = ref<Finding[]>([])
const posture = ref<Posture[]>([])
const findingColumns: DataTableColumn[] = [
  { key: 'severity', label: 'Severity', sortable: true },
  { key: 'check', label: 'Check', sortable: true },
  { key: 'current', label: 'Observed', sortable: true },
  { key: 'recommendation', label: 'Recommended action' },
]
const postureColumns: DataTableColumn[] = [
  { key: 'label', label: 'Signal' },
  { key: 'value', label: 'Current', sortable: true },
  { key: 'detail', label: 'Interpretation' },
]
function selector(): string {
  const p: string[] = []
  if (props.server) p.push('service_name="' + props.server + '"')
  if (props.host) p.push('host="' + props.host + '"')
  return p.length ? '{' + p.join(',') + '}' : ''
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
async function scalar(metric: string): Promise<number> {
  try { const r = await api.promQuery(metric + selector()); return r.result.reduce((sum, item) => sum + n(item.value?.[1]), 0) } catch { return NaN }
}
function fmt(value: number): string { return isFinite(value) ? Math.round(value).toLocaleString() : '—' }
async function load() {
  loading.value = true
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.advisor' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
  const now = Date.now()
  try {
    const [logs, hba, trust, hbaErrors, configErrors, roles, loginRoles, superusers, expiring, ssl, clear] = await Promise.all([
      api.queryLogs({ time_range: { from: new Date(now - 24 * 3600_000).toISOString(), to: new Date(now).toISOString() }, filters, limit: 2000 }),
      scalar('postgresql_hba_rules'),
      scalar('postgresql_hba_trust_rules'),
      scalar('postgresql_hba_rule_errors'),
      scalar('postgresql_configuration_errors'),
      scalar('postgresql_roles'),
      scalar('postgresql_login_roles'),
      scalar('postgresql_superuser_roles'),
      scalar('postgresql_expiring_roles'),
      scalar('postgresql_ssl_connections'),
      scalar('postgresql_cleartext_connections'),
    ])
    const latest = new Map<string, LogRecord>()
    for (const item of logs.rows as LogRecord[]) {
      const check = item.LogAttributes.check || ''
      if (check && !latest.has(check)) latest.set(check, item)
    }
    findings.value = Array.from(latest.values()).map((item) => {
      const a = item.LogAttributes
      return { id: a.check || item.Body, severity: a.severity || 'info', check: a.check || 'finding', current: a.current || '—', recommendation: a.recommendation || 'Review the evidence and validate the change.' }
    }).sort((a, b) => (a.severity === 'critical' ? 0 : a.severity === 'warning' ? 1 : 2) - (b.severity === 'critical' ? 0 : b.severity === 'warning' ? 1 : 2))
    posture.value = [
      { label: 'pg_hba rules', value: fmt(hba), detail: 'Loaded access rules visible to the monitoring role.' },
      { label: 'trust rules', value: fmt(trust), detail: trust > 0 ? 'Review authentication scope.' : 'No trust rules detected.' },
      { label: 'HBA errors', value: fmt(hbaErrors), detail: hbaErrors > 0 ? 'Some access rules were not applied.' : 'No rule errors reported.' },
      { label: 'Config errors', value: fmt(configErrors), detail: configErrors > 0 ? 'Some configuration entries were not applied.' : 'No file setting errors reported.' },
      { label: 'Roles', value: fmt(roles), detail: fmt(loginRoles) + ' login roles · ' + fmt(superusers) + ' superuser roles · ' + fmt(expiring) + ' expiring soon.' },
      { label: 'SSL sessions', value: fmt(ssl), detail: fmt(clear) + ' cleartext sessions observed.' },
    ]
  } catch {
    findings.value = []
  } finally { loading.value = false }
}
function findingRow(row: Record<string, unknown>): Finding { return row as Finding }
onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-security">
    <section class="security-head"><div><div class="eyebrow">Configuration and access posture</div><h2>Security review</h2><p>Read-only checks for authentication rules, applied configuration, roles, TLS usage, and privilege-risk signals.</p></div><div class="security-note">No settings are changed from this view.</div></section>
    <section class="security-section"><div class="section-head"><div><h3>Posture snapshot</h3><p>Signals are based on the collector role’s visibility and may be incomplete without pg_monitor permissions.</p></div></div><DataTable :columns="postureColumns" :rows="posture" row-key="label" :loading="loading && !posture.length"><template #cell-value="{ row }"><span class="mono">{{ row.value }}</span></template></DataTable></section>
    <section class="security-section"><div class="section-head"><div><h3>Findings</h3><p>Latest recommendation per security or configuration check.</p></div></div><p v-if="loading && !findings.length" class="pg-empty">Loading security findings…</p><p v-else-if="!findings.length" class="pg-empty">No security findings have been emitted.</p><DataTable v-else :columns="findingColumns" :rows="findings" row-key="id"><template #cell-severity="{ row }"><span :class="['severity', 'severity-' + findingRow(row).severity]">{{ findingRow(row).severity }}</span></template><template #cell-check="{ row }"><span class="mono">{{ findingRow(row).check }}</span></template><template #cell-current="{ row }"><span class="mono">{{ findingRow(row).current }}</span></template></DataTable></section>
  </div>
</template>

<style scoped>
.pg-security { display: grid; gap: 22px; }
.security-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.security-head p, .section-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.security-note { max-width: 260px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.section-head { margin-bottom: 10px; }
h3 { margin: 0 0 3px; font-size: 15px; }
.mono { font-family: var(--font-mono, monospace); font-size: 11px; }
.severity { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.severity-critical { color: var(--error, #ef4444); }
.severity-warning { color: var(--amber, #f59e0b); }
.severity-info { color: var(--text-tertiary); }
@media (max-width: 760px) { .security-head { display: block; } .security-note { margin-top: 16px; max-width: none; } }
</style>
