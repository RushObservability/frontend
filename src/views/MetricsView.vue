<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import MetricsExplore from '../components/MetricsExplore.vue'
import PromqlEditor from '../components/PromqlEditor.vue'
import TimePicker from '../components/TimePicker.vue'
import type { PromVectorResult, PromMatrixResult } from '../types'
import QueryHistory from '../components/QueryHistory.vue'
import { useQueryHistory } from '../composables/useQueryHistory'
import { authenticatedFetch } from '../composables/authSession'
import type { HistoryEntry } from '../composables/useQueryHistory'
import VirtualTable from '../components/VirtualTable.vue'
import { TablePanel, TimeSeriesPanel, formatPanelRange } from '../components/panels'
import type { TimeSeriesPanelSeries } from '../components/panels'
import { useTimeRangePreference } from '../composables/useTimeRangePreference'

interface MetricsHistoryQuery {
  query: string
  timePreset: number
}

const { entries: metricsHistory, push: pushHistory, remove: removeHistory, clear: clearHistory } = useQueryHistory<MetricsHistoryQuery>('rush_metrics_history')

const route = useRoute()
const router = useRouter()
const api = useApi()
// This page queries metric data, so it can't function when the metrics signal
// is disabled for the active tenant. Load the tenant list (if needed) so we
// know whether to show the "needs metrics" notice instead.
const { metricsEnabled, loadTenants: loadTenantSignals, loaded: tenantsLoaded } = useTenant()
if (!tenantsLoaded.value) loadTenantSignals()

// ═══ View mode ═══
const viewMode = ref<'query' | 'explore'>('query')

// ═══ Query state ═══
const query = ref('')
const activeTab = ref<'graph' | 'table'>('graph')
const executing = ref(false)
const errorMsg = ref('')
const queryTextarea = ref<InstanceType<typeof PromqlEditor> | null>(null)

// ═══ Time range ═══
const selectedPreset = useTimeRangePreference()
const customRange = ref<{ from: string; to: string } | null>(null)

// ═══ Smart suggestions ═══
const labelCache = new Map<string, string[]>()
const counterSuffixes = ['_total', '_count', '_bucket', '_sum']
const suggestions = ref<Array<{ label: string; query: string; kind: 'rate' | 'group' }>>([])

function isBareName(q: string): string | null {
  const trimmed = q.trim()
  // Must look like a single metric name (alphanumeric + _ + :), no parens, no braces
  if (!trimmed || /[({}\[\])]/.test(trimmed)) return null
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(trimmed)) return null
  return trimmed
}

function looksLikeCounter(name: string): boolean {
  return counterSuffixes.some(s => name.endsWith(s))
}

async function updateSuggestions() {
  const metric = isBareName(query.value)
  if (!metric || !looksLikeCounter(metric)) {
    suggestions.value = []
    return
  }

  const items: Array<{ label: string; query: string; kind: 'rate' | 'group' }> = []

  // Primary suggestion: wrap in rate()
  items.push({
    label: `rate(${metric}[5m])`,
    query: `rate(${metric}[5m])`,
    kind: 'rate',
  })

  // Fetch labels for group-by suggestions
  let labels = labelCache.get(metric)
  if (!labels) {
    try {
      labels = await api.promLabels(metric)
      labelCache.set(metric, labels)
    } catch { labels = [] }
  }

  const groupLabels = labels.filter(l => l !== '__name__' && l !== 'service_name')
  for (const lbl of groupLabels.slice(0, 4)) {
    items.push({
      label: `sum by (${lbl}) (rate(...[5m]))`,
      query: `sum by (${lbl}) (rate(${metric}[5m]))`,
      kind: 'group',
    })
  }

  suggestions.value = items
}

function applySuggestion(s: { query: string }) {
  query.value = s.query
  suggestions.value = []
  nextTick(() => {
    const el = queryTextarea.value
    if (el) {
el.setSelectionRange(s.query.length, s.query.length)
      el.focus()
    }
  })
}

// ═══ Helpers data ═══
const metricNames = ref<string[]>([])
const labelNames = ref<string[]>([])
const showMetricDropdown = ref(false)
const metricFilter = ref('')

const filteredMetrics = computed(() => {
  if (!metricFilter.value) return metricNames.value
  const f = metricFilter.value.toLowerCase()
  return metricNames.value.filter(m => m.toLowerCase().includes(f))
})

