<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Widget, WidgetType, WidgetPosition, WidgetQueryConfig, WidgetPanelQuery, Filter, QueryFilter, DashboardVariable, WidgetData } from '../../types'
import QueryBuilder from '../QueryBuilder.vue'
import { useWidgetData } from '../../composables/useWidgetData'
import { authenticatedFetch } from '../../composables/authSession'
import CounterWidget from './CounterWidget.vue'
import BarWidget from './BarWidget.vue'
import TableWidget from './TableWidget.vue'
import TimeseriesWidget from './TimeseriesWidget.vue'

const props = defineProps<{
  widget?: Widget | null
  dashboardId: string
  variables?: DashboardVariable[]
  varValues?: Record<string, string>
}>()

const emit = defineEmits<{
  save: [data: {
    title: string
    widget_type: WidgetType
    query_config: WidgetQueryConfig
    position: WidgetPosition
    display_config: Record<string, unknown>
  }]
  cancel: []
}>()

const { fetchWidgetData } = useWidgetData()

// ── Form state ──
const title = ref('')
const widgetType = ref<WidgetType>('timeseries')
const timeRangeMinutes = ref(60)
const nlText = ref('')
const nlBusy = ref(false)
const colSpan = ref(6)
const rowSpan = ref(2)
const description = ref('')
const unit = ref('')
const activeEditorTab = ref<'query' | 'panel'>('query')

interface EditorQuery extends Omit<WidgetPanelQuery, 'filters'> {
  filters: QueryFilter[]
}

