<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Widget, WidgetType, WidgetPosition, WidgetQueryConfig, Filter, QueryFilter, DashboardVariable, WidgetData } from '../../types'
import QueryBuilder from '../QueryBuilder.vue'
import { useWidgetData } from '../../composables/useWidgetData'
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
const source = ref<'spans' | 'metrics' | 'logs'>('spans')
const timeRangeMinutes = ref(60)
const interval = ref('1m')
const groupBy = ref('service_name')
const limit = ref(10)
const builderFilters = ref<QueryFilter[]>([])
const promql = ref('')
const nlText = ref('')
const nlBusy = ref(false)
const colSpan = ref(6)
const rowSpan = ref(2)
const description = ref('')
const unit = ref('')
const activeEditorTab = ref<'query' | 'panel'>('query')

const VIZ = [
  { type: 'timeseries' as WidgetType, label: 'Time series', glyph: '∿', note: 'Trend values over time' },
  { type: 'counter' as WidgetType, label: 'Stat', glyph: '#', note: 'One prominent value' },
  { type: 'bar' as WidgetType, label: 'Bar chart', glyph: '▊', note: 'Compare grouped values' },
  { type: 'table' as WidgetType, label: 'Table', glyph: '☰', note: 'Inspect detailed rows' },
]

// Metrics source only makes sense for timeseries/counter.
const metricsOk = computed(() => widgetType.value === 'timeseries' || widgetType.value === 'counter')

watch(() => props.widget, (w) => {
  if (w) {
    title.value = w.title
    widgetType.value = w.widget_type
    source.value = w.query_config.source || 'spans'
    timeRangeMinutes.value = w.query_config.time_range_minutes || 60
    interval.value = w.query_config.interval || '1m'
    groupBy.value = w.query_config.group_by?.[0] || 'service_name'
    limit.value = w.query_config.limit || 10
    promql.value = w.query_config.promql || ''
    colSpan.value = w.position.col_span || 6
    rowSpan.value = w.position.row_span || 2
    description.value = (w.display_config?.description as string) || ''
    unit.value = (w.display_config?.unit as string) || ''
    builderFilters.value = (w.query_config.filters || []).map((f: Filter) => ({
      id: crypto.randomUUID(), field: f.field, op: f.op, value: String(f.value),
    }))
  }
}, { immediate: true })

// If a non-metrics-capable viz is chosen while in metrics mode, fall back to spans.
watch([widgetType], () => { if (source.value === 'metrics' && !metricsOk.value) source.value = 'spans' })

function buildQueryConfig(): WidgetQueryConfig {
  const filters: Filter[] = builderFilters.value
    .filter(f => f.field && f.value)
    .map(f => {
      const numVal = Number(f.value)
      return { field: f.field, op: f.op, value: isNaN(numVal) ? f.value : numVal }
    })
  return {
    time_range_minutes: timeRangeMinutes.value,
    filters,
    group_by: groupBy.value ? [groupBy.value] : undefined,
    interval: interval.value,
    limit: limit.value,
    source: source.value,
    promql: source.value === 'metrics' ? promql.value : undefined,
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

watch([widgetType, source, timeRangeMinutes, interval, groupBy, limit, promql, builderFilters], refreshPreview, { deep: true, immediate: true })

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
    const res = await fetch('/api/v1/parse-promql', {
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
          <span class="we-context-chip">{{ source }}</span>
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
          <div class="we-preview-state mono" :class="{ error: previewError }">
            <span></span>{{ previewLoading ? 'Querying…' : previewError ? 'Query error' : 'Preview ready' }}
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
          <span>Source <strong>{{ source }}</strong></span>
          <span>Range <strong>{{ timeRangeMinutes >= 60 ? `${timeRangeMinutes / 60}h` : `${timeRangeMinutes}m` }}</strong></span>
          <span v-if="source === 'metrics'">PromQL <strong>{{ promql ? 'configured' : 'empty' }}</strong></span>
          <span v-else>Filters <strong>{{ builderFilters.length }}</strong></span>
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
          <section class="we-config-section">
            <div class="we-section-heading"><span>01</span><div><strong>Data source</strong><small>Choose the signal behind this panel</small></div></div>
            <div class="we-source-toggle">
              <button class="we-seg" :class="{ active: source === 'spans' }" @click="source = 'spans'">Spans</button>
              <button class="we-seg" :class="{ active: source === 'logs' }" @click="source = 'logs'">Logs</button>
              <button class="we-seg" :class="{ active: source === 'metrics' }" :disabled="!metricsOk" :title="metricsOk ? '' : 'Metrics supports Time series and Stat panels'" @click="metricsOk && (source = 'metrics')">Metrics</button>
            </div>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>02</span><div><strong>Build query</strong><small>Define what the visualization should answer</small></div></div>
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
            <template v-else>
              <QueryBuilder v-model:filters="builderFilters" />
              <div v-if="widgetType === 'bar'" class="we-field">
                <label class="we-label">Group by</label>
                <input v-model="groupBy" class="we-input mono" placeholder="service_name" />
              </div>
            </template>
          </section>

          <section class="we-config-section">
            <div class="we-section-heading"><span>03</span><div><strong>Query options</strong><small>Control resolution and result size</small></div></div>
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
