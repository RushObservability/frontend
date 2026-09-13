<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import DataTable from '../components/DataTable.vue'
import TimePicker from '../components/TimePicker.vue'
import ProfileFlameGraph from '../components/ProfileFlameGraph.vue'
import { cpuTime, profileFunctions, type ProfileQuery, type ProfileResult, type ProfileSeries } from '../lib/profiles'

const api = useApi()
const route = useRoute()
const router = useRouter()
const { activeTenant } = useTenant()
const result = ref<ProfileResult | null>(null)
const baseline = ref<ProfileResult | null>(null)
const series = ref<ProfileSeries[]>([])
const seriesTruncated = ref(false)
const loading = ref(false)
const error = ref('')
const search = ref('')
const layout = ref<'both' | 'flame' | 'functions'>('both')
const focusedFunction = ref('')
const graphPane = ref<HTMLElement | null>(null)
const setupOpen = ref(false)
const comparisonOpen = ref(false)
const sort = ref('self')
const descending = ref(true)
let controller: AbortController | undefined
let generation = 0
const text = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
let pendingQuery: Record<string, string | undefined> | null = null
function change(values: Record<string, string | undefined>) {
  const scheduled = pendingQuery !== null
  pendingQuery = { ...pendingQuery, ...values }
  if (!scheduled) queueMicrotask(() => {
    const next = pendingQuery; pendingQuery = null
    void router.replace({ query: { ...route.query, ...next } })
  })
}
const service = computed({ get: () => text('service'), set: value => change({ service: value || undefined, version: undefined, pod: undefined, profile_type: undefined, compare: undefined, trace_id: undefined, span_id: undefined }) })
const version = computed({ get: () => text('version'), set: value => change({ version: value || undefined }) })
const pod = computed({ get: () => text('pod'), set: value => change({ pod: value || undefined }) })
const compare = computed({ get: () => text('compare'), set: value => change({ compare: value || undefined }) })
const minutes = computed({ get: () => Number(text('t')) > 0 ? Number(text('t')) : 60, set: value => change({ t: String(value) }) })
const customRange = computed({ get: () => text('from') && text('to') ? { from: text('from'), to: text('to') } : null, set: value => change({ from: value?.from, to: value?.to }) })
const services = computed(() => [...new Set(series.value.map(s => s.service))].sort())
const versions = computed(() => [...new Set(series.value.filter(s => s.service === service.value).map(s => s.version).filter(Boolean))].sort())
const pods = computed(() => [...new Set(series.value.filter(s => s.service === service.value).map(s => s.pod).filter(Boolean))].sort())
const comparing = computed(() => Boolean(compare.value))
const profileType = computed({ get: () => text('profile_type') || (series.value.some(s => s.service === service.value && s.profile_type === 'cpu') ? 'cpu' : series.value.some(s => s.service === service.value && s.profile_type === 'sampled_cpu') ? 'sampled_cpu' : 'cpu'), set: value => change({ profile_type: value }) })
const showComparison = computed(() => comparisonOpen.value || comparing.value)
const serviceRows = computed(() => services.value.map(name => {
  const entries = series.value.filter(s => s.service === name)
  return { name, versions: new Set(entries.map(s => s.version).filter(Boolean)).size, pods: new Set(entries.map(s => s.pod).filter(Boolean)).size }
}))
const serviceColumns = [
  { key: 'name', label: 'Service' },
  { key: 'versions', label: 'Versions', align: 'right' as const },
  { key: 'pods', label: 'Pods', align: 'right' as const },
]
function stopComparing() { comparisonOpen.value = false; compare.value = '' }
const baselineLabel = computed(() => compare.value === 'previous' ? 'Previous time window' : compare.value.replace(/^version:/, 'Version '))
const columns = computed(() => [
  { key: 'name', label: 'Function', sortable: true },
  { key: 'self', label: 'Self CPU', align: 'right' as const, sortable: true },
  { key: 'total', label: 'Total CPU', align: 'right' as const, sortable: true },
  { key: 'share', label: 'Self share', align: 'right' as const, sortable: true },
  ...(comparing.value ? [{ key: 'baseline', label: 'Baseline self', align: 'right' as const, sortable: true }, { key: 'delta', label: 'Share change', align: 'right' as const, sortable: true }] : []),
])
const rows = computed(() => profileFunctions(result.value?.stacks ?? [], baseline.value?.stacks ?? [])
  .filter(r => r.name.toLowerCase().includes(search.value.toLowerCase()))
  .sort((a, b) => {
    const key = sort.value as keyof typeof a
    const first = a[key]; const second = b[key]
    const diff = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second))
    return descending.value ? -diff : diff
  }))
