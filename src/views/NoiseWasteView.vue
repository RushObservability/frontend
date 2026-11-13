<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import DataTable from '../components/DataTable.vue'
import EmptyState from '../components/EmptyState.vue'
import TimePicker from '../components/TimePicker.vue'
import { candidateShare, evidenceLink, formatBodyBytes, type WasteFinding, type WasteResponse } from '../lib/noiseWaste'
import { serviceLabel } from '../lib/telemetryQuality'

const api = useApi()
const route = useRoute()
const router = useRouter()
const { activeTenantName } = useTenant()
const validMinutes = (value: unknown) => { const n = Number(value); return Number.isInteger(n) && n >= 5 && n <= 10080 ? n : 1440 }
const minutes = ref(validMinutes(route.query.minutes))
const presets = [{ label: '1h', value: 60 }, { label: '6h', value: 360 }, { label: '24h', value: 1440 }, { label: '7d', value: 10080 }]
const view = ref(route.query.view === 'coverage' ? 'coverage' : 'recommendations')
const service = ref(typeof route.query.service === 'string' ? `service:${route.query.service}` : '*')
const signal = ref(['logs', 'traces', 'metrics'].includes(String(route.query.signal)) ? String(route.query.signal) : '*')
const selectedId = ref(typeof route.query.finding === 'string' ? route.query.finding : '')
const report = ref<WasteResponse | null>(null)
const loading = ref(false)
const error = ref('')
const page = ref(0)
const pageSize = 20
let generation = 0
let controller: AbortController | undefined
let disposed = false