// ═══ Results ═══
const vectorResults = ref<PromVectorResult[]>([])
const matrixResults = ref<PromMatrixResult[]>([])
const hasResults = ref(false)

function vectorResultAt(index: number): PromVectorResult {
  return vectorResults.value[index]!
}

function vectorResultKeyAt(index: number): string {
  const result = vectorResults.value[index]
  return result ? JSON.stringify(result.metric) : `metric:${index}`
}

const palette = [
  '#3b82f6', '#47b881', '#5b8def', '#e5584f',
  '#a78bfa', '#f59e0b', '#06b6d4', '#ec4899',
]

function seriesLabel(metric: Record<string, string>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(metric)) {
    if (k === '__name__') continue
    parts.push(`${k}="${v}"`)
  }
  const name = metric.__name__ || ''
  if (!parts.length) return name || '{}'
  return name ? `${name}{${parts.join(', ')}}` : `{${parts.join(', ')}}`
}

const metricChartSeries = computed<TimeSeriesPanelSeries[]>(() => matrixResults.value.map((series, index) => {
  const points = series.values
    .map(([timestamp, value]) => [timestamp, Number.parseFloat(value)] as [number, number])
    .filter(([, value]) => Number.isFinite(value))
  return {
    name: seriesLabel(series.metric),
    points,
    color: palette[index % palette.length],
    legendValue: points.length ? points[points.length - 1]![1] : undefined,
  }
}))

const metricTableRows = computed<Record<string, unknown>[]>(() => vectorResults.value.map(result => ({
  metric: result.metric,
  value: result.value,
})))
const resultsRangeLabel = computed(() => formatPanelRange(selectedPreset.value))
const resultsCaption = computed(() => query.value.trim() || 'Run a PromQL expression to inspect metric data.')

// ═══ Table helpers ═══
function labelBadges(metric: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([key, value]) => ({ key, value }))
}

// ═══ Execute query ═══
async function executeQuery(opts?: { skipHistory?: boolean }) {
  if (!query.value.trim()) return

  // If it's a bare counter metric, show suggestions alongside results
  const bare = isBareName(query.value)
  if (bare && looksLikeCounter(bare)) {
    updateSuggestions()
  } else {
    suggestions.value = []
  }

  if (!opts?.skipHistory) {
    pushHistory({ query: query.value, timePreset: selectedPreset.value })
  }

  executing.value = true
  errorMsg.value = ''
  vectorResults.value = []
  matrixResults.value = []
  hasResults.value = false

  try {
    if (activeTab.value === 'table') {
      const data = await api.promQuery(query.value)
      if (data.resultType === 'vector') {
        vectorResults.value = data.result
      }
    } else {
      const now = Math.floor(Date.now() / 1000)
      const start = now - selectedPreset.value * 60
      const step = Math.max(1, Math.floor((now - start) / 250))
      const data = await api.promQueryRange(query.value, start, now, step)
      if (data.resultType === 'matrix') {
        matrixResults.value = data.result
      }
    }
    hasResults.value = true
  } catch (e: any) {
    errorMsg.value = e.message || 'Query failed'
  } finally {
    executing.value = false
  }
  syncUrlState()
}

function clearQuery() {
  query.value = ''
  vectorResults.value = []
  matrixResults.value = []
  hasResults.value = false
  errorMsg.value = ''
  suggestions.value = []
  syncUrlState()
}

function loadHistoryEntry(entry: HistoryEntry<MetricsHistoryQuery>) {
  query.value = entry.query.query
  selectedPreset.value = entry.query.timePreset
  executeQuery({ skipHistory: true })
}

function createAlertFromQuery() {
  router.push({ name: 'monitor-create', query: { promql: query.value.trim(), signal: 'metrics' } })
}

function seriesPromql(metric: Record<string, string>): string {
  const name = metric.__name__ || ''
  const labels = Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
  const selector = name + (labels ? `{${labels}}` : '')
  if (looksLikeCounter(name)) return `rate(${selector}[5m])`
  return selector
}

function createAlertFromSeries(metric: Record<string, string>) {
  router.push({ name: 'monitor-create', query: { promql: seriesPromql(metric), signal: 'metrics' } })
}