const hasCpu = computed(() => (result.value?.total_cpu_seconds ?? 0) > 0)
const averageCores = computed(() => result.value ? result.value.total_cpu_seconds / ((result.value.to - result.value.from) / 1000) : 0)

function setSort(key: string) { descending.value = sort.value === key ? !descending.value : key !== 'name'; sort.value = key }
async function focusFunction(name: string) {
  focusedFunction.value = name
  if (layout.value === 'functions') layout.value = 'both'
  await nextTick()
  graphPane.value?.scrollIntoView({ block: 'start', behavior: 'auto' })
}
async function load() {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const current = ++generation
  focusedFunction.value = ''; loading.value = true; error.value = ''; result.value = null; baseline.value = null; series.value = []; seriesTruncated.value = false
  try {
    const to = customRange.value ? Date.parse(customRange.value.to) : Date.now()
    const from = customRange.value ? Date.parse(customRange.value.from) : to - minutes.value * 60_000
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to - from > 31 * 86400_000) throw new Error('Choose a valid time range of at most 31 days.')
    const q: ProfileQuery = { from, to, service: service.value, version: version.value, pod: pod.value, trace_id: text('trace_id'), span_id: text('span_id') }
    const available = await api.profileSeries({ from, to }, signal)
    if (current !== generation) return
    series.value = available.series; seriesTruncated.value = available.truncated
    if (!service.value) return
    q.profile_type = profileType.value
    const queryBaseline = compare.value === 'previous' ? { ...q, from: from - (to - from), to: from } : { ...q, version: compare.value.replace(/^version:/, '') }
    const [data, before] = await Promise.all([api.queryProfiles(q, signal), comparing.value ? api.queryProfiles(queryBaseline, signal) : Promise.resolve(null)])
    if (current !== generation) return
    result.value = data; baseline.value = before
  } catch (e) {
    if (current !== generation || signal.aborted) return
    const status = (e as { status?: number }).status
    error.value = status === 422 ? 'Too many distinct stacks. Narrow the time range or choose a pod.' : status === 404 ? 'This API does not support profiles yet. Update query-api to a build with profiling support.' : (e instanceof Error ? e.message : 'Could not load profiles. Try again.')
  } finally { if (current === generation) loading.value = false }
}
watch([() => route.fullPath, activeTenant], load, { immediate: true })
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>