const ruleMap = computed(() => new Map(report.value?.rules.map(r => [r.id, r]) ?? []))
const serviceOptions = computed(() => [...new Set([...(report.value?.services ?? []), ...(report.value?.findings.map(f => f.service) ?? [])])].sort())
const filtered = computed(() => report.value?.findings.filter(f => (service.value === '*' || `service:${f.service}` === service.value) && (signal.value === '*' || signal.value === f.signal)) ?? [])
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const selected = computed(() => filtered.value.find(f => f.id === selectedId.value) ?? filtered.value[0])
const selectedRule = computed(() => selected.value ? ruleMap.value.get(selected.value.rule_id) : undefined)
const logBytesAvailable = computed(() => report.value?.sources.some(s => s.table === 'logs' && s.status === 'available'))
const unavailable = computed(() => report.value?.sources.filter(s => s.status !== 'available') ?? [])
const affectedServices = computed(() => new Set(report.value?.findings.map(f => f.service)).size)
const coverage = computed(() => report.value?.rules.map(rule => ({ ...rule, ...report.value?.checks.find(c => c.rule_id === rule.id) })) ?? [])
const incompleteGroups = computed(() => report.value?.checks.reduce((sum, c) => sum + c.insufficient_groups, 0) ?? 0)
function date(value: string): string { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Not available' }
function signalLabel(value: unknown): string { return value === 'logs' ? 'Logs' : value === 'traces' ? 'Traces' : 'Metrics' }
function sourceLabel(table: unknown): string { return ({ logs: 'Logs', spans: 'Traces', metrics_gauge: 'Gauge metrics', metrics_sum: 'Sum metrics', metrics_histogram: 'Histogram metrics', metrics_exp_histogram: 'Exponential histogram metrics', metrics_summary: 'Summary metrics' } as Record<string, string>)[String(table)] ?? String(table) }
function share(finding: WasteFinding): string { return `${candidateShare(finding).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` }
function syncUrl() {
  void router.replace({ query: { ...route.query, minutes: String(minutes.value), view: view.value === 'coverage' ? 'coverage' : undefined, service: service.value === '*' ? undefined : service.value.slice(8), signal: signal.value === '*' ? undefined : signal.value, finding: selectedId.value || undefined } })
}
function alignSelection() {
  if (!filtered.value.some(f => f.id === selectedId.value)) selectedId.value = filtered.value[0]?.id ?? ''
  page.value = Math.max(0, Math.floor(filtered.value.findIndex(f => f.id === selectedId.value) / pageSize))
}
function filtersChanged() { selectedId.value = filtered.value[0]?.id ?? ''; page.value = 0; syncUrl() }
function selectFinding(finding: WasteFinding) {
  selectedId.value = finding.id; syncUrl()
  if (window.matchMedia('(max-width: 1050px)').matches) void nextTick(() => document.getElementById('nw-detail')?.scrollIntoView({ block: 'start' }))
}
function backToList() { document.getElementById('nw-list')?.scrollIntoView({ block: 'start' }) }
function changePage(value: number) { page.value = value; selectedId.value = visible.value[0]?.id ?? ''; syncUrl() }
function selectView(value: string) { view.value = value; syncUrl() }
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const target = event.key === 'Home' ? 'recommendations' : event.key === 'End' ? 'coverage' : view.value === 'coverage' ? 'recommendations' : 'coverage'
  selectView(target); document.getElementById(`nw-tab-${target}`)?.focus()
}
async function load() {
  const request = ++generation
  controller?.abort(); controller = new AbortController()
  const own = controller
  report.value = null; error.value = ''; loading.value = true; page.value = 0
  try {
    const result = await api.getNoiseWaste(minutes.value, own.signal)
    if (disposed || generation !== request || own.signal.aborted) return
    report.value = result
    if (service.value !== '*' && !serviceOptions.value.some(s => `service:${s}` === service.value)) service.value = '*'
    alignSelection(); syncUrl()
  } catch (cause: unknown) {
    if (disposed || generation !== request || own.signal.aborted) return
    if (!(cause instanceof Error && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : 'Unable to analyze signal volume.'
  } finally { if (!disposed && request === generation) loading.value = false }
}
watch([minutes, activeTenantName], () => { void load() }, { immediate: true })
watch(minutes, syncUrl)
watch(() => route.query, query => {
  const nextMinutes = validMinutes(query.minutes)
  if (nextMinutes !== minutes.value) minutes.value = nextMinutes
  view.value = query.view === 'coverage' ? 'coverage' : 'recommendations'
  service.value = typeof query.service === 'string' ? `service:${query.service}` : '*'
  signal.value = ['logs', 'traces', 'metrics'].includes(String(query.signal)) ? String(query.signal) : '*'
  selectedId.value = typeof query.finding === 'string' ? query.finding : ''
  if (report.value) alignSelection()
})
onBeforeUnmount(() => { disposed = true; generation++; controller?.abort() })
</script>

<template>
  <div class="noise-waste-view">
    <header class="nw-header"><div><h1>Noise &amp; waste</h1><p>Review signal volume before changing collection.</p></div><div class="nw-controls"><span>{{ activeTenantName }}</span><TimePicker v-model="minutes" :presets="presets" /><button class="btn btn-sm" :disabled="loading" @click="load">{{ loading ? 'Analyzing…' : 'Refresh' }}</button></div></header>
    <div v-if="error" class="nw-notice nw-error" role="alert"><strong>Advisor unavailable</strong><p>{{ error }}</p><button class="btn btn-sm" @click="load">Try again</button></div>
    <p v-if="loading" class="nw-loading" role="status">Analyzing bounded samples of logs, traces, and metrics…</p>
    <template v-if="report">
      <div v-if="report.partial" class="nw-notice" role="status"><strong>Analysis incomplete</strong><p v-if="unavailable.length">Unavailable sources: {{ unavailable.map(s => sourceLabel(s.table)).join(', ') }}. Their data was not assessed.</p><p v-if="report.omitted_findings || report.omitted_services">{{ report.omitted_findings }} recommendations and {{ report.omitted_services }} services are outside the response limits.</p></div>
      <div class="nw-overview"><div><strong>{{ report.finding_count }}</strong><span>review recommendations</span></div><div><strong>{{ affectedServices }}</strong><span>services with candidates in the response</span></div><div><strong>{{ report.sampled_records.toLocaleString() }}</strong><span>sampled records</span></div><span class="nw-review-note">Review only · collection settings stay unchanged</span></div>
      <div class="nw-assessment"><span>{{ report.cache_hit ? 'Cached assessment' : 'Assessed' }} {{ date(report.evaluated_at) }}</span><span>Results cached for up to {{ report.cache_ttl_seconds }}s · up to {{ report.sample_limit_per_source.toLocaleString() }} records per source</span></div>
      <nav class="nw-tabs" role="tablist" aria-label="Noise and waste views"><button id="nw-tab-recommendations" role="tab" aria-controls="nw-panel-recommendations" :aria-selected="view === 'recommendations'" :tabindex="view === 'recommendations' ? 0 : -1" @click="selectView('recommendations')" @keydown="tabKey">Recommendations</button><button id="nw-tab-coverage" role="tab" aria-controls="nw-panel-coverage" :aria-selected="view === 'coverage'" :tabindex="view === 'coverage' ? 0 : -1" @click="selectView('coverage')" @keydown="tabKey">Coverage &amp; method</button></nav>
      <section v-show="view === 'recommendations'" id="nw-panel-recommendations" role="tabpanel" aria-labelledby="nw-tab-recommendations">
        <div class="nw-filters"><label>Service <select v-model="service" aria-label="Filter recommendations by service" @change="filtersChanged"><option value="*">All services</option><option v-for="name in serviceOptions" :key="name" :value="`service:${name}`">{{ serviceLabel(name) }}</option></select></label><label>Signal <select v-model="signal" aria-label="Filter recommendations by signal" @change="filtersChanged"><option value="*">All signals</option><option value="logs">Logs</option><option value="traces">Traces</option><option value="metrics">Metrics</option></select></label><span>{{ filtered.length }} shown · ranked by candidate records</span></div>
        <div v-if="filtered.length" class="nw-layout">
          <div id="nw-list" class="nw-list"><button v-for="finding in visible" :key="finding.id" class="nw-finding" type="button" :aria-pressed="selected?.id === finding.id" @click="selectFinding(finding)"><span class="nw-finding-main"><span class="nw-signal">{{ signalLabel(finding.signal) }}</span><strong>{{ ruleMap.get(finding.rule_id)?.title ?? finding.rule_id }}</strong><span class="nw-service">{{ serviceLabel(finding.service) }}</span><span v-if="finding.subject" class="nw-subject">{{ finding.subject }}</span></span><span class="nw-count"><strong>{{ finding.candidate_records.toLocaleString() }}</strong><small>candidate records</small><span class="nw-share"><span :style="{ width: `${candidateShare(finding)}%` }"></span></span><small>{{ share(finding) }} of evaluated sample</small></span></button><div v-if="pages > 1" class="nw-pagination"><button class="btn btn-sm" :disabled="page === 0" @click="changePage(page - 1)">Previous</button><span>{{ page + 1 }} / {{ pages }}</span><button class="btn btn-sm" :disabled="page + 1 >= pages" @click="changePage(page + 1)">Next</button></div></div>
          <section v-if="selected && selectedRule" id="nw-detail" class="nw-detail" aria-label="Selected recommendation" aria-live="polite"><button class="btn btn-sm nw-back" @click="backToList">Back to recommendations</button><div class="nw-detail-top"><span>{{ selected.confidence === 'strong' ? 'Strong duplicate evidence' : 'Review candidate' }}</span><code>{{ selectedRule.id }}</code></div><h2>{{ selectedRule.title }}</h2><p class="nw-detail-service">{{ serviceLabel(selected.service) }} · {{ sourceLabel(selected.source) }}</p><p v-if="selected.subject" class="nw-subject">{{ selected.subject }}</p><section class="nw-detail-section"><h3>Observed evidence</h3><dl><template v-for="fact in selected.evidence" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template><dt>Candidate records</dt><dd>{{ selected.candidate_records.toLocaleString() }} / {{ selected.sampled_records.toLocaleString() }} evaluated records</dd><template v-if="selected.candidate_body_bytes !== null"><dt>Candidate body bytes</dt><dd>{{ formatBodyBytes(selected.candidate_body_bytes) }} uncompressed · sampled log bodies only</dd></template><dt>First in sample</dt><dd>{{ date(selected.first_observed) }}</dd><dt>Last in sample</dt><dd>{{ date(selected.last_observed) }}</dd></dl></section><section class="nw-detail-section"><h3>Suggested change</h3><p>{{ selectedRule.recommendation }}</p></section><section class="nw-safeguard"><h3>Before changing collection</h3><p>{{ selectedRule.safeguard }}</p></section><details class="nw-threshold"><summary>Detection threshold</summary><p>{{ selectedRule.threshold }}</p></details><RouterLink class="btn btn-sm nw-open" :to="evidenceLink(selected, report)">{{ selected.signal === 'metrics' ? 'Open metric' : 'Explore service data' }}</RouterLink></section>
        </div>
        <EmptyState v-else :title="report.sampled_records ? 'No recommendations in this sample' : 'No telemetry assessed'" :description="report.sampled_records ? 'No review candidates matched the filters and thresholds. Sparse or unavailable data cannot establish that collection is efficient.' : 'Choose a wider window or inspect source coverage. Unavailable sources remain unassessed.'" compact />
      </section>
      <section v-show="view === 'coverage'" id="nw-panel-coverage" role="tabpanel" aria-labelledby="nw-tab-coverage"><p class="nw-section-note">Checks use service groups for logs and traces, metric/attribute groups for cardinality, and metric groups containing sufficiently observed series for cadence. {{ incompleteGroups }} groups lack enough observations. A result of “No candidates in evaluated groups” describes the bounded sample.</p><DataTable :rows="coverage" row-key="id" :columns="[{ key: 'title', label: 'Check' }, { key: 'status', label: 'Assessment' }, { key: 'evaluated_groups', label: 'Groups evaluated', align: 'right' }, { key: 'insufficient_groups', label: 'Insufficient data', align: 'right' }]"><template #cell-title="{ row }"><strong class="nw-rule-title">{{ row.title }}</strong><p class="nw-rule-description">{{ row.threshold }}</p></template><template #cell-status="{ value }">{{ value === 'finding' ? 'Review candidates' : value === 'no_candidates' ? 'No candidates in evaluated groups' : 'Not evaluated' }}</template></DataTable><h2 class="nw-sources-title">Source coverage</h2><DataTable :rows="report.sources" row-key="table" :columns="[{ key: 'table', label: 'Source' }, { key: 'status', label: 'Status' }, { key: 'sampled_records', label: 'Sampled records', align: 'right' }, { key: 'capped', label: 'Sample cap reached' }]"><template #cell-table="{ value }">{{ sourceLabel(value) }}</template><template #cell-status="{ value }">{{ value === 'available' ? 'Available' : 'Unavailable · not evaluated' }}</template><template #cell-capped="{ value }">{{ value ? 'Yes' : 'No' }}</template></DataTable><p v-if="logBytesAvailable" class="nw-section-note nw-body-total">{{ formatBodyBytes(report.sampled_log_body_bytes) }} of uncompressed log body content was represented in this sample. Body bytes exclude attributes, indexes, compression and storage overhead.</p><p v-else class="nw-section-note nw-body-total">Log body bytes were not evaluated because the log source was unavailable.</p></section>
      <footer class="nw-method"><p>{{ report.methodology }}</p><p>Window: {{ date(report.from) }} to {{ date(report.to) }}. Candidate records can overlap between checks. Compare requirements and a baseline before making collection changes.</p><RouterLink :to="{ name: 'telemetry-quality', query: { minutes: String(minutes) } }">Review instrumentation quality</RouterLink></footer>
    </template>
  </div>
</template>

<style scoped src="../styles/views/NoiseWasteView.css"></style>