function handleExploreSelect(_metric: string, queryStr: string) {
  query.value = queryStr
  viewMode.value = 'query'
  activeTab.value = 'graph'
  nextTick(() => executeQuery())
}

function insertMetric(name: string) {
  query.value = name
  showMetricDropdown.value = false
  metricFilter.value = ''
}


// ═══ Natural language to PromQL ═══
const nlMode = ref(false)
const nlInput = ref('')
const nlLoading = ref(false)
const nlResult = ref('')
const nlConfidence = ref(0)

function enterNlMode() {
  nlMode.value = true
  nlInput.value = ''
  nlResult.value = ''
  nlConfidence.value = 0
  nextTick(() => queryTextarea.value?.focus())
}

function exitNlMode() {
  nlMode.value = false
  nlInput.value = ''
  nlResult.value = ''
}

function nlRuleFallback(input: string): string | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  // Extract window: "over 5min", "over 1h", "5m window", "last 10m"
  const windowMatch = s.match(/(?:over|last|window|past)\s+(\d+)\s*(min(?:utes?)?|m|h(?:ours?)?|s(?:econds?)?)/)
  const windowNum = windowMatch ? windowMatch[1] : '5'
  const windowUnit = windowMatch
    ? (windowMatch[2]?.startsWith('h') ? 'h' : windowMatch[2]?.startsWith('s') ? 's' : 'm')
    : 'm'
  const window = `[${windowNum}${windowUnit}]`

  // Extract metric name — last bare word that looks like a metric
  const metricMatch = s.match(/(?:for|of|on|metric)\s+([a-z_:][a-z0-9_:]*)/) ||
                      s.match(/([a-z_:][a-z0-9_:]{3,})(?:\s|$)/)
  const metric = metricMatch ? metricMatch[1] : null

  if (!metric) return null

  // p99 / p95 / p50
  const pMatch = s.match(/p(99|95|90|75|50)/)
  if (pMatch) {
    const q = Number(pMatch[1]) / 100
    return `histogram_quantile(${q}, rate(${metric}_bucket${window}))`
  }

  // rate
  if (s.includes('rate') || s.includes('per second') || s.includes('rps')) {
    const sumByMatch = s.match(/(?:by|per|group by|grouped by)\s+([a-z_][a-z0-9_]*)/)
    if (sumByMatch) return `sum by (${sumByMatch[1]}) (rate(${metric}${window}))`
    return `rate(${metric}${window})`
  }

  // increase
  if (s.includes('increase') || s.includes('total over') || s.includes('delta')) {
    return `increase(${metric}${window})`
  }

  // sum
  if (s.includes('sum') || s.includes('total')) {
    const sumByMatch = s.match(/(?:by|per|group by|grouped by)\s+([a-z_][a-z0-9_]*)/)
    if (sumByMatch) return `sum by (${sumByMatch[1]}) (${metric})`
    return `sum(${metric})`
  }

  // avg / average
  if (s.includes('avg') || s.includes('average')) {
    return `avg(${metric})`
  }

  // count
  if (s.includes('count')) return `count(${metric})`

  // max / min
  if (s.includes('max')) return `max(${metric})`
  if (s.includes('min')) return `min(${metric})`

  // topk
  const topkMatch = s.match(/top\s*(\d+)/)
  if (topkMatch) return `topk(${topkMatch[1]}, ${metric})`

  return null
}

async function translateNl() {
  if (!nlInput.value.trim()) return
  nlLoading.value = true
  nlResult.value = ''
  nlConfidence.value = 0

  try {
    const res = await authenticatedFetch('/api/v1/parse-promql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: nlInput.value, metric_names: metricNames.value.slice(0, 100) }),
    })
    if (res.ok) {
      const data = await res.json()
      nlResult.value = data.promql ?? ''
      nlConfidence.value = data.confidence ?? 0
      return
    }
  } catch { /* fall through to rule-based */ }

  // Rule-based fallback
  const fallback = nlRuleFallback(nlInput.value)
  if (fallback) {
    nlResult.value = fallback
    nlConfidence.value = 0.6
  }
  nlLoading.value = false
}

