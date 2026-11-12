<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import DataTable from '../components/DataTable.vue'
import EmptyState from '../components/EmptyState.vue'
import TimePicker from '../components/TimePicker.vue'
import { samplePercentage, serviceLabel, type QualityResponse, type QualityFinding, type QualityRule } from '../lib/telemetryQuality'

const api = useApi()
const route = useRoute()
const router = useRouter()
const { activeTenantName } = useTenant()
const initialMinutes = Number(route.query.minutes)
const minutes = ref(Number.isInteger(initialMinutes) && initialMinutes >= 5 && initialMinutes <= 10080 ? initialMinutes : 1440)
const presets = [{ label: '1h', value: 60 }, { label: '6h', value: 360 }, { label: '24h', value: 1440 }, { label: '7d', value: 10080 }]
const tabs = ['findings', 'services', 'coverage'] as const
type Tab = typeof tabs[number]
const tab = ref<Tab>(tabs.includes(route.query.view as Tab) ? route.query.view as Tab : 'findings')
const service = ref(typeof route.query.service === 'string' ? `service:${route.query.service}` : '*')
const selectedId = ref(typeof route.query.finding === 'string' ? route.query.finding : '')
const report = ref<QualityResponse | null>(null)
const loading = ref(false)
const error = ref('')
const showVersions = ref(false)
const servicePage = ref(0)
let generation = 0
let controller: AbortController | undefined
let disposed = false

const ruleMap = computed(() => new Map(report.value?.rules.map(rule => [rule.id, rule]) ?? []))
const serviceOptions = computed(() => Array.from(new Set([
  ...report.value?.services.map(s => s.service) ?? [],
  ...report.value?.findings.map(f => f.service) ?? [],
])).sort())
const filteredFindings = computed(() => report.value?.findings.filter(f => service.value === '*' || `service:${f.service}` === service.value) ?? [])
const selected = computed(() => filteredFindings.value.find(f => f.id === selectedId.value) ?? filteredFindings.value[0])
const selectedRule = computed(() => selected.value ? ruleMap.value.get(selected.value.rule_id) : undefined)
const assessed = computed(() => (report.value?.assessed_services ?? 0) > 0)
const unavailable = computed(() => report.value?.sources.filter(s => s.status === 'unavailable') ?? [])
const sampleCount = computed(() => report.value?.sources.reduce((sum, s) => sum + s.sampled_records, 0) ?? 0)
const visibleServices = computed(() => report.value?.services.slice(servicePage.value * 25, (servicePage.value + 1) * 25) ?? [])
const servicePages = computed(() => Math.max(1, Math.ceil((report.value?.services.length ?? 0) / 25)))
const ruleRows = computed(() => report.value?.rules.map(rule => {
  const checks = report.value!.services.flatMap(s => s.checks.filter(c => c.rule_id === rule.id))
  return { ...rule, evaluated: checks.filter(c => c.status !== 'not_evaluated').length, findings: checks.filter(c => c.status === 'finding').length }
}) ?? [])

function date(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not available'
}
function impactLabel(value: unknown): string { return value === 'high' ? 'High' : value === 'medium' ? 'Medium' : 'Low' }
function ruleFor(finding: QualityFinding): QualityRule | undefined { return ruleMap.value.get(finding.rule_id) }
function checkCount(row: Record<string, unknown>): string {
  const checks = (row.checks ?? []) as Array<{ status: string }>
  const evaluated = checks.filter(c => c.status !== 'not_evaluated')
  return evaluated.length ? `${evaluated.filter(c => c.status === 'pass').length} / ${evaluated.length}` : 'Not evaluated'
}
function sourceLabel(table: unknown): string {
  return ({ spans: 'Traces', logs: 'Logs', metrics_gauge: 'Gauge metrics', metrics_sum: 'Sum metrics', metrics_histogram: 'Histogram metrics', metrics_exp_histogram: 'Exponential histogram metrics', metrics_summary: 'Summary metrics' } as Record<string, string>)[String(table)] || String(table)
}
function syncUrl() {
  void router.replace({ query: { ...route.query, minutes: String(minutes.value), view: tab.value === 'findings' ? undefined : tab.value, service: service.value === '*' ? undefined : service.value.slice(8), finding: selectedId.value || undefined } })
}
function selectFinding(finding: QualityFinding) {
  selectedId.value = finding.id
  showVersions.value = false
  syncUrl()
  if (window.matchMedia('(max-width: 1000px)').matches) void nextTick(() => document.getElementById('tq-finding-detail')?.scrollIntoView({ block: 'start' }))
}
function backToFindings() { document.getElementById('tq-findings-list')?.scrollIntoView({ block: 'start' }) }
function selectTab(value: Tab) { tab.value = value; syncUrl() }
function tabKey(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  selectTab(tabs[next]!)
  document.getElementById(`tq-tab-${tabs[next]}`)?.focus()
}