const QUERY_COLORS = ['#3b82f6', '#47b881', '#e5584f', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#eab308']
const queries = ref<EditorQuery[]>([])
const activeQueryId = ref('A')

function nextRefId(): string {
  const used = new Set(queries.value.map(query => query.ref_id))
  for (let i = 0; i < 26; i += 1) {
    const refId = String.fromCharCode(65 + i)
    if (!used.has(refId)) return refId
  }
  return `Q${queries.value.length + 1}`
}

function makeQuery(seed: Partial<EditorQuery> = {}): EditorQuery {
  const refId = seed.ref_id || nextRefId()
  return {
    ref_id: refId,
    source: seed.source || 'spans',
    alias: seed.alias || '',
    color: seed.color || QUERY_COLORS[queries.value.length % QUERY_COLORS.length],
    axis: seed.axis || 'left',
    hidden: seed.hidden || false,
    filters: seed.filters || [],
    group_by: seed.group_by ?? [],
    aggregation: seed.aggregation || 'count',
    interval: seed.interval || '1m',
    limit: seed.limit || 10,
    promql: seed.promql || '',
  }
}

const activeQuery = computed(() => queries.value.find(query => query.ref_id === activeQueryId.value) || queries.value[0]!)
const source = computed({
  get: () => activeQuery.value.source,
  set: (value: WidgetPanelQuery['source']) => { activeQuery.value.source = value },
})
const interval = computed({
  get: () => activeQuery.value.interval || '1m',
  set: (value: string) => { activeQuery.value.interval = value },
})
const groupBy = computed({
  get: () => activeQuery.value.group_by?.[0] || '',
  set: (value: string) => { activeQuery.value.group_by = value ? [value] : [] },
})
const apmMetric = computed({
  get: () => activeQuery.value.aggregation || 'count',
  set: (value: string) => { activeQuery.value.aggregation = value },
})
const limit = computed({
  get: () => activeQuery.value.limit || 10,
  set: (value: number) => { activeQuery.value.limit = value },
})
const promql = computed({
  get: () => activeQuery.value.promql || '',
  set: (value: string) => { activeQuery.value.promql = value },
})
const builderFilters = computed({
  get: () => activeQuery.value.filters,
  set: (value: QueryFilter[]) => { activeQuery.value.filters = value },
})

const VIZ = [
  { type: 'timeseries' as WidgetType, label: 'Time series', glyph: '∿', note: 'Trend values over time' },
  { type: 'counter' as WidgetType, label: 'Stat', glyph: '#', note: 'One prominent value' },
  { type: 'bar' as WidgetType, label: 'Bar chart', glyph: '▊', note: 'Compare grouped values' },
  { type: 'table' as WidgetType, label: 'Table', glyph: '☰', note: 'Inspect detailed rows' },
]

const APM_METRICS = [
  { value: 'count', label: 'Requests', note: 'Request volume', unit: 'count' },
  { value: 'error_count', label: '5xx errors', note: 'Server errors', unit: 'count' },
  { value: 'error_rate', label: 'Error rate', note: '5xx / requests', unit: '%' },
  { value: 'avg', label: 'Avg latency', note: 'Mean duration', unit: 'ms' },
  { value: 'p50', label: 'P50 latency', note: 'Typical request', unit: 'ms' },
  { value: 'p95', label: 'P95 latency', note: 'Slow tail', unit: 'ms' },
  { value: 'p99', label: 'P99 latency', note: 'Extreme tail', unit: 'ms' },
]

const APM_GROUPS = [
  { value: '', label: 'No split — one series' },
  { value: 'service_name', label: 'Service' },
  { value: 'http_path', label: 'Endpoint / route' },
  { value: 'http_method', label: 'HTTP method' },
  { value: 'http_status_code', label: 'Status code' },
  { value: 'status', label: 'Span status' },
]

const APM_PRESETS = [
  { id: '4xx', label: '4xx only', filters: [['http_status_code', '>=', '400'], ['http_status_code', '<', '500']] },
  { id: '5xx', label: '5xx only', filters: [['http_status_code', '>=', '500'], ['http_status_code', '<', '600']] },
  { id: '500ms', label: 'Slow > 500ms', filters: [['duration_ns', '>=', '500000000']] },
  { id: '1s', label: 'Slow > 1s', filters: [['duration_ns', '>=', '1000000000']] },
] as const

function applyApmPreset(preset: typeof APM_PRESETS[number]) {
  const next = [...activeQuery.value.filters]
  preset.filters.forEach(([field, op, value]) => {
    const exists = next.some(filter => filter.field === field && filter.op === op && filter.value === value)
    if (!exists) next.push({ id: crypto.randomUUID(), field, op, value })
  })
  activeQuery.value.filters = next
}

function isApmPresetActive(preset: typeof APM_PRESETS[number]): boolean {
  return preset.filters.every(([field, op, value]) =>
    activeQuery.value.filters.some(filter => filter.field === field && filter.op === op && filter.value === value),
  )
}

// Metrics source only makes sense for timeseries/counter.
const metricsOk = computed(() => widgetType.value === 'timeseries' || widgetType.value === 'counter')

watch(() => props.widget, (widget) => {
  if (!widget) {
    queries.value = [makeQuery({ ref_id: 'A' })]
    activeQueryId.value = 'A'
    return
  }
  title.value = widget.title
  widgetType.value = widget.widget_type
  timeRangeMinutes.value = widget.query_config.time_range_minutes || 60
  colSpan.value = widget.position.col_span || 6
  rowSpan.value = widget.position.row_span || 2
  description.value = (widget.display_config?.description as string) || ''
  unit.value = (widget.display_config?.unit as string) || ''

  const stored = widget.query_config.queries?.length
    ? widget.query_config.queries
    : [{
        ref_id: 'A',
        source: widget.query_config.source || 'spans',
        filters: widget.query_config.filters || [],
        group_by: widget.query_config.group_by,
        aggregation: widget.query_config.aggregation,
        interval: widget.query_config.interval,
        limit: widget.query_config.limit,
        promql: widget.query_config.promql,
      } satisfies WidgetPanelQuery]
  queries.value = stored.map((query, index) => makeQuery({
    ...query,
    color: query.color || QUERY_COLORS[index % QUERY_COLORS.length],
    filters: (query.filters || []).map((filter: Filter) => ({
      id: crypto.randomUUID(), field: filter.field, op: filter.op, value: String(filter.value),
    })),
  }))
  activeQueryId.value = queries.value[0]!.ref_id
}, { immediate: true })

// If a non-metrics-capable viz is chosen while in metrics mode, fall back to spans.
watch([widgetType], () => {
  if (!metricsOk.value) {
    queries.value.forEach((query) => { if (query.source === 'metrics') query.source = 'spans' })
  }
})

function addQuery() {
  if (widgetType.value !== 'timeseries' || queries.value.length >= 8) return
  const query = makeQuery({ source: source.value })
  queries.value.push(query)
  activeQueryId.value = query.ref_id
}

function duplicateQuery(query: EditorQuery) {
  if (widgetType.value !== 'timeseries' || queries.value.length >= 8) return
  const copy = makeQuery({
    ...query,
    ref_id: nextRefId(),
    alias: query.alias ? `${query.alias} copy` : '',
    color: QUERY_COLORS[queries.value.length % QUERY_COLORS.length],
    filters: query.filters.map(filter => ({ ...filter, id: crypto.randomUUID() })),
  })
  queries.value.push(copy)
  activeQueryId.value = copy.ref_id
}

function removeQuery(query: EditorQuery) {
  if (queries.value.length === 1) return
  const index = queries.value.findIndex(item => item.ref_id === query.ref_id)
  queries.value = queries.value.filter(item => item.ref_id !== query.ref_id)
  if (activeQueryId.value === query.ref_id) {
    activeQueryId.value = queries.value[Math.min(index, queries.value.length - 1)]!.ref_id
  }
}

function buildPanelQuery(query: EditorQuery): WidgetPanelQuery {
  const filters: Filter[] = query.filters
    .filter(filter => filter.field && filter.value)
    .map((filter) => {
      const numericValue = Number(filter.value)
      return { field: filter.field, op: filter.op, value: isNaN(numericValue) ? filter.value : numericValue }
    })
  return {
    ref_id: query.ref_id,
    source: query.source,
    alias: query.alias?.trim() || undefined,
    color: query.color,
    axis: query.axis || 'left',
    hidden: query.hidden,
    filters,
    group_by: query.group_by,
    aggregation: query.aggregation,
    interval: query.interval,
    limit: query.limit,
    promql: query.source === 'metrics' ? query.promql : undefined,
  }
}

function buildQueryConfig(): WidgetQueryConfig {
  const panelQueries = queries.value.map(buildPanelQuery)
  const first = panelQueries[0]!
  return {
    time_range_minutes: timeRangeMinutes.value,
    queries: panelQueries,
    // Mirror query A at the top level for backwards compatibility with older clients.
    filters: first.filters,
    group_by: first.group_by,
    aggregation: first.aggregation,
    interval: first.interval,
    limit: first.limit,
    source: first.source,
    promql: first.promql,
  }
}

// ── Live preview (debounced) ──
const previewData = ref<WidgetData | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | undefined

function refreshPreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(async () => {
    previewLoading.value = true
    previewError.value = null
    try {
      const temp: Widget = {
        id: 'preview', dashboard_id: props.dashboardId, title: title.value,
        widget_type: widgetType.value, query_config: buildQueryConfig(),
        position: { col: 1, row: 1, col_span: colSpan.value, row_span: rowSpan.value },
        display_config: {}, created_at: '', updated_at: '',
      }
      previewData.value = await fetchWidgetData(temp, props.varValues || {})
    } catch (e: any) {
      previewError.value = e?.message || 'Preview failed'
      previewData.value = null
    } finally {
      previewLoading.value = false
    }
  }, 400)
}

