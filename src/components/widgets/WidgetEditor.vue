<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import type { Widget, WidgetType, WidgetPosition, WidgetQueryConfig, Filter, QueryFilter, DashboardVariable, WidgetData } from '../../types'
import QueryBuilder from '../QueryBuilder.vue'
import { useWidgetData } from '../../composables/useWidgetData'
import { useApi } from '../../composables/useApi'
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

const api = useApi()
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

const VIZ = [
  { type: 'timeseries' as WidgetType, label: 'Timeseries', glyph: '∿' },
  { type: 'counter' as WidgetType, label: 'Counter', glyph: '#' },
  { type: 'bar' as WidgetType, label: 'Bar', glyph: '▊' },
  { type: 'table' as WidgetType, label: 'Table', glyph: '☰' },
]

// Metrics source only makes sense for timeseries/counter.
const metricsOk = computed(() => widgetType.value === 'timeseries' || widgetType.value === 'counter')

watch(() => props.widget, (w) => {
  if (w) {
    title.value = w.title
    widgetType.value = w.widget_type
    source.value = w.query_config.source === 'metrics' ? 'metrics' : 'spans'
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
onUnmounted(() => clearTimeout(previewTimer))

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
  <div class="we-backdrop" @click.self="emit('cancel')">
    <div class="we-modal card">
      <div class="we-header">
        <div class="we-title">{{ widget ? 'Edit widget' : 'Add widget' }}</div>
        <button class="we-close" @click="emit('cancel')">&times;</button>
      </div>

      <div class="we-body">
        <!-- ── Left: form ── -->
        <div class="we-form">
          <input v-model="title" class="we-input we-title-input" placeholder="Widget title" />

          <!-- Visualization picker -->
          <div class="we-section-label">Visualization</div>
          <div class="we-viz-grid">
            <button v-for="v in VIZ" :key="v.type" class="we-viz-card" :class="{ active: widgetType === v.type }" @click="widgetType = v.type">
              <span class="we-viz-glyph">{{ v.glyph }}</span>
              <span class="we-viz-label">{{ v.label }}</span>
            </button>
          </div>

          <!-- Source toggle -->
          <div class="we-section-label">Query</div>
          <div class="we-source-toggle">
            <button class="we-seg" :class="{ active: source === 'spans' }" @click="source = 'spans'">Spans</button>
            <button class="we-seg" :class="{ active: source === 'logs' }" @click="source = 'logs'">Logs</button>
            <button class="we-seg" :class="{ active: source === 'metrics' }" :disabled="!metricsOk" :title="metricsOk ? '' : 'Metrics works with Timeseries or Counter'" @click="metricsOk && (source = 'metrics')">Metrics</button>
          </div>

          <!-- Variable chips -->
          <div v-if="availableVars.length" class="we-vars">
            <span class="we-vars-label">Variables:</span>
            <button v-for="t in availableVars" :key="t" class="we-var-chip" :title="source === 'metrics' ? 'Insert into query' : 'Use in a filter value'" @click="insertVar(t)">{{ t }}</button>
          </div>

          <!-- Metrics (PromQL) -->
          <template v-if="source === 'metrics'">
            <textarea v-model="promql" class="we-input we-promql mono" rows="3" placeholder='sum(rate(http_requests_total{service_name="$service"}[5m]))'></textarea>
            <div class="we-nl">
              <input v-model="nlText" class="we-input mono" placeholder="…or describe it in plain English" @keyup.enter="applyNl" />
              <button class="we-nl-btn" :disabled="nlBusy" @click="applyNl">{{ nlBusy ? '…' : '✨' }}</button>
            </div>
          </template>

          <!-- Spans -->
          <template v-else>
            <QueryBuilder v-model:filters="builderFilters" />
            <div v-if="widgetType === 'bar'" class="we-field">
              <label class="we-label">Group by</label>
              <input v-model="groupBy" class="we-input mono" placeholder="service_name" />
            </div>
          </template>

          <!-- Common options -->
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
              <label class="we-label">Limit</label>
              <input v-model.number="limit" type="number" min="1" max="100" class="we-input mono" />
            </div>
            <div class="we-field">
              <label class="we-label">Width</label>
              <select v-model.number="colSpan" class="we-input mono">
                <option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
                <option :value="6">6</option><option :value="8">8</option><option :value="12">12</option>
              </select>
            </div>
            <div class="we-field">
              <label class="we-label">Height</label>
              <select v-model.number="rowSpan" class="we-input mono">
                <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
              </select>
            </div>
          </div>

          <!-- Description + unit (surfaced on the panel header) -->
          <div class="we-section-label">Details</div>
          <div class="we-field">
            <label class="we-label">Description</label>
            <textarea v-model="description" class="we-input" rows="2" placeholder="What this panel shows (optional)"></textarea>
          </div>
          <div class="we-field">
            <label class="we-label">Unit</label>
            <input v-model="unit" class="we-input mono" placeholder="e.g. req/s, ms, %, B/s (optional)" />
          </div>
        </div>

        <!-- ── Right: live preview ── -->
        <div class="we-preview">
          <div class="we-preview-label">Preview</div>
          <div class="we-preview-stage card">
            <div v-if="previewLoading" class="we-preview-msg text-muted">Loading…</div>
            <div v-else-if="previewError" class="we-preview-msg" style="color: var(--error)">{{ previewError }}</div>
            <template v-else-if="previewData">
              <CounterWidget v-if="widgetType === 'counter'" :value="previewData.count || 0" :label="title || 'Counter'" />
              <BarWidget v-else-if="widgetType === 'bar'" :groups="previewData.groups || []" />
              <TableWidget v-else-if="widgetType === 'table'" :rows="(previewData.rows || []) as Record<string, unknown>[]" />
              <TimeseriesWidget v-else-if="widgetType === 'timeseries'" :buckets="previewData.buckets || []" :series="previewData.series" :unit="unit" />
            </template>
            <div v-else class="we-preview-msg text-muted">Configure the query to preview</div>
          </div>
        </div>
      </div>

      <div class="we-footer">
        <button class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-primary" @click="save">{{ widget ? 'Update' : 'Add widget' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/WidgetEditor.css"></style>