async function load() {
  const request = ++generation
  controller?.abort()
  controller = new AbortController()
  const ownController = controller
  loading.value = true
  report.value = null
  error.value = ''
  showVersions.value = false
  servicePage.value = 0
  try {
    const response = await api.getTelemetryQuality(minutes.value, ownController.signal)
    if (disposed || request !== generation || ownController.signal.aborted) return
    report.value = response
    if (service.value !== '*' && !serviceOptions.value.some(s => `service:${s}` === service.value)) service.value = '*'
    if (!filteredFindings.value.some(f => f.id === selectedId.value)) selectedId.value = filteredFindings.value[0]?.id ?? ''
    syncUrl()
  } catch (cause: unknown) {
    if (disposed || request !== generation || ownController.signal.aborted) return
    if (!(cause instanceof Error && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : 'Unable to evaluate telemetry quality.'
  } finally {
    if (!disposed && request === generation) loading.value = false
  }
}
watch([minutes, activeTenantName], () => { void load() }, { immediate: true })
watch(minutes, syncUrl)
watch(service, () => {
  if (!filteredFindings.value.some(f => f.id === selectedId.value)) selectedId.value = filteredFindings.value[0]?.id ?? ''
  showVersions.value = false
  syncUrl()
})
watch(() => route.query, query => {
  const value = Number(query.minutes ?? 1440)
  if (Number.isInteger(value) && value >= 5 && value <= 10080 && value !== minutes.value) minutes.value = value
  tab.value = tabs.includes(query.view as Tab) ? query.view as Tab : 'findings'
  service.value = typeof query.service === 'string' ? `service:${query.service}` : '*'
  selectedId.value = typeof query.finding === 'string' ? query.finding : ''
})
onBeforeUnmount(() => { disposed = true; generation++; controller?.abort() })
</script>

<template>
  <div class="telemetry-quality-view">
    <header class="tq-header">
      <div><h1>Telemetry quality</h1><p class="tq-subtitle">Find gaps in what your services report.</p></div>
      <div class="tq-header-controls"><span class="tq-tenant">{{ activeTenantName }}</span><TimePicker v-model="minutes" :presets="presets" /><button class="btn btn-sm" :disabled="loading" @click="load">{{ loading ? 'Evaluating…' : 'Refresh' }}</button></div>
    </header>

    <div v-if="error" class="tq-notice tq-error" role="alert"><strong>Quality analysis unavailable</strong><p>{{ error }}</p><button class="btn btn-sm" @click="load">Try again</button></div>
    <p v-if="loading" class="tq-loading" role="status">Evaluating bounded samples of logs, traces, and metrics…</p>
    <template v-if="report">
      <div v-if="report.partial" class="tq-notice" role="status">
        <strong>Analysis incomplete</strong>
        <p v-if="unavailable.length">Unavailable sources: {{ unavailable.map(s => sourceLabel(s.table)).join(', ') }}. Their checks have not passed; they could not be evaluated.</p>
        <p v-if="!report.inventory_available">The linked-service inventory could not be loaded. Services without sampled data may be missing from this list.</p>
        <p v-if="report.inventory_capped">The linked-service inventory is capped. Additional linked services may not appear in this assessment.</p>
        <p v-if="report.omitted_findings || report.omitted_services">{{ report.omitted_findings }} findings and {{ report.omitted_services }} services are outside the response limit.</p>
      </div>
      <div class="tq-summary">
        <div class="tq-stat"><span>Open findings in sample</span><strong>{{ assessed ? report.finding_count.toLocaleString() : '—' }}</strong><small>{{ report.high_impact_findings }} high impact</small></div>
        <div class="tq-stat"><span>Services assessed</span><strong>{{ report.assessed_services }}<small> / {{ report.assessed_services + report.unknown_services }}</small></strong><small>{{ report.unknown_services }} linked services have no sampled data</small></div>
        <div class="tq-stat"><span>Initial rule set</span><strong>{{ report.rules.length }}<small> checks</small></strong><small>Coverage shown · no overall score</small></div>
      </div>
      <div class="tq-sample-note"><span>{{ sampleCount.toLocaleString() }} records sampled · up to {{ report.sample_limit_per_source.toLocaleString() }} per source</span><span>Evaluated {{ date(report.evaluated_at) }}</span></div>
      <nav class="tq-tabs" role="tablist" aria-label="Telemetry quality views">
        <button v-for="(value, index) in tabs" :id="`tq-tab-${value}`" :key="value" type="button" role="tab" :aria-controls="`tq-panel-${value}`" :aria-selected="tab === value" @click="selectTab(value)" @keydown="tabKey($event, index)">{{ value === 'coverage' ? 'Rule coverage' : value === 'services' ? 'Services' : 'Findings' }}<span v-if="value === 'findings'">{{ report.finding_count }}</span></button>
      </nav>

      <section v-show="tab === 'findings'" id="tq-panel-findings" role="tabpanel" aria-labelledby="tq-tab-findings">
        <div class="tq-layout">
          <div>
            <div class="tq-toolbar"><label>Service <select v-model="service" aria-label="Filter findings by service"><option value="*">All services</option><option v-for="name in serviceOptions" :key="name" :value="`service:${name}`">{{ serviceLabel(name) }}</option></select></label><span aria-live="polite">{{ filteredFindings.length }} shown</span></div>
            <div v-if="filteredFindings.length" id="tq-findings-list" class="tq-findings">
              <button v-for="finding in filteredFindings" :key="finding.id" type="button" class="tq-finding" :aria-pressed="selected?.id === finding.id" @click="selectFinding(finding)">
                <span class="tq-dot" :class="ruleFor(finding)?.impact" aria-hidden="true"></span>
                <span><strong>{{ ruleFor(finding)?.title ?? finding.rule_id }}</strong><span class="tq-finding-meta">{{ serviceLabel(finding.service) }} <span>{{ ruleFor(finding)?.signals }}</span></span><span class="tq-finding-meta">{{ impactLabel(ruleFor(finding)?.impact) }} impact <span>{{ samplePercentage(finding.affected, finding.sampled) }} of sampled records</span></span></span><span class="tq-chevron" aria-hidden="true">›</span>
              </button>
            </div>
            <EmptyState v-else :title="assessed ? 'No findings in this sample' : 'No telemetry assessed'" :description="assessed ? 'The evaluated checks found no issues in the selected sample. This does not certify all telemetry.' : 'Choose a wider window or check source availability. Linked services without sampled telemetry remain unknown.'" compact />
          </div>
          <section v-if="selected && selectedRule" id="tq-finding-detail" class="tq-detail" aria-label="Selected finding" aria-live="polite">
            <button class="btn btn-sm tq-mobile-back" @click="backToFindings">Back to findings</button>
            <div class="tq-detail-heading"><span class="tq-impact" :class="selectedRule.impact">{{ impactLabel(selectedRule.impact) }} impact</span><code>{{ selectedRule.id }}</code></div>
            <h2>{{ selectedRule.title }}</h2><div class="tq-detail-service"><strong>{{ serviceLabel(selected.service) }}</strong><span>{{ selectedRule.signals }}</span></div>
            <p>{{ selectedRule.description }}</p>
            <section class="tq-detail-section"><h3>Evidence</h3><dl><dt>Observed</dt><dd>{{ selected.observed }}</dd><dt>Expected</dt><dd>{{ selected.expected }}</dd><dt>Sample</dt><dd>{{ selected.affected.toLocaleString() }} / {{ selected.sampled.toLocaleString() }} records affected</dd><dt>First observed</dt><dd>{{ date(selected.first_observed) }}</dd><dt>Last observed</dt><dd>{{ date(selected.last_observed) }}</dd></dl></section>
            <section class="tq-detail-section"><h3>Recommended fix</h3><p>{{ selectedRule.remediation }}</p></section>
            <div class="tq-actions"><button class="btn btn-sm" :aria-expanded="showVersions" aria-controls="tq-version-evidence" @click="showVersions = !showVersions">{{ showVersions ? 'Hide' : 'Inspect' }} version evidence</button><RouterLink v-if="selected.service" class="btn btn-sm" :to="{ name: 'service-detail', params: { serviceName: selected.service }, query: { t: String(minutes) } }">Open service</RouterLink></div>
            <section v-if="showVersions" id="tq-version-evidence" class="tq-detail-section"><h3>Observed versions</h3><p class="tq-version-note">Counts from this sample, not a causal release comparison. Up to 20 versions shown.</p><DataTable bare><thead><tr><th>Version</th><th>Affected / sampled</th></tr></thead><tbody><tr v-for="version in selected.versions" :key="version.version"><td>{{ version.version || 'Not recorded' }}</td><td>{{ version.affected.toLocaleString() }} / {{ version.sampled.toLocaleString() }}</td></tr></tbody></DataTable></section>
          </section>
        </div>
      </section>

      <section v-show="tab === 'services'" id="tq-panel-services" role="tabpanel" aria-labelledby="tq-tab-services">
        <p class="tq-section-note">Passing counts include only evaluated checks. The inventory includes sampled services and services with configured repository links.</p>
        <DataTable :rows="visibleServices" row-key="service" :columns="[{ key: 'service', label: 'Service' }, { key: 'checks', label: 'Checks passing' }, { key: 'finding_count', label: 'Findings', align: 'right' }, { key: 'sampled_records', label: 'Sampled records', align: 'right' }, { key: 'status', label: 'Observation' }]" empty-label="No services found in this window">
          <template #cell-service="{ row }">{{ serviceLabel(String(row.service)) }}</template>
          <template #cell-checks="{ row }">{{ checkCount(row) }}</template>
          <template #cell-status="{ row }"><span class="tq-observation">{{ row.status === 'unknown' ? 'Unknown · no sampled data' : row.status === 'findings' ? 'Findings in sample' : 'No findings in sample' }}</span></template>
        </DataTable>
        <div v-if="servicePages > 1" class="tq-pagination"><button class="btn btn-sm" :disabled="servicePage === 0" @click="servicePage--">Previous</button><span>Page {{ servicePage + 1 }} of {{ servicePages }}</span><button class="btn btn-sm" :disabled="servicePage + 1 >= servicePages" @click="servicePage++">Next</button></div>
      </section>

      <section v-show="tab === 'coverage'" id="tq-panel-coverage" role="tabpanel" aria-labelledby="tq-tab-coverage">
        <p class="tq-section-note">These are eight initial Rush checks, not a complete implementation of the Instrumentation Score specification. No overall score is calculated. Cardinality checks need sufficient observations; checks without enough data are not evaluated.</p>
        <DataTable :rows="ruleRows" row-key="id" :columns="[{ key: 'title', label: 'Check' }, { key: 'signals', label: 'Signals' }, { key: 'evaluated', label: 'Services evaluated', align: 'right' }, { key: 'findings', label: 'Services with findings', align: 'right' }]"><template #cell-title="{ row }"><strong class="tq-rule-title">{{ row.title }}</strong><p class="tq-rule-description">{{ row.description }}</p></template></DataTable>
        <h2 class="tq-sources-title">Source coverage</h2>
        <DataTable :rows="report.sources" row-key="table" :columns="[{ key: 'table', label: 'Source' }, { key: 'status', label: 'Status' }, { key: 'sampled_records', label: 'Sampled records', align: 'right' }, { key: 'capped', label: 'Sample cap reached' }]"><template #cell-table="{ value }">{{ sourceLabel(value) }}</template><template #cell-status="{ value }">{{ value === 'available' ? 'Available' : 'Not evaluated · unavailable' }}</template><template #cell-capped="{ value }">{{ value ? 'Yes' : 'No' }}</template></DataTable>
      </section>
      <footer class="tq-methodology"><p>{{ report.sampling }}</p><p>Window: {{ date(report.from) }} to {{ date(report.to) }}. First-observed times are from the sample, not a persistent finding history.</p></footer>
    </template>
  </div>
</template>

<style scoped src="../styles/views/TelemetryQualityView.css"></style>