watch([widgetType, timeRangeMinutes, queries], refreshPreview, { deep: true, immediate: true })

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => window.addEventListener('keydown', handleEditorKeydown))
onUnmounted(() => {
  clearTimeout(previewTimer)
  window.removeEventListener('keydown', handleEditorKeydown)
})

// ── Variable chips ──
const availableVars = computed(() => (props.variables || []).map(v => `$${v.name}`))
function insertVar(token: string) {
  if (source.value === 'metrics') {
    promql.value = (promql.value + (promql.value && !promql.value.endsWith(' ') ? ' ' : '') + token)
  }
}

async function applyNl() {
  if (!nlText.value.trim()) return
  nlBusy.value = true
  try {
    const res = await authenticatedFetch('/api/v1/parse-promql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: nlText.value }),
    })
    const data = await res.json()
    if (data.promql) promql.value = data.promql
  } catch { /* ignore */ } finally { nlBusy.value = false }
}

function save() {
  // Preserve any existing display_config keys (e.g. color), then layer in the
  // user-editable description/unit.
  const displayConfig: Record<string, unknown> = { ...(props.widget?.display_config || {}) }
  const desc = description.value.trim()
  const u = unit.value.trim()
  if (desc) displayConfig.description = desc; else delete displayConfig.description
  if (u) displayConfig.unit = u; else delete displayConfig.unit
  emit('save', {
    title: title.value || 'Untitled',
    widget_type: widgetType.value,
    query_config: buildQueryConfig(),
    position: { col: props.widget?.position.col || 1, row: props.widget?.position.row || 1, col_span: colSpan.value, row_span: rowSpan.value },
    display_config: displayConfig,
  })
}
</script>