let nlDebounceTimer: ReturnType<typeof setTimeout> | null = null
function onNlInput() {
  if (nlDebounceTimer) clearTimeout(nlDebounceTimer)
  nlResult.value = ''
  nlConfidence.value = 0
  const rule = nlRuleFallback(nlInput.value)
  if (rule) { nlResult.value = rule; nlConfidence.value = 0.6 }
  nlDebounceTimer = setTimeout(translateNl, 600)
}

function applyNl() {
  if (!nlResult.value) return
  query.value = nlResult.value
  exitNlMode()
  nextTick(() => executeQuery())
}

function onNlKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && nlResult.value) { e.preventDefault(); applyNl() }
  if (e.key === 'Escape') { e.preventDefault(); exitNlMode() }
}

function toggleNlMode() {
  if (nlMode.value) { exitNlMode() } else { enterNlMode() }
}

function handleUnifiedInput(val: string) {
  if (nlMode.value) {
    nlInput.value = val
    onNlInput()
  } else {
    query.value = val
  }
}

function handleUnifiedKeydown(e: KeyboardEvent) {
  if (nlMode.value) onNlKeydown(e)
}

// ═══ Load helpers ═══
async function loadHelpers() {
  try {
    const [namesResult, labelsResult] = await Promise.allSettled([
      api.promLabelValues('__name__'),
      api.promLabels(),
    ])
    if (namesResult.status === 'fulfilled') {
      metricNames.value = namesResult.value.sort()
    }
    if (labelsResult.status === 'fulfilled') {
      labelNames.value = labelsResult.value.filter(l => l !== '__name__').sort()
    }
  } catch { /* helpers optional */ }
}

// ═══ Share link ═══
const shareCopied = ref(false)

function buildShareUrl(): string {
  const params = new URLSearchParams()
  if (query.value) params.set('q', query.value)
  if (activeTab.value !== 'graph') params.set('tab', activeTab.value)
  if (selectedPreset.value !== 60) params.set('t', String(selectedPreset.value))
  if (viewMode.value !== 'query') params.set('mode', viewMode.value)
  const qs = params.toString()
  return `${window.location.origin}/metrics${qs ? '?' + qs : ''}`
}

function syncUrlState() {
  const params: Record<string, string> = {}
  if (query.value) params.q = query.value
  if (activeTab.value !== 'graph') params.tab = activeTab.value
  if (selectedPreset.value !== 60) params.t = String(selectedPreset.value)
  if (viewMode.value !== 'query') params.mode = viewMode.value
  router.replace({ path: '/metrics', query: Object.keys(params).length ? params : undefined })
}