<template>
  <div class="profiles-page">
    <header class="profiles-header">
      <div class="page-title"><h1>Profiles</h1></div>
      <div class="header-actions">
        <button type="button" class="text-button" :aria-expanded="setupOpen" aria-controls="profile-setup" @click="setupOpen = !setupOpen">Collection setup</button>
        <TimePicker v-model="minutes" v-model:custom-range="customRange" />
        <button type="button" class="btn" :disabled="loading" @click="load">Refresh</button>
      </div>
    </header>

    <section v-if="setupOpen" id="profile-setup" class="profile-setup" aria-label="Collection setup">
      <div class="setup-heading"><h2>Send CPU profiles to Rush</h2><button class="text-button" @click="setupOpen = false">Close setup</button></div>
      <p>Profiling is built in and requires no integration or paid license. Forward OTLP/HTTP protobuf CPU profiles to <code>/v1development/profiles</code>.</p>
      <ol>
        <li>Create an ingest key with the <code>profiles</code> signal for your tenant.</li>
        <li>Send the key as a Bearer token and set <code>X-Rush-Tenant</code>.</li>
        <li>Set <code>service.name</code>. Add <code>service.version</code> and <code>k8s.pod.name</code> to filter releases and pods.</li>
      </ol>
      <p class="muted">Supports OpenTelemetry v1.10.0 CPU profiles. Retention defaults to seven days. Memory profiles, debug-file uploads, and server-side symbolization are not included.</p>
    </section>

    <div class="profile-querybar">
      <label class="service-filter">Service<select v-model="service"><option value="">All services</option><option v-if="service && !services.includes(service)" :value="service">{{ service }}</option><option v-for="s in services" :key="s" :value="s">{{ s }}</option></select></label>
      <label>Profile type<select v-model="profileType"><option value="cpu">CPU time</option><option value="sampled_cpu">CPU from sample counts</option></select></label>
      <label>Version<select v-model="version" :disabled="!service"><option value="">All versions</option><option v-if="version && !versions.includes(version)" :value="version">{{ version }}</option><option v-for="v in versions" :key="v" :value="v">{{ v }}</option></select></label>
      <label>Pod<select v-model="pod" :disabled="!service"><option value="">All pods</option><option v-if="pod && !pods.includes(pod)" :value="pod">{{ pod }}</option><option v-for="p in pods" :key="p" :value="p">{{ p }}</option></select></label>
      <button class="btn compare-toggle" :class="{ active: showComparison }" :disabled="!service || Boolean(text('trace_id'))" :aria-expanded="showComparison" aria-controls="profile-comparison" @click="showComparison ? stopComparing() : comparisonOpen = true">Compare</button>
    </div>
    <div v-if="showComparison" id="profile-comparison" class="comparison-bar">
      <div><span class="scope-dot current"></span><strong>Current</strong><span>{{ version || 'All versions' }} · selected time range</span></div>
      <label><span class="scope-dot baseline"></span><strong>Baseline</strong><select v-model="compare" aria-label="Compare with"><option value="">Choose a baseline</option><option value="previous">Previous time window</option><option v-for="v in versions.filter(v => v !== version)" :key="v" :value="`version:${v}`">Version {{ v }}</option></select></label>
      <button class="text-button" @click="stopComparing">Remove comparison</button>
    </div>
    <p v-if="seriesTruncated" class="notice">Only the first 2,000 service/version/pod combinations are listed. Narrow the time range to find others.</p>
    <p v-if="text('trace_id')" class="notice">Linked samples for trace <code>{{ text('trace_id') }}</code>. <button class="text-button" @click="change({ trace_id: undefined, span_id: undefined, compare: undefined })">Show related service profiles</button></p>

    <div v-if="error" role="alert" class="profile-error"><span>{{ error }}</span><button class="btn" @click="load">Retry</button></div>
    <div v-else-if="loading" role="status" class="profile-loading"><span>Loading CPU profiles…</span><div class="loading-placeholder" aria-hidden="true"></div></div>
    <section v-else-if="!service && services.length" class="service-browser">
      <div class="section-heading"><div><h2>Profiled services <span class="count">{{ services.length }}</span></h2><p>Select a service to inspect its CPU hotspots.</p></div></div>
      <DataTable :columns="serviceColumns" :rows="serviceRows" row-key="name" empty-label="No profiled services">
        <template #cell-name="{ row }"><button class="service-link" @click="service = String(row.name)">{{ row.name }} <span aria-hidden="true">→</span></button></template>
      </DataTable>
    </section>
    <section v-else-if="!hasCpu" class="profile-empty">
      <div class="empty-rule" aria-hidden="true"></div>
      <h2>No CPU samples in this range</h2>
      <p>{{ service ? 'Try a wider time range or check that your profiler is sending data to this tenant.' : 'Connect a profiler to find expensive functions and compare CPU usage across releases.' }}</p>
      <button class="btn" @click="setupOpen = true">Set up CPU profiling</button>
      <p v-if="text('trace_id')" class="muted">Your collector may not attach trace/span IDs. Related service profiles do not require those links.</p>
    </section>
    <section v-else-if="result" class="profile-workspace" aria-label="Profile analysis">
      <div class="workspace-meta">
        <strong class="selected-service" :title="service">{{ service }}</strong>
        <span><b>{{ cpuTime(result.total_cpu_seconds) }}</b> sampled CPU</span>
        <span :title="'Average CPU cores across all selected processes over the selected window'"><b>{{ averageCores.toFixed(3) }}</b> avg. cores</span>
        <span>{{ result.stacks.length.toLocaleString() }} stacks</span>
        <span class="attribution">{{ result.attribution === 'service' ? 'Service-wide' : 'Linked samples' }}</span>
      </div>
      <div class="analysis-toolbar">
        <div class="layout-switch" role="group" aria-label="Profile layout">
          <button :aria-pressed="layout === 'both'" @click="layout = 'both'">Both</button>
          <button :aria-pressed="layout === 'flame'" @click="layout = 'flame'">Flame graph</button>
          <button :aria-pressed="layout === 'functions'" @click="layout = 'functions'">Functions</button>
        </div>
        <label class="function-search"><span class="sr-only">Find a function</span><input v-model="search" type="search" placeholder="Find a function…" /><span v-if="search" class="match-count">{{ rows.length }} matches</span></label>
      </div>
      <div class="analysis-panes" :class="[`layout-${layout}`, { comparing }]">
        <div v-show="layout !== 'functions'" ref="graphPane" class="graph-pane">
          <div class="pane-heading"><h2>Flame graph</h2><span>Width = sampled CPU</span></div>
          <ProfileFlameGraph :stacks="result.stacks" :search="search" :focused-function="focusedFunction" @select="focusedFunction = $event" />
        </div>
        <div v-show="layout !== 'flame'" class="functions-pane">
          <div class="pane-heading"><h2>Functions <span class="count">{{ rows.length }}</span></h2><span>Self excludes callees</span></div>
          <DataTable bare :columns="columns" :rows="rows" row-key="name" :row-class="row => row.name === focusedFunction ? 'profile-function-selected' : ''" :sort-key="sort" :sort-direction="descending ? 'desc' : 'asc'" empty-label="No functions match your search" @sort="setSort">
            <template #cell-name="{ row }"><button class="function-name" :disabled="Number(row.total) <= 0" :title="Number(row.total) > 0 ? String(row.name) : `${row.name}: only present in baseline`" :aria-label="`Focus ${row.name} in flame graph`" @click="focusFunction(String(row.name))">{{ row.name }}</button></template>
            <template #cell-self="{ row }">{{ cpuTime(Number(row.self)) }}</template>
            <template #cell-total="{ row }">{{ cpuTime(Number(row.total)) }}</template>
            <template #cell-share="{ row }"><span class="share-cell"><i aria-hidden="true" :style="{ width: `${Math.min(100, Number(row.share))}%` }"></i><span>{{ Number(row.share).toFixed(1) }}%</span></span></template>
            <template #cell-baseline="{ row }">{{ baseline?.total_cpu_seconds ? cpuTime(Number(row.baseline)) : 'Unavailable' }}</template>
            <template #cell-delta="{ row }"><span :class="{ increase: Number(row.delta) > 0 && baseline?.total_cpu_seconds, decrease: Number(row.delta) < 0 && baseline?.total_cpu_seconds }">{{ baseline?.total_cpu_seconds ? `${Number(row.delta) > 0 ? '+' : ''}${Number(row.delta).toFixed(1)} pp` : 'Unavailable' }}</span></template>
          </DataTable>
        </div>
      </div>
      <div class="analysis-note">
        <p v-if="result.attribution === 'service'">Samples include concurrent requests, not one span. Flame width is CPU time, not elapsed request time.</p>
        <p v-if="comparing">Baseline: {{ baselineLabel }}. Share changes are percentage points, not per-request regressions. Traffic and workload mix can differ.</p>
        <p v-if="comparing && !baseline?.total_cpu_seconds">No CPU samples in the baseline. Share changes are unavailable.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.profiles-page { min-width: 0; padding: 12px 0 24px; color: var(--text-primary); }