<template>
  <div class="we-workbench" role="dialog" aria-modal="true" :aria-label="widget ? 'Edit panel' : 'Add panel'">
    <header class="we-header">
      <div class="we-heading">
        <div class="we-breadcrumb">DASHBOARD <span>/</span> {{ widget ? 'EDIT PANEL' : 'NEW PANEL' }}</div>
        <div class="we-title-row">
          <h2>{{ widget ? 'Edit panel' : 'Add visualization' }}</h2>
          <span class="we-context-chip">{{ queries.length > 1 ? `mixed · ${queries.length} queries` : source }}</span>
          <span class="we-context-chip">{{ VIZ.find(v => v.type === widgetType)?.label }}</span>
        </div>
      </div>
      <div class="we-header-actions">
        <button class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-primary" @click="save">{{ widget ? 'Apply changes' : 'Add to dashboard' }}</button>
      </div>
    </header>

    <div class="we-body">
      <main class="we-preview">
        <div class="we-preview-toolbar">
          <div>
            <span class="we-preview-label">LIVE PREVIEW</span>
            <span class="we-preview-note">Updates as you configure the panel</span>
          </div>
          <div class="we-preview-state mono" :class="{ error: previewError, warning: previewData?.query_errors?.length }">
            <span></span>{{ previewLoading ? 'Querying…' : previewError ? 'Query error' : previewData?.query_errors?.length ? `${previewData.query_errors.length} query issue` : 'Preview ready' }}
          </div>
        </div>
        <div class="we-preview-canvas">
          <section class="we-panel-preview" :style="{ '--preview-ratio': `${Math.max(3, colSpan)} / ${Math.max(2, rowSpan)}` }">
            <header class="we-panel-header">
              <div>
                <strong>{{ title || 'Untitled panel' }}</strong>
                <span v-if="description">{{ description }}</span>
              </div>
              <span class="we-panel-menu">•••</span>
            </header>
            <div class="we-preview-stage">
              <div v-if="previewLoading" class="we-preview-msg"><span class="we-spinner"></span>Running query</div>
              <div v-else-if="previewError" class="we-preview-msg we-preview-error"><strong>Preview failed</strong><span>{{ previewError }}</span></div>
              <template v-else-if="previewData">
                <CounterWidget v-if="widgetType === 'counter'" :value="previewData.count || 0" :label="title || 'Stat'" />
                <BarWidget v-else-if="widgetType === 'bar'" :groups="previewData.groups || []" />
                <TableWidget v-else-if="widgetType === 'table'" :rows="(previewData.rows || []) as Record<string, unknown>[]" />
                <TimeseriesWidget v-else-if="widgetType === 'timeseries'" :buckets="previewData.buckets || []" :series="previewData.series" :unit="unit" />
              </template>
              <div v-else class="we-preview-msg"><strong>No preview yet</strong><span>Configure a query in the panel editor.</span></div>
            </div>
          </section>
        </div>
        <footer class="we-query-summary mono">
          <span v-for="query in queries" :key="query.ref_id" class="we-summary-query" :class="{ hidden: query.hidden }">
            <i :style="{ background: query.color }"></i><strong>{{ query.ref_id }}</strong> {{ query.source }}<template v-if="query.alias"> · {{ query.alias }}</template>
          </span>
          <span>Range <strong>{{ timeRangeMinutes >= 60 ? `${timeRangeMinutes / 60}h` : `${timeRangeMinutes}m` }}</strong></span>
        </footer>
      </main>

      <aside class="we-config">
        <label class="we-title-field">
          <span>Panel title</span>
          <input v-model="title" class="we-input we-title-input" placeholder="Name this panel" />
        </label>

        <div class="we-tabs" role="tablist" aria-label="Panel editor sections">
          <button :class="{ active: activeEditorTab === 'query' }" role="tab" @click="activeEditorTab = 'query'">Query</button>
          <button :class="{ active: activeEditorTab === 'panel' }" role="tab" @click="activeEditorTab = 'panel'">Panel</button>
        </div>

        <div v-if="activeEditorTab === 'query'" class="we-config-scroll">
          <section class="we-query-stack-section">
            <div class="we-query-stack-header">
              <div><strong>Queries</strong><span>{{ queries.filter(query => !query.hidden).length }} running · {{ queries.length }}/8</span></div>
              <button class="we-add-query" :disabled="widgetType !== 'timeseries' || queries.length >= 8" :title="widgetType === 'timeseries' ? 'Add another query' : 'Multiple queries are available for Time series panels'" @click="addQuery">+ Add query</button>
            </div>
            <div class="we-query-stack">
              <div
                v-for="query in queries"
                :key="query.ref_id"
                class="we-query-row"
                :class="{ active: activeQueryId === query.ref_id, hidden: query.hidden }"
                role="button"
                tabindex="0"
                @click="activeQueryId = query.ref_id"
                @keydown.enter="activeQueryId = query.ref_id"
              >
                <span class="we-query-ref">{{ query.ref_id }}</span>
                <span class="we-query-color" :style="{ background: query.color }"></span>
                <span class="we-query-copy">
                  <strong>{{ query.alias || `${query.source === 'spans' ? 'APM' : query.source.charAt(0).toUpperCase() + query.source.slice(1)} query` }}</strong>
                  <small>{{ query.source }}<template v-if="query.source === 'metrics' && query.promql"> · PromQL configured</template><template v-else> · {{ query.filters.length }} filters</template></small>
                </span>
                <span class="we-query-actions">
                  <button :title="query.hidden ? 'Show query' : 'Hide query'" :aria-label="query.hidden ? `Show query ${query.ref_id}` : `Hide query ${query.ref_id}`" @click.stop="query.hidden = !query.hidden">{{ query.hidden ? '○' : '●' }}</button>
                  <button title="Duplicate query" :aria-label="`Duplicate query ${query.ref_id}`" :disabled="widgetType !== 'timeseries' || queries.length >= 8" @click.stop="duplicateQuery(query)">⧉</button>
                  <button title="Remove query" :aria-label="`Remove query ${query.ref_id}`" :disabled="queries.length === 1" @click.stop="removeQuery(query)">×</button>
                </span>
              </div>
            </div>
            <div v-if="widgetType !== 'timeseries'" class="we-query-note">Multi-query overlays are available on Time series panels. This visualization uses query {{ queries[0]?.ref_id }}.</div>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>{{ activeQuery.ref_id }}</span><div><strong>Query identity</strong><small>Each query can use a different signal and series style</small></div></div>
            <div class="we-source-toggle">
              <button class="we-seg" :class="{ active: source === 'spans' }" @click="source = 'spans'">APM</button>
              <button class="we-seg" :class="{ active: source === 'logs' }" @click="source = 'logs'">Logs</button>
              <button class="we-seg" :class="{ active: source === 'metrics' }" :disabled="!metricsOk" :title="metricsOk ? '' : 'Metrics supports Time series and Stat panels'" @click="metricsOk && (source = 'metrics')">Metrics</button>
            </div>
            <div class="we-query-identity">
              <div class="we-field">
                <label class="we-label">Series label</label>
                <input v-model="activeQuery.alias" class="we-input" :placeholder="`Query ${activeQuery.ref_id}`" />
              </div>
              <div class="we-field">
                <label class="we-label">Line color</label>
                <div class="we-color-picker" aria-label="Series color">
                  <button v-for="color in QUERY_COLORS" :key="color" :class="{ active: activeQuery.color === color }" :style="{ '--query-color': color }" :aria-label="`Use color ${color}`" @click="activeQuery.color = color"></button>
                </div>
              </div>
              <div class="we-field">
                <label class="we-label">Y-axis</label>
                <div class="we-axis-toggle" aria-label="Series Y-axis">
                  <button :class="{ active: activeQuery.axis !== 'right' }" @click="activeQuery.axis = 'left'">Left</button>
                  <button :class="{ active: activeQuery.axis === 'right' }" @click="activeQuery.axis = 'right'">Right</button>
                </div>
              </div>
            </div>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>02</span><div><strong>Build query {{ activeQuery.ref_id }}</strong><small>Define what this line should answer</small></div></div>
            <div v-if="availableVars.length" class="we-vars">
              <span class="we-vars-label">Dashboard variables</span>
              <button v-for="t in availableVars" :key="t" class="we-var-chip" :title="source === 'metrics' ? 'Insert into query' : 'Use in a filter value'" @click="insertVar(t)">{{ t }}</button>
            </div>
            <template v-if="source === 'metrics'">
              <textarea v-model="promql" class="we-input we-promql mono" rows="5" placeholder='sum(rate(http_requests_total{service_name="$service"}[5m]))'></textarea>
              <div class="we-nl">
                <input v-model="nlText" class="we-input" placeholder="Describe the metric you want" @keyup.enter="applyNl" />
                <button class="we-nl-btn" :disabled="nlBusy" @click="applyNl">{{ nlBusy ? 'Working…' : 'Generate' }}</button>
              </div>
            </template>
            <template v-else-if="source === 'spans'">
              <div class="we-apm-builder">
                <div v-if="widgetType === 'timeseries'" class="we-apm-block">
                  <div class="we-subheading"><div><strong>APM signal</strong><small>Choose the request behavior this series measures</small></div><span>RED</span></div>
                  <div class="we-apm-metrics" role="radiogroup" aria-label="APM signal">
                    <button
                      v-for="metric in APM_METRICS"
                      :key="metric.value"
                      class="we-apm-metric"
                      :class="{ active: apmMetric === metric.value }"
                      role="radio"
                      :aria-checked="apmMetric === metric.value"
                      @click="apmMetric = metric.value"
                    >
                      <span><strong>{{ metric.label }}</strong><small>{{ metric.note }}</small></span>
                      <em>{{ metric.unit }}</em>
                    </button>
                  </div>
                  <div class="we-field">
                    <label class="we-label">Split series by</label>
                    <select v-model="groupBy" class="we-input">
                      <option v-for="option in APM_GROUPS" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <small class="we-field-help">Use status code to compare 2xx, 4xx, and 5xx traffic as separate lines.</small>
                  </div>
                </div>

                <div class="we-apm-block">
                  <div class="we-subheading"><div><strong>Scope requests</strong><small>Start with a common incident filter, then refine it below</small></div></div>
                  <div class="we-apm-presets">
                    <button
                      v-for="preset in APM_PRESETS"
                      :key="preset.id"
                      :class="{ active: isApmPresetActive(preset) }"
                      @click="applyApmPreset(preset)"
                    >{{ isApmPresetActive(preset) ? '✓ ' : '+ ' }}{{ preset.label }}</button>
                  </div>
                </div>

                <div class="we-apm-block">
                  <div class="we-subheading"><div><strong>Span filters</strong><small>Filter by service, endpoint, method, exact status code, duration, or attributes</small></div></div>
                  <QueryBuilder v-model:filters="builderFilters" />
                </div>
                <div v-if="widgetType === 'bar'" class="we-field">
                  <label class="we-label">Group by</label>
                  <input v-model="groupBy" class="we-input mono" placeholder="service_name" />
                </div>
              </div>
            </template>
            <template v-else>
              <QueryBuilder v-model:filters="builderFilters" />
              <div v-if="widgetType === 'bar'" class="we-field">
                <label class="we-label">Group by</label>
                <input v-model="groupBy" class="we-input mono" placeholder="service_name" />
              </div>
            </template>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>03</span><div><strong>Query options</strong><small>Control resolution and result size for {{ activeQuery.ref_id }}</small></div></div>
            <div class="we-options">
              <div class="we-field">
                <label class="we-label">Time range</label>
                <select v-model.number="timeRangeMinutes" class="we-input mono">
                  <option :value="5">5m</option><option :value="15">15m</option><option :value="60">1h</option>
                  <option :value="360">6h</option><option :value="1440">24h</option><option :value="10080">7d</option>
                </select>
              </div>
              <div v-if="source !== 'metrics' && (widgetType === 'timeseries' || widgetType === 'counter')" class="we-field">
                <label class="we-label">Interval</label>
                <select v-model="interval" class="we-input mono">
                  <option value="1s">1s</option><option value="10s">10s</option><option value="1m">1m</option>
                  <option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option>
                </select>
              </div>
              <div v-if="widgetType === 'bar' || widgetType === 'table'" class="we-field">
                <label class="we-label">Result limit</label>
                <input v-model.number="limit" type="number" min="1" max="100" class="we-input mono" />
              </div>
            </div>
          </section>
        </div>

        <div v-else class="we-config-scroll">
          <section class="we-config-section">
            <div class="we-section-heading"><span>01</span><div><strong>Visualization</strong><small>Choose how the result should read</small></div></div>
            <div class="we-viz-list">
              <button v-for="v in VIZ" :key="v.type" class="we-viz-card" :class="{ active: widgetType === v.type }" @click="widgetType = v.type">
                <span class="we-viz-glyph">{{ v.glyph }}</span>
                <span><strong>{{ v.label }}</strong><small>{{ v.note }}</small></span>
                <span class="we-viz-check">{{ widgetType === v.type ? '✓' : '' }}</span>
              </button>
            </div>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>02</span><div><strong>Panel options</strong><small>Add context and format values</small></div></div>
            <div class="we-field">
              <label class="we-label">Description</label>
              <textarea v-model="description" class="we-input" rows="3" placeholder="Explain what this panel shows and why it matters"></textarea>
            </div>
            <div class="we-field">
              <label class="we-label">Unit</label>
              <input v-model="unit" class="we-input mono" placeholder="req/s, ms, %, B/s" />
            </div>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>03</span><div><strong>Grid placement</strong><small>Set the starting panel footprint</small></div></div>
            <div class="we-options">
              <div class="we-field">
                <label class="we-label">Width / 12 columns</label>
                <select v-model.number="colSpan" class="we-input mono">
                  <option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
                  <option :value="6">6</option><option :value="8">8</option><option :value="12">12</option>
                </select>
              </div>
              <div class="we-field">
                <label class="we-label">Height / rows</label>
                <select v-model.number="rowSpan" class="we-input mono">
                  <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
                </select>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/WidgetEditor.css"></style>