async function shareLink() {
  const url = buildShareUrl()
  try {
    await navigator.clipboard.writeText(url)
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch {}
}

function restoreFromUrl() {
  const q = route.query
  if (q.q) query.value = String(q.q)
  if (q.tab === 'table') activeTab.value = 'table'
  if (q.t) selectedPreset.value = Number(q.t) || 60
  if (q.mode === 'explore') viewMode.value = 'explore'
}

onMounted(() => {
  labelCache.clear()
  restoreFromUrl()
  loadHelpers()
  if (query.value.trim()) executeQuery()
})

// Re-execute on tab or time range change if we have a query
watch([activeTab, selectedPreset], () => {
  if (hasResults.value && query.value.trim()) {
    executeQuery()
  } else {
    syncUrlState()
  }
})

watch(viewMode, () => {
  syncUrlState()
})
</script>

<template>
  <div class="metrics-view">
    <!-- ═══ Header ═══ -->
    <div class="metrics-header">
      <h1 class="metrics-title">Metrics</h1>
      <div class="metrics-controls">
        <TimePicker v-model="selectedPreset" v-model:custom-range="customRange" />
        <button class="share-btn" @click="shareLink" :title="shareCopied ? 'Copied!' : 'Copy shareable link'">
          {{ shareCopied ? '&#10003; Copied' : '&#128279; Share' }}
        </button>
      </div>
    </div>

    <!-- Metrics-disabled notice: this page queries metric data. -->
    <div v-if="!metricsEnabled" class="empty-state card">
      <div class="empty-state-icon">&#9888;</div>
      <div>Metrics are disabled for this tenant</div>
      <div class="metrics-notice-sub">
        This page queries metric data. Enable the Metrics signal for this tenant
        in Settings &rsaquo; Tenants to run PromQL queries and explore metrics.
      </div>
    </div>

    <!-- ═══ Mode Toggle ═══ -->
    <div v-if="metricsEnabled" class="mode-bar">
      <button
        class="mode-btn"
        :class="{ active: viewMode === 'query' }"
        @click="viewMode = 'query'"
      >
        Query
      </button>
      <button
        class="mode-btn"
        :class="{ active: viewMode === 'explore' }"
        @click="viewMode = 'explore'"
      >
        Explore
      </button>
    </div>

    <!-- ═══ Explore Mode ═══ -->
    <MetricsExplore
      v-if="metricsEnabled && viewMode === 'explore'"
      :metric-names="metricNames"
      :time-preset="selectedPreset"
      @select="handleExploreSelect"
    />

    <!-- ═══ Query Bar ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query'" class="query-section card">
      <div class="query-row">
        <div class="query-input-wrapper">
          <PromqlEditor
            ref="queryTextarea"
            :model-value="nlMode ? nlInput : query"
            :completion-enabled="!nlMode"
            :input-class="nlMode ? 'query-input mono nl-active' : 'query-input mono'"
            :placeholder="nlMode ? 'Describe what you want to query... (Enter to apply, Esc to cancel)' : 'Enter a PromQL expression...'"
            :rows="2"
            @update:model-value="handleUnifiedInput"
            @keydown="handleUnifiedKeydown"
            @execute="executeQuery"
          />
          <!-- ✦ AI button overlaid inside textarea -->
          <button
            class="nl-inline-btn"
            :class="{ active: nlMode }"
            @mousedown.prevent="toggleNlMode"
            :title="nlMode ? 'Exit AI mode (Esc)' : 'AI: describe in plain English'"
          >✦</button>
          <!-- NL spinner -->
          <span v-if="nlMode && nlLoading" class="nl-inline-spinner">···</span>
        </div>
        <div class="query-actions">
          <button class="btn btn-execute" @click="() => nlMode ? applyNl() : executeQuery()" :disabled="executing || (nlMode ? !nlResult : !query.trim())">
            {{ executing ? 'Running...' : 'Execute' }}
          </button>
          <button class="btn btn-clear" @click="clearQuery" :disabled="!query">
            Clear
          </button>
          <button
            v-if="query.trim()"
            class="btn btn-alert"
            title="Create alert from this query"
            @click="createAlertFromQuery"
          >&#9888; Alert</button>
          <QueryHistory
            :entries="metricsHistory ?? []"
            @load="loadHistoryEntry"
            @remove="removeHistory"
            @clear="clearHistory"
          >
            <template #summary="{ entry }">
              <span class="mono">{{ entry.query.query.length > 50 ? entry.query.query.slice(0, 50) + '...' : entry.query.query }}</span>
            </template>
          </QueryHistory>
        </div>
      </div>

      <!-- NL preview -->
      <div v-if="nlMode && nlResult" class="nl-preview">
        <span class="nl-preview-label">✦</span>
        <code class="nl-preview-expr mono">{{ nlResult }}</code>
        <span v-if="nlConfidence >= 0.7" class="nl-conf high">high confidence</span>
        <span v-else-if="nlConfidence >= 0.5" class="nl-conf mid">best guess</span>
        <button class="btn btn-execute nl-apply-btn" @click="applyNl">Apply →</button>
      </div>

      <!-- Helper bar -->
      <div class="helper-bar">
        <div class="helper-group">
          <div class="metric-dropdown-wrapper">
            <button class="helper-btn" @click="showMetricDropdown = !showMetricDropdown">
              Metrics &#9662;
            </button>
            <div v-if="showMetricDropdown" class="metric-dropdown">
              <input
                v-model="metricFilter"
                class="metric-search mono"
                placeholder="Filter metrics..."
              />
              <div class="metric-list">
                <div
                  v-for="m in filteredMetrics"
                  :key="m"
                  class="metric-item mono"
                  @click="insertMetric(m)"
                >
                  {{ m }}
                </div>
                <div v-if="!filteredMetrics.length" class="metric-empty">
                  No metrics found
                </div>
              </div>
            </div>
          </div>
          <div v-if="labelNames.length" class="label-hints">
            <span class="label-hint-label">Labels:</span>
            <span v-for="l in labelNames.slice(0, 8)" :key="l" class="label-badge mono">{{ l }}</span>
            <span v-if="labelNames.length > 8" class="label-hint-more">+{{ labelNames.length - 8 }} more</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Smart Suggestions ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query' && suggestions.length" class="suggestions-bar card">
      <span class="suggestions-label">Suggestions</span>
      <div class="suggestions-list">
        <button
          v-for="(s, i) in suggestions"
          :key="i"
          class="suggestion-chip mono"
          :class="s.kind"
          @click="applySuggestion(s)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <!-- ═══ Tab Toggle ═══ -->
    <div v-if="metricsEnabled && viewMode === 'query'" class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'graph' }"
        @click="activeTab = 'graph'"
      >
        Graph
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'table' }"
        @click="activeTab = 'table'"
      >
        Table
      </button>
    </div>

    <!-- ═══ Graph Tab ═══ -->
    <TimeSeriesPanel
      v-if="metricsEnabled && viewMode === 'query' && activeTab === 'graph'"
      class="metrics-results-panel"
      title="PromQL results"
      description="Time-series values returned by the current PromQL expression. Hover to compare series at the same timestamp."
      :caption="resultsCaption"
      source-label="Metrics"
      :range-label="resultsRangeLabel"
      :series="metricChartSeries"
      :loading="executing"
      :error="errorMsg || null"
      :empty-title="hasResults ? 'No samples returned' : 'Run a PromQL query'"
      :empty-message="hasResults ? 'Try another expression or a wider time range.' : 'Enter an expression above, then select Execute.'"
    >
      <template v-if="matrixResults.length" #details>
        <div class="metric-series-actions" aria-label="Create an alert from a result series">
          <span class="metric-series-actions-label">Alert from series</span>
          <button
            v-for="(series, idx) in matrixResults"
            :key="`alert-${seriesLabel(series.metric)}-${idx}`"
            class="metric-series-action"
            :title="`Create alert for ${seriesLabel(series.metric)}`"
            @click="createAlertFromSeries(series.metric)"
          >
            <span class="metric-series-action-swatch" :style="{ background: palette[idx % palette.length] }"></span>
            <span class="metric-series-action-name mono">{{ seriesLabel(series.metric) }}</span>
            <span aria-hidden="true">&#9888;</span>
          </button>
        </div>
      </template>
    </TimeSeriesPanel>

    <!-- ═══ Table Tab ═══ -->
    <TablePanel
      v-if="metricsEnabled && viewMode === 'query' && activeTab === 'table'"
      class="metrics-results-panel metrics-results-table"
      title="Instant query results"
      description="Current values and label sets returned by the PromQL expression."
      :caption="resultsCaption"
      source-label="Metrics"
      :range-label="resultsRangeLabel"
      :rows="metricTableRows"
      :loading="executing"
      :error="errorMsg || null"
      :empty-title="hasResults ? 'No rows returned' : 'Run a PromQL query'"
      :empty-message="hasResults ? 'Try another expression or adjust its label matchers.' : 'Enter an expression above, then select Execute.'"
    >
      <div class="result-table">
        <div class="result-table-row result-table-head" role="row">
          <div role="columnheader">Metric</div>
          <div role="columnheader">Labels</div>
          <div class="col-value" role="columnheader">Value</div>
        </div>
        <VirtualTable
          :count="vectorResults.length"
          :item-key="vectorResultKeyAt"
          variable
          aria-label="Metric query results"
        >
          <template #default="{ index: i }">
          <template v-for="r in [vectorResultAt(i)]" :key="vectorResultKeyAt(i)">
          <div class="result-table-row" role="row">
            <div class="mono metric-name" role="cell">{{ r.metric.__name__ || '-' }}</div>
            <div role="cell">
              <div class="label-badges">
                <span
                  v-for="b in labelBadges(r.metric)"
                  :key="b.key"
                  class="tbl-label-badge mono"
                >
                  {{ b.key }}=<span class="label-val">{{ b.value }}</span>
                </span>
              </div>
            </div>
            <div class="mono col-value" role="cell">{{ r.value[1] }}</div>
          </div>
          </template>
          </template>
        </VirtualTable>
      </div>
    </TablePanel>
  </div>
</template>

<style scoped src="../styles/views/MetricsView.css"></style>