.profiles-header, .header-actions, .page-title, .section-heading, .pane-heading, .analysis-toolbar, .workspace-meta, .setup-heading { display: flex; align-items: center; gap: 12px; }
.profiles-header { justify-content: space-between; flex-wrap: wrap; margin-bottom: 20px; }
h1 { font-size: 24px; font-weight: 650; letter-spacing: -.025em; margin: 0; }
h2 { font-size: 14px; font-weight: 600; margin: 0; }
.count { font-size: 11px; color: var(--text-secondary); background: var(--bg-raised); padding: 3px 7px; border: 1px solid var(--border-default); border-radius: 4px; font-weight: 400; }
.header-actions { flex-wrap: wrap; }
button, select, input { font: inherit; }
.btn, select, input { background: var(--bg-surface); border: 1px solid var(--border-default); color: var(--text-primary); border-radius: 4px; padding: 8px 10px; font-size: 12px; min-height: 34px; }
button { cursor: pointer; }
button:disabled, select:disabled { opacity: .5; cursor: default; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:hover:not(:disabled), .layout-switch button:hover { background: var(--bg-hover); }
.text-button { border: 0; background: none; color: var(--accent); font-size: 12px; padding: 8px 0; }
.profile-querybar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 16px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 6px; }
.profile-querybar label { display: flex; flex-direction: column; gap: 6px; flex: 1 1 140px; min-width: 0; color: var(--text-secondary); font-size: 11px; }
.profile-querybar .service-filter { flex-grow: 1.6; }
.profile-querybar select { width: 100%; text-overflow: ellipsis; }
.compare-toggle.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.comparison-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; padding: 12px 16px; border: 1px solid var(--border-default); border-top: 0; font-size: 12px; }
.comparison-bar > div, .comparison-bar label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.comparison-bar > div > span:last-child { color: var(--text-secondary); }
.comparison-bar .text-button { margin-left: auto; }
.scope-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--accent); }
.scope-dot.baseline { background: var(--text-muted); }
.notice, .muted, .analysis-note { color: var(--text-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.profile-error { display: flex; align-items: center; gap: 16px; padding: 24px 0; color: var(--error); }
.profile-loading { padding-top: 32px; font-size: 13px; color: var(--text-secondary); }
.loading-placeholder { height: 300px; margin-top: 20px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 4px; }
.service-browser { padding-top: 28px; }
.section-heading { justify-content: space-between; align-items: end; flex-wrap: wrap; margin-bottom: 16px; }
.section-heading h2 { font-size: 16px; }
.section-heading p { margin: 8px 0 0; color: var(--text-secondary); font-size: 13px; }
.service-link { display: flex; align-items: center; gap: 16px; border: 0; background: none; color: var(--accent); padding: 4px 0; text-align: left; overflow-wrap: anywhere; }
.service-link span { color: var(--text-muted); }
.profile-empty { padding: 64px 24px; max-width: 620px; }
.empty-rule { width: 32px; height: 3px; background: var(--accent); margin-bottom: 20px; }
.profile-empty h2 { font-size: 20px; }
.profile-empty p { font-size: 13px; color: var(--text-secondary); line-height: 1.7; margin: 12px 0 20px; }
.workspace-meta { flex-wrap: wrap; padding: 24px 0 16px; font-size: 12px; color: var(--text-secondary); gap: 12px 20px; font-variant-numeric: tabular-nums; }
.workspace-meta b { font-weight: 550; color: var(--text-primary); }
.selected-service { color: var(--text-primary); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.attribution { margin-left: auto; font-size: 11px; }
.analysis-toolbar { justify-content: space-between; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border-default); background: var(--bg-surface); border-radius: 6px 6px 0 0; }
.layout-switch { display: flex; gap: 2px; }
.layout-switch button { border: 0; background: none; padding: 7px 10px; border-radius: 4px; color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.layout-switch button[aria-pressed="true"] { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.function-search { display: flex; align-items: center; position: relative; min-width: 200px; width: min(100%, 360px); }
.function-search input { width: 100%; padding-right: 86px; }
.match-count { position: absolute; right: 26px; color: var(--text-secondary); font-size: 11px; pointer-events: none; }
.analysis-panes { display: grid; grid-template-columns: minmax(0, 1fr); border: 1px solid var(--border-default); border-top: 0; background: var(--bg-surface); border-radius: 0 0 6px 6px; }
.graph-pane, .functions-pane { min-width: 0; }
.graph-pane { scroll-margin-top: 88px; }
.pane-heading { justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border-default); }
.pane-heading > span { font-size: 11px; color: var(--text-secondary); }
.functions-pane { overflow: hidden; }
.layout-both .functions-pane { border-top: 1px solid var(--border-default); }
.functions-pane :deep(.data-table-wrap) { max-height: 550px; overflow: auto; border-radius: 0; }
.functions-pane :deep(thead) { position: sticky; top: 0; z-index: 1; }
.functions-pane :deep(.profile-function-selected td) { background: var(--accent-soft); }
.function-name { display: block; border: 0; background: none; padding: 4px 0; color: var(--text-primary); font: 11px var(--font-mono); text-align: left; max-width: clamp(260px, 48vw, 900px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.function-name:hover { color: var(--accent); }
.share-cell { position: relative; display: block; min-width: 64px; padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums; }
.share-cell i { position: absolute; inset: 0 auto 0 0; background: var(--accent-soft); border-radius: 2px; }
.share-cell > span { position: relative; }
.increase { color: var(--error); }
.decrease { color: var(--ok); }
.analysis-note { padding: 10px 0; font-size: 11px; }
.analysis-note p { margin: 4px 0; }
.profile-setup { padding: 20px; margin-bottom: 20px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 6px; font-size: 13px; line-height: 1.8; }
.setup-heading { justify-content: space-between; }
.profile-setup p { max-width: 850px; margin: 8px 0; }
.profile-setup ol { margin: 12px 0; padding-left: 20px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 600px) {
  .profile-querybar { padding: 12px; }
  .profile-querybar label { flex-basis: 42%; }
  .profile-querybar .service-filter { flex-basis: 100%; }
  .analysis-toolbar { align-items: stretch; }
  .function-search { width: 100%; }
  .attribution { margin-left: 0; }
  .comparison-bar select { max-width: 100%; }
  .header-actions { gap: 10px; }
  .btn, select, input, .layout-switch button { min-height: 40px; }
}
@media (pointer: coarse) { button, select, input { min-height: 44px; } }
</style>
