<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { useApi } from '../composables/useApi'
import AutocompleteInput from './AutocompleteInput.vue'
import type { Monitor, MonitorPreview, NotificationChannel } from '../types'

const props = defineProps<{
  monitorId?: string
}>()

const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'cancel'): void
  (e: 'loaded', name: string): void
}>()

const api = useApi()

// ── Loading & saving state ──
const loading = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)

// ── Section 1: Type ──
const monitorType = ref<'metric' | 'log' | 'apm' | 'composite'>('metric')

// ── Section 2: Query config per type ──

// Metric config
const metricExpression = ref('')
const useVisualBuilder = ref(true)
const metricConfig = ref({
  metric_name: '',
  aggregation: 'avg',
  filters: [] as { key: string; value: string }[],
  group_by: [] as string[],
})

// Log config
const logConfig = ref({
  search: '',
  service: '',
  severities: [] as string[],
  group_by: [] as string[],
})

// APM config
const apmConfig = ref({
  service: '',
  metric: 'error_rate',
  endpoint_filter: '',
  group_by: [] as string[],
})

// Composite config
const compositeConfig = ref({
  formula: '',
  monitor_ids: [] as string[],
})

const evalWindow = ref(300) // 5m default

// ── Section 3: Conditions ──
const comparator = ref<'above' | 'below'>('above')
const criticalThreshold = ref<number | null>(null)
const warningThreshold = ref<number | null>(null)
const criticalRecovery = ref<number | null>(null)
const warningRecovery = ref<number | null>(null)
const recoveryExpanded = ref(false)

// ── Section 4: Preview ──
const preview = ref<MonitorPreview | null>(null)
const previewLoading = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

// ── Section 5: Smart Suggestions ──
const smartSuggestions = ref<{ text: string; severity: string }[]>([])
const suggestionsLoading = ref(false)
let suggestTimer: ReturnType<typeof setTimeout> | null = null

// ── Section 6: Notification ──
const monitorName = ref('')
const message = ref('')
const notificationChannels = ref<string[]>([])
const renotifyInterval = ref<number | null>(null)
const tags = ref<string[]>([])
const tagInput = ref('')
const priority = ref<number | null>(3)

// ── Reference data ──
const channels = ref<NotificationChannel[]>([])
const existingMonitors = ref<Monitor[]>([])

// ── Options ──
const evalWindowOptions = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
  { label: '2h', value: 7200 },
  { label: '4h', value: 14400 },
  { label: '24h', value: 86400 },
]

const apmMetricOptions = [
  { label: 'Error Rate', value: 'error_rate' },
  { label: 'Error Count', value: 'error_count' },
  { label: 'Request Rate', value: 'request_rate' },
  { label: 'P50 Latency', value: 'p50_latency' },
  { label: 'P75 Latency', value: 'p75_latency' },
  { label: 'P90 Latency', value: 'p90_latency' },
  { label: 'P95 Latency', value: 'p95_latency' },
  { label: 'P99 Latency', value: 'p99_latency' },
]

const renotifyOptions = [
  { label: 'Never', value: null },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
  { label: '2h', value: 7200 },
  { label: '4h', value: 14400 },
]

const severityOptions = ['ERROR', 'WARN', 'INFO', 'DEBUG']

const isEditing = computed(() => !!props.monitorId)

// ── PromQL expression highlighting ──
const highlightedExpression = computed(() => {
  const expr = metricExpression.value
  if (!expr) return ''
  // Simple regex highlighting for PromQL keywords
  const highlighted = expr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\b(avg|sum|max|min|count|rate|irate|increase|histogram_quantile|avg_over_time|sum_over_time|max_over_time|min_over_time|count_over_time|topk|bottomk|sort|sort_desc|abs|ceil|floor|round|clamp|clamp_min|clamp_max|delta|deriv|changes|resets|absent|absent_over_time|scalar|vector|time|label_replace|label_join|by|without|on|ignoring|group_left|group_right|offset)\b/g,
      '<span class="hl-fn">$1</span>')
    .replace(/(\{|\})/g, '<span class="hl-brace">$1</span>')
    .replace(/(\[[\d\w]+\])/g, '<span class="hl-range">$1</span>')
  return DOMPurify.sanitize(highlighted, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] })
})

// ── Visual builder <-> expression sync ──
function buildExpressionFromVisual() {
  const c = metricConfig.value
  if (!c.metric_name) {
    metricExpression.value = ''
    return
  }
  let expr = ''
  const filterStr = c.filters
    .filter(f => f.key && f.value)
    .map(f => `${f.key}="${f.value}"`)
    .join(', ')

  const metricWithFilters = filterStr
    ? `${c.metric_name}{${filterStr}}`
    : c.metric_name

  if (c.aggregation === 'rate') {
    expr = `rate(${metricWithFilters}[${evalWindowLabel.value}])`
  } else {
    expr = `${c.aggregation}(${metricWithFilters})`
  }

  if (c.group_by.length > 0) {
    const aggPart = c.aggregation === 'rate' ? 'avg' : c.aggregation
    const inner = c.aggregation === 'rate'
      ? `rate(${metricWithFilters}[${evalWindowLabel.value}])`
      : metricWithFilters
    expr = `${aggPart} by (${c.group_by.join(', ')}) (${inner})`
  }

  metricExpression.value = expr
}

const evalWindowLabel = computed(() => {
  const opt = evalWindowOptions.find(o => o.value === evalWindow.value)
  return opt ? opt.label : '5m'
})

// Sync visual builder to expression when visual fields change
let syncFromVisual = true
watch(
  [() => metricConfig.value.metric_name, () => metricConfig.value.aggregation,
   () => metricConfig.value.filters, () => metricConfig.value.group_by, evalWindow],
  () => {
    if (useVisualBuilder.value && syncFromVisual) {
      buildExpressionFromVisual()
    }
  },
  { deep: true }
)

// When expression changes and visual builder is hidden, try to parse back
// (basic: we don't do a full PromQL parser, just leave them desynced)

// ── Query config computed for API ──
const queryConfig = computed(() => {
  if (monitorType.value === 'metric') {
    return {
      type: 'metric',
      expression: metricExpression.value,
      metric_name: metricConfig.value.metric_name,
      aggregation: metricConfig.value.aggregation,
      filters: metricConfig.value.filters,
      eval_window_secs: evalWindow.value,
    }
  }
  if (monitorType.value === 'log') {
    return {
      type: 'log',
      search: logConfig.value.search,
      service: logConfig.value.service,
      severities: logConfig.value.severities,
      eval_window_secs: evalWindow.value,
    }
  }
  if (monitorType.value === 'apm') {
    return {
      type: 'apm',
      service: apmConfig.value.service,
      metric: apmConfig.value.metric,
      endpoint_filter: apmConfig.value.endpoint_filter,
      eval_window_secs: evalWindow.value,
    }
  }
  return {
    type: 'composite',
    formula: compositeConfig.value.formula,
    monitor_ids: compositeConfig.value.monitor_ids,
  }
})

const groupBy = computed(() => {
  if (monitorType.value === 'metric') return metricConfig.value.group_by
  if (monitorType.value === 'log') return logConfig.value.group_by
  if (monitorType.value === 'apm') return apmConfig.value.group_by
  return []
})

// ── Build payload ──
function buildPayload(): Record<string, unknown> {
  return {
    name: monitorName.value,
    type: monitorType.value,
    query_config: queryConfig.value,
    critical: criticalThreshold.value,
    critical_recovery: criticalRecovery.value,
    warning: warningThreshold.value,
    warning_recovery: warningRecovery.value,
    eval_window_secs: evalWindow.value,
    eval_interval_secs: 60,
    group_by: groupBy.value,
    no_data_action: 'show',
    no_data_timeframe: 600,
    message: message.value,
    notification_channels: notificationChannels.value,
    renotify_interval: renotifyInterval.value,
    tags: tags.value,
    priority: priority.value,
    enabled: true,
  }
}

// ── Preview ──
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(fetchPreview, 800)
}

async function fetchPreview() {
  if (monitorType.value === 'composite') return
  // Don't preview if there's nothing meaningful to query
  const cfg = queryConfig.value
  if (cfg.type === 'metric' && !cfg.metric_name && !cfg.expression) {
    preview.value = null
    previewLoading.value = false
    return
  }
  if (cfg.type === 'apm' && !cfg.service) {
    preview.value = null
    previewLoading.value = false
    return
  }
  if (cfg.type === 'log' && !cfg.search && !cfg.service) {
    preview.value = null
    previewLoading.value = false
    return
  }
  previewLoading.value = true
  try {
    const result = await api.previewMonitor(cfg)
    preview.value = result
  } catch {
    preview.value = null
  }
  previewLoading.value = false
}

// ── Smart suggestions ──
function scheduleSuggestions() {
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(fetchSuggestions, 1000)
}

async function fetchSuggestions() {
  if (monitorType.value === 'composite') return
  suggestionsLoading.value = true
  try {
    const res = await api.monitorSuggest(queryConfig.value)
    smartSuggestions.value = res.suggestions || []
  } catch {
    smartSuggestions.value = []
  } finally {
    suggestionsLoading.value = false
  }
}

function applySuggestion(suggestion: { text: string; severity: string }) {
  // For now, apply suggestion text as the expression for metric type
  if (monitorType.value === 'metric' && suggestion.text.includes('rate(')) {
    metricExpression.value = suggestion.text
    // Switch to expression mode since we've applied a complex expression
    if (useVisualBuilder.value) {
      useVisualBuilder.value = false
    }
  }
  // Remove the applied suggestion
  smartSuggestions.value = smartSuggestions.value.filter(s => s !== suggestion)
}

// Watch query config changes for preview + suggestions
watch(
  [metricExpression, metricConfig, logConfig, apmConfig, compositeConfig, evalWindow, monitorType],
  () => {
    schedulePreview()
    scheduleSuggestions()
  },
  { deep: true }
)

// ── SVG chart helpers ──
const chartWidth = 600
const chartHeight = 260
const chartPadding = { top: 12, right: 16, bottom: 32, left: 56 }

// Compute Y-axis range including threshold values so lines are always visible
const yRange = computed(() => {
  if (!preview.value || !preview.value.timeseries.length) return { min: 0, max: 1 }
  const values = preview.value.timeseries.map(p => p.value)
  let minVal = Math.min(...values)
  let maxVal = Math.max(...values)
  // Extend range to include threshold lines
  if (criticalThreshold.value != null && typeof criticalThreshold.value === 'number') {
    minVal = Math.min(minVal, criticalThreshold.value)
    maxVal = Math.max(maxVal, criticalThreshold.value)
  }
  if (warningThreshold.value != null && typeof warningThreshold.value === 'number') {
    minVal = Math.min(minVal, warningThreshold.value)
    maxVal = Math.max(maxVal, warningThreshold.value)
  }
  // Add 5% padding so lines aren't on the edge
  const pad = (maxVal - minVal) * 0.05 || 1
  return { min: minVal - pad, max: maxVal + pad }
})

const previewPath = computed(() => {
  if (!preview.value || !preview.value.timeseries.length) return ''
  const ts = preview.value.timeseries
  const { min: minVal, max: maxVal } = yRange.value
  const range = maxVal - minVal || 1
  const innerW = chartWidth - chartPadding.left - chartPadding.right
  const innerH = chartHeight - chartPadding.top - chartPadding.bottom
  const len = ts.length > 1 ? ts.length - 1 : 1
  return ts.map((p, i) => {
    const x = chartPadding.left + (i / len) * innerW
    const y = chartPadding.top + innerH - ((p.value - minVal) / range) * innerH
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
})

// Y-axis tick labels
const yTicks = computed(() => {
  if (!preview.value || !preview.value.timeseries.length) return []
  const { min: minVal, max: maxVal } = yRange.value
  const range = maxVal - minVal || 1
  const innerH = chartHeight - chartPadding.top - chartPadding.bottom
  const count = 5
  return Array.from({ length: count }, (_, i) => {
    const frac = i / (count - 1)
    const val = maxVal - frac * range
    const y = chartPadding.top + frac * innerH
    let label: string
    if (Math.abs(val) >= 1_000_000) label = (val / 1_000_000).toFixed(1) + 'M'
    else if (Math.abs(val) >= 1_000) label = (val / 1_000).toFixed(1) + 'k'
    else if (Number.isInteger(val) || range > 10) label = Math.round(val).toString()
    else label = val.toFixed(2)
    return { y, label }
  })
})

// X-axis tick labels
const xTicks = computed(() => {
  if (!preview.value || !preview.value.timeseries.length) return []
  const ts = preview.value.timeseries
  const innerW = chartWidth - chartPadding.left - chartPadding.right
  const count = Math.min(ts.length, 5)
  if (count < 2) return []
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.round(i * (ts.length - 1) / (count - 1))
    const x = chartPadding.left + (idx / (ts.length > 1 ? ts.length - 1 : 1)) * innerW
    const raw = ts[idx]?.timestamp ?? ''
    // Extract HH:MM from timestamp string
    const match = raw.match(/(\d{2}:\d{2})(:\d{2})?$/)
    const label = match ? match[1] : raw.slice(-5)
    return { x, label }
  })
})

function thresholdY(val: number | null): number | null {
  if (val === null || typeof val !== 'number' || !preview.value || !preview.value.timeseries.length) return null
  const { min: minVal, max: maxVal } = yRange.value
  const range = maxVal - minVal || 1
  const innerH = chartHeight - chartPadding.top - chartPadding.bottom
  return chartPadding.top + innerH - ((val - minVal) / range) * innerH
}

const criticalLineY = computed(() => thresholdY(criticalThreshold.value))
const warningLineY = computed(() => thresholdY(warningThreshold.value))

// ── Autocomplete fetchers ──
function fetchMetricNames(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'metric', prefix }).then(r => r.suggestions).catch(() => [])
}

function fetchLabelKeys(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'label_key', prefix, metric: metricConfig.value.metric_name }).then(r => r.suggestions).catch(() => [])
}

function fetchLabelValues(prefix: string, key: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'label_value', prefix, metric: `${metricConfig.value.metric_name}:${key}` }).then(r => r.suggestions).catch(() => [])
}

function fetchServices(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'service', prefix }).then(r => r.suggestions).catch(() => [])
}

function fetchEndpoints(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'endpoint', prefix, metric: apmConfig.value.service }).then(r => r.suggestions).catch(() => [])
}

function fetchLogServices(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'log_service', prefix }).then(r => r.suggestions).catch(() => [])
}

function fetchLogFields(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'log_field', prefix }).then(r => r.suggestions).catch(() => [])
}

// ── Expression autocomplete ──
// Parses cursor context from the expression to determine what to suggest
function fetchExpressionSuggestions(text: string): Promise<string[]> {
  // After { or , inside braces → label keys
  const braceMatch = text.match(/\{[^}]*$/)
  if (braceMatch) {
    const insideBrace = braceMatch[0].slice(1)
    // After key=" → label values
    const valMatch = insideBrace.match(/(\w+)="([^"]*)$/)
    if (valMatch && valMatch[2] !== undefined && valMatch[1] !== undefined) {
      return fetchLabelValues(valMatch[2], valMatch[1])
    }
    // After , or start → label keys
    const keyMatch = insideBrace.match(/(?:,\s*|^)(\w*)$/)
    if (keyMatch && keyMatch[1] !== undefined) {
      return fetchLabelKeys(keyMatch[1])
    }
  }
  // Otherwise → metric names (last word)
  const lastWord = text.match(/(\w[\w:.]*)$/)
  if (lastWord && lastWord[1] !== undefined) {
    return fetchMetricNames(lastWord[1])
  }
  return Promise.resolve([])
}

// ── Filter management ──
function addFilter(config: { filters: { key: string; value: string }[] }) {
  config.filters.push({ key: '', value: '' })
}
function removeFilter(config: { filters: { key: string; value: string }[] }, index: number) {
  config.filters.splice(index, 1)
}

// ── Group by management ──
const groupByInput = ref('')
function addGroupBy(list: string[]) {
  const val = groupByInput.value.trim()
  if (val && !list.includes(val)) {
    list.push(val)
  }
  groupByInput.value = ''
}
function removeGroupBy(list: string[], index: number) {
  list.splice(index, 1)
}

// ── Tag management ──
function addTag() {
  const val = tagInput.value.trim()
  if (val && !tags.value.includes(val)) {
    tags.value.push(val)
  }
  tagInput.value = ''
}
function removeTag(index: number) {
  tags.value.splice(index, 1)
}

// ── Severity toggle ──
function toggleSeverity(sev: string) {
  const idx = logConfig.value.severities.indexOf(sev)
  if (idx >= 0) logConfig.value.severities.splice(idx, 1)
  else logConfig.value.severities.push(sev)
}

// ── Composite monitor toggles ──
function toggleCompositeMonitor(id: string) {
  const idx = compositeConfig.value.monitor_ids.indexOf(id)
  if (idx >= 0) compositeConfig.value.monitor_ids.splice(idx, 1)
  else compositeConfig.value.monitor_ids.push(id)
}

function compositeLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

// ── Channel toggles ──
function toggleChannel(id: string) {
  const idx = notificationChannels.value.indexOf(id)
  if (idx >= 0) notificationChannels.value.splice(idx, 1)
  else notificationChannels.value.push(id)
}

function channelIcon(type: string): string {
  const icons: Record<string, string> = {
    slack: '#',
    email: '@',
    webhook: '{}',
    pagerduty: 'PD',
    opsgenie: 'OG',
  }
  return icons[type] || type[0]?.toUpperCase() || '?'
}

// ── Save ──
async function handleSave() {
  saveError.value = null
  saving.value = true
  try {
    if (isEditing.value) {
      await api.updateMonitor(props.monitorId!, buildPayload())
    } else {
      await api.createMonitor(buildPayload())
    }
    emit('saved')
  } catch (e: any) {
    saveError.value = e.message || 'Failed to save monitor'
  } finally {
    saving.value = false
  }
}

// ── Mount ──
onMounted(async () => {
  loading.value = true
  try {
    const [channelRes, monRes] = await Promise.all([
      api.listChannels(),
      api.listMonitors(),
    ])
    channels.value = channelRes.channels
    existingMonitors.value = monRes.monitors

    // If editing, load existing monitor data
    if (props.monitorId) {
      const res = await api.getMonitor(props.monitorId)
      const m = res.monitor
      monitorType.value = m.type
      monitorName.value = m.name
      emit('loaded', m.name)
      message.value = m.message
      criticalThreshold.value = m.critical
      warningThreshold.value = m.warning
      criticalRecovery.value = m.critical_recovery
      warningRecovery.value = m.warning_recovery
      recoveryExpanded.value = m.critical_recovery !== null || m.warning_recovery !== null
      evalWindow.value = m.eval_window_secs
      notificationChannels.value = m.notification_channels
      renotifyInterval.value = m.renotify_interval
      tags.value = m.tags || []
      priority.value = m.priority

      const qc = m.query_config || {}
      if (m.type === 'metric') {
        metricConfig.value.metric_name = qc.metric_name || ''
        metricConfig.value.aggregation = qc.aggregation || 'avg'
        metricConfig.value.filters = qc.filters || []
        metricConfig.value.group_by = m.group_by || []
        if (qc.expression) {
          metricExpression.value = qc.expression
          useVisualBuilder.value = false
        } else {
          buildExpressionFromVisual()
        }
      } else if (m.type === 'log') {
        logConfig.value.search = qc.search || ''
        logConfig.value.service = qc.service || ''
        logConfig.value.severities = qc.severities || []
        logConfig.value.group_by = m.group_by || []
      } else if (m.type === 'apm') {
        apmConfig.value.service = qc.service || ''
        apmConfig.value.metric = qc.metric || 'error_rate'
        apmConfig.value.endpoint_filter = qc.endpoint_filter || ''
        apmConfig.value.group_by = m.group_by || []
      } else if (m.type === 'composite') {
        compositeConfig.value.formula = qc.formula || ''
        compositeConfig.value.monitor_ids = qc.monitor_ids || []
      }
    }
  } catch { /* error in api.error */ }
  finally { loading.value = false }
})

onUnmounted(() => {
  if (previewTimer) clearTimeout(previewTimer)
  if (suggestTimer) clearTimeout(suggestTimer)
})
</script>

<template>
  <div class="mf-page">
    <!-- Loading state -->
    <div v-if="loading" class="mf-loading">
      <span class="text-muted">Loading...</span>
    </div>

    <!-- Error banner -->
    <div v-if="saveError" class="mf-error fade-in">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      {{ saveError }}
    </div>

    <template v-if="!loading">
      <!-- ═══ Section 1: Type Selector ═══ -->
      <div class="mf-section mf-type-section">
        <div class="mf-section-label">Monitor type</div>
        <div class="mf-type-pills">
          <button
            v-for="t in (['metric', 'log', 'apm', 'composite'] as const)"
            :key="t"
            class="mf-type-pill"
            :class="{ active: monitorType === t }"
            @click="monitorType = t"
          >
            {{ t === 'apm' ? 'APM' : t.charAt(0).toUpperCase() + t.slice(1) }}
          </button>
        </div>
      </div>

      <!-- ═══ Section 2: Query ═══ -->
      <div class="mf-section">
        <div class="mf-section-label">Query</div>

        <!-- Metric Query -->
        <template v-if="monitorType === 'metric'">
          <!-- Expression input -->
          <div class="mf-expr-wrap">
            <div class="mf-expr-header">
              <span class="mf-expr-label mono">PromQL Expression</span>
              <button
                class="mf-toggle-builder"
                @click="useVisualBuilder = !useVisualBuilder"
              >
                {{ useVisualBuilder ? 'Edit expression' : 'Visual builder' }}
              </button>
            </div>
            <div v-if="!useVisualBuilder" class="mf-expr-container">
              <div class="mf-expr-highlight" v-html="highlightedExpression"></div>
              <AutocompleteInput
                v-model="metricExpression"
                :fetch-suggestions="fetchExpressionSuggestions"
                :debounce-ms="200"
                :mono="true"
                placeholder="avg(rate(http_request_duration_seconds_sum{service=&quot;checkout&quot;}[5m]))"
              />
            </div>
            <div v-else class="mf-expr-readonly mono">
              {{ metricExpression || 'Configure below...' }}
            </div>
          </div>

          <!-- Visual builder -->
          <div v-if="useVisualBuilder" class="mf-visual-builder">
            <div class="mf-vb-row">
              <div class="mf-field mf-field-grow">
                <label class="mf-label">Metric</label>
                <AutocompleteInput
                  v-model="metricConfig.metric_name"
                  :fetch-suggestions="fetchMetricNames"
                  :mono="true"
                  placeholder="http_request_duration_seconds_sum"
                />
              </div>
              <div class="mf-field" style="width: 130px;">
                <label class="mf-label">Aggregation</label>
                <select v-model="metricConfig.aggregation" class="mf-select">
                  <option value="avg">avg</option>
                  <option value="sum">sum</option>
                  <option value="max">max</option>
                  <option value="min">min</option>
                  <option value="count">count</option>
                  <option value="rate">rate</option>
                </select>
              </div>
            </div>

            <!-- Filters -->
            <div class="mf-field">
              <label class="mf-label">Filters</label>
              <div class="mf-filters">
                <div v-for="(f, i) in metricConfig.filters" :key="i" class="mf-filter-row">
                  <AutocompleteInput
                    v-model="f.key"
                    :fetch-suggestions="fetchLabelKeys"
                    :mono="true"
                    placeholder="key"
                  />
                  <span class="mf-filter-op mono">=</span>
                  <AutocompleteInput
                    v-model="f.value"
                    :fetch-suggestions="(p: string) => fetchLabelValues(p, f.key)"
                    :mono="true"
                    placeholder="value"
                  />
                  <button class="mf-filter-rm" @click="removeFilter(metricConfig, i)" title="Remove">&times;</button>
                </div>
                <button class="mf-link-btn" @click="addFilter(metricConfig)">+ Add filter</button>
              </div>
            </div>

            <!-- Group by -->
            <div class="mf-field">
              <label class="mf-label">Group by</label>
              <div class="mf-chips">
                <span v-for="(g, i) in metricConfig.group_by" :key="g" class="mf-chip">
                  {{ g }}
                  <button class="mf-chip-rm" @click="removeGroupBy(metricConfig.group_by, i)">&times;</button>
                </span>
              </div>
              <div class="mf-inline-add">
                <AutocompleteInput
                  v-model="groupByInput"
                  :fetch-suggestions="fetchLabelKeys"
                  :mono="true"
                  placeholder="Add label..."
                  @select="addGroupBy(metricConfig.group_by)"
                />
              </div>
            </div>

            <!-- Eval window -->
            <div class="mf-field" style="width: 130px;">
              <label class="mf-label">Window</label>
              <select v-model="evalWindow" class="mf-select">
                <option v-for="opt in evalWindowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <!-- Window when in expression mode -->
          <div v-if="!useVisualBuilder" class="mf-field" style="width: 130px;">
            <label class="mf-label">Window</label>
            <select v-model="evalWindow" class="mf-select">
              <option v-for="opt in evalWindowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
        </template>

        <!-- Log Query -->
        <template v-if="monitorType === 'log'">
          <div class="mf-field">
            <label class="mf-label">Search query</label>
            <input
              v-model="logConfig.search"
              class="mf-input mono"
              placeholder='service:checkout severity:ERROR "timeout"'
            />
          </div>
          <div class="mf-row-2">
            <div class="mf-field mf-field-grow">
              <label class="mf-label">Service</label>
              <AutocompleteInput
                v-model="logConfig.service"
                :fetch-suggestions="fetchLogServices"
                placeholder="Filter by service..."
              />
            </div>
            <div class="mf-field" style="width: 130px;">
              <label class="mf-label">Window</label>
              <select v-model="evalWindow" class="mf-select">
                <option v-for="opt in evalWindowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>
          <div class="mf-field">
            <label class="mf-label">Severity</label>
            <div class="mf-sev-pills">
              <button
                v-for="sev in severityOptions"
                :key="sev"
                class="mf-sev-pill"
                :class="{ active: logConfig.severities.includes(sev), ['sev-' + sev.toLowerCase()]: true }"
                @click="toggleSeverity(sev)"
              >
                {{ sev }}
              </button>
            </div>
          </div>
          <div class="mf-field">
            <label class="mf-label">Group by</label>
            <div class="mf-chips">
              <span v-for="(g, i) in logConfig.group_by" :key="g" class="mf-chip">
                {{ g }}
                <button class="mf-chip-rm" @click="removeGroupBy(logConfig.group_by, i)">&times;</button>
              </span>
            </div>
            <div class="mf-inline-add">
              <AutocompleteInput
                v-model="groupByInput"
                :fetch-suggestions="fetchLogFields"
                :mono="true"
                placeholder="Add field..."
                @select="addGroupBy(logConfig.group_by)"
              />
            </div>
          </div>
        </template>

        <!-- APM Query -->
        <template v-if="monitorType === 'apm'">
          <div class="mf-row-3">
            <div class="mf-field mf-field-grow">
              <label class="mf-label">Service</label>
              <AutocompleteInput
                v-model="apmConfig.service"
                :fetch-suggestions="fetchServices"
                placeholder="Select service..."
              />
            </div>
            <div class="mf-field" style="width: 160px;">
              <label class="mf-label">Metric</label>
              <select v-model="apmConfig.metric" class="mf-select">
                <option v-for="opt in apmMetricOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div class="mf-field" style="width: 130px;">
              <label class="mf-label">Window</label>
              <select v-model="evalWindow" class="mf-select">
                <option v-for="opt in evalWindowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>
          <div class="mf-field">
            <label class="mf-label">Endpoint filter</label>
            <AutocompleteInput
              v-model="apmConfig.endpoint_filter"
              :fetch-suggestions="fetchEndpoints"
              :mono="true"
              placeholder="/api/checkout"
            />
          </div>
          <div class="mf-field">
            <label class="mf-label">Group by</label>
            <div class="mf-chips">
              <span v-for="(g, i) in apmConfig.group_by" :key="g" class="mf-chip">
                {{ g }}
                <button class="mf-chip-rm" @click="removeGroupBy(apmConfig.group_by, i)">&times;</button>
              </span>
            </div>
            <div class="mf-inline-add">
              <AutocompleteInput
                v-model="groupByInput"
                :fetch-suggestions="fetchLabelKeys"
                :mono="true"
                placeholder="Add label..."
                @select="addGroupBy(apmConfig.group_by)"
              />
            </div>
          </div>
        </template>

        <!-- Composite Query -->
        <template v-if="monitorType === 'composite'">
          <div class="mf-composite-monitors">
            <div
              v-for="(m, i) in existingMonitors.slice(0, 26)"
              :key="m.id"
              class="mf-comp-row"
              :class="{ selected: compositeConfig.monitor_ids.includes(m.id) }"
              @click="toggleCompositeMonitor(m.id)"
            >
              <span class="mf-comp-letter mono">{{ compositeLabel(i) }}</span>
              <span class="mf-comp-name">{{ m.name }}</span>
              <span class="mf-comp-state mono" :style="{ color: m.state === 'ok' ? 'var(--ok)' : m.state === 'alert' ? 'var(--error)' : m.state === 'warn' ? 'var(--warning)' : 'var(--text-muted)' }">
                {{ m.state }}
              </span>
              <div class="mf-comp-check">
                <svg v-if="compositeConfig.monitor_ids.includes(m.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
            <div v-if="existingMonitors.length === 0" class="text-muted" style="font-size: 11px; padding: var(--sp-3)">
              No existing monitors
            </div>
          </div>
          <div class="mf-field">
            <label class="mf-label">Formula</label>
            <input
              v-model="compositeConfig.formula"
              class="mf-input mono"
              placeholder="A && B && !C"
            />
            <div class="mf-hint text-muted">Use letters to reference monitors. Combine with && (AND), || (OR), ! (NOT)</div>
          </div>
        </template>
      </div>

      <!-- ═══ Section 3: Conditions ═══ -->
      <div class="mf-section">
        <div class="mf-section-label">Conditions</div>
        <div class="mf-conditions-row">
          <span class="mf-cond-text">Alert when value is</span>
          <select v-model="comparator" class="mf-select mf-select-sm">
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
          <input
            v-model.number="criticalThreshold"
            type="number"
            class="mf-input mf-input-num mono"
            placeholder="500"
            step="any"
          />
          <span class="mf-cond-text mf-cond-sep">Warning at</span>
          <input
            v-model.number="warningThreshold"
            type="number"
            class="mf-input mf-input-num mono"
            placeholder="300"
            step="any"
          />
        </div>
        <div class="mf-conditions-row mf-conditions-recovery" :class="{ expanded: recoveryExpanded }">
          <button v-if="!recoveryExpanded" class="mf-link-btn" @click="recoveryExpanded = true">
            + Recovery thresholds
          </button>
          <template v-else>
            <span class="mf-cond-text">Recovery at</span>
            <input
              v-model.number="criticalRecovery"
              type="number"
              class="mf-input mf-input-num mono"
              placeholder="200"
              step="any"
            />
            <span class="mf-cond-text mf-cond-sep">Window</span>
            <select v-model="evalWindow" class="mf-select mf-select-sm">
              <option v-for="opt in evalWindowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </template>
        </div>
      </div>

      <!-- ═══ Section 4: Live Preview ═══ -->
      <div v-if="monitorType !== 'composite'" class="mf-section mf-preview-section">
        <div class="mf-section-label">
          Preview
          <span v-if="previewLoading" class="mf-preview-loading text-muted">loading...</span>
          <span v-else-if="preview && preview.current_value != null" class="mf-preview-val mono">
            current: {{ Number(preview.current_value).toFixed(2) }}
          </span>
        </div>
        <div class="mf-preview-chart">
          <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="mf-chart-svg" preserveAspectRatio="none">
            <!-- Grid lines -->
            <line
              v-for="tick in yTicks"
              :key="'grid-' + tick.label"
              :x1="chartPadding.left"
              :y1="tick.y"
              :x2="chartWidth - chartPadding.right"
              :y2="tick.y"
              stroke="var(--border-subtle)"
              stroke-width="0.5"
            />
            <!-- Y-axis labels -->
            <text
              v-for="tick in yTicks"
              :key="'ylabel-' + tick.label"
              :x="chartPadding.left - 8"
              :y="tick.y + 3"
              text-anchor="end"
              fill="var(--text-muted)"
              font-size="9"
              font-family="var(--font-mono)"
            >{{ tick.label }}</text>
            <!-- X-axis labels -->
            <text
              v-for="tick in xTicks"
              :key="'xlabel-' + tick.label"
              :x="tick.x"
              :y="chartHeight - chartPadding.bottom + 16"
              text-anchor="middle"
              fill="var(--text-muted)"
              font-size="9"
              font-family="var(--font-mono)"
            >{{ tick.label }}</text>
            <!-- Data line -->
            <path
              v-if="previewPath"
              :d="previewPath"
              fill="none"
              stroke="var(--amber)"
              stroke-width="1.5"
            />
            <!-- Critical threshold -->
            <line
              v-if="criticalLineY !== null"
              :x1="chartPadding.left"
              :y1="criticalLineY"
              :x2="chartWidth - chartPadding.right"
              :y2="criticalLineY"
              stroke="var(--error)"
              stroke-width="1"
              stroke-dasharray="4,3"
            />
            <text
              v-if="criticalLineY !== null"
              :x="chartPadding.left + 4"
              :y="criticalLineY! - 4"
              fill="var(--error)"
              font-size="9"
              font-family="var(--font-mono)"
            >CRIT {{ criticalThreshold }}</text>
            <!-- Warning threshold -->
            <line
              v-if="warningLineY !== null"
              :x1="chartPadding.left"
              :y1="warningLineY"
              :x2="chartWidth - chartPadding.right"
              :y2="warningLineY"
              stroke="var(--warning)"
              stroke-width="1"
              stroke-dasharray="4,3"
            />
            <text
              v-if="warningLineY !== null"
              :x="chartPadding.left + 4"
              :y="warningLineY! - 4"
              fill="var(--warning)"
              font-size="9"
              font-family="var(--font-mono)"
            >WARN {{ warningThreshold }}</text>
            <!-- Empty state -->
            <text
              v-if="!preview && !previewLoading"
              :x="chartWidth / 2"
              :y="chartHeight / 2"
              text-anchor="middle"
              fill="var(--text-muted)"
              font-size="11"
            >Configure query to see preview</text>
          </svg>
        </div>
      </div>

      <!-- ═══ Section 5: Smart Suggestions ═══ -->
      <TransitionGroup name="mf-suggest" tag="div" class="mf-suggestions" v-if="smartSuggestions.length > 0">
        <div
          v-for="s in smartSuggestions"
          :key="s.text"
          class="mf-suggestion"
          :class="'mf-suggestion-' + s.severity"
        >
          <span class="mf-suggestion-icon">
            <template v-if="s.severity === 'warning'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </template>
            <template v-else>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </template>
          </span>
          <span class="mf-suggestion-text">{{ s.text }}</span>
          <button class="mf-suggestion-apply" @click="applySuggestion(s)">Apply</button>
        </div>
      </TransitionGroup>

      <!-- ═══ Section 6: Notification ═══ -->
      <div class="mf-section">
        <div class="mf-section-label">Notification</div>
        <div class="mf-row-2">
          <div class="mf-field mf-field-grow">
            <label class="mf-label">Name</label>
            <input
              v-model="monitorName"
              class="mf-input"
              placeholder="High latency on checkout service"
            />
          </div>
          <div class="mf-field" style="width: 100px;">
            <label class="mf-label">Priority</label>
            <select v-model="priority" class="mf-select">
              <option :value="null">None</option>
              <option :value="1">P1</option>
              <option :value="2">P2</option>
              <option :value="3">P3</option>
              <option :value="4">P4</option>
              <option :value="5">P5</option>
            </select>
          </div>
        </div>
        <div class="mf-field">
          <label class="mf-label">Message</label>
          <textarea
            v-model="message"
            class="mf-textarea"
            rows="3"
            placeholder="Markdown supported. Use {{value}}, {{threshold}} for dynamic values."
          ></textarea>
        </div>
        <div class="mf-row-2">
          <div class="mf-field mf-field-grow">
            <label class="mf-label">Channels</label>
            <div class="mf-channels">
              <div
                v-for="ch in channels"
                :key="ch.id"
                class="mf-channel"
                :class="{ selected: notificationChannels.includes(ch.id) }"
                @click="toggleChannel(ch.id)"
              >
                <span class="mf-channel-icon mono">{{ channelIcon(ch.channel_type) }}</span>
                <span class="mf-channel-name">{{ ch.name }}</span>
              </div>
              <div v-if="channels.length === 0" class="text-muted" style="font-size: 11px; padding: var(--sp-2)">
                No channels configured
              </div>
            </div>
          </div>
          <div class="mf-field" style="width: 100px;">
            <label class="mf-label">Renotify</label>
            <select v-model="renotifyInterval" class="mf-select">
              <option v-for="opt in renotifyOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
        </div>
        <div class="mf-field">
          <label class="mf-label">Tags</label>
          <div class="mf-tags-row">
            <span v-for="(t, i) in tags" :key="t" class="mf-chip">
              {{ t }}
              <button class="mf-chip-rm" @click="removeTag(i)">&times;</button>
            </span>
            <input
              v-model="tagInput"
              class="mf-tag-input mono"
              placeholder="env:prod"
              @keydown.enter.prevent="addTag"
            />
          </div>
        </div>
      </div>

      <!-- ═══ Section 7: Save bar ═══ -->
      <div class="mf-save-bar">
        <button class="mf-btn mf-btn-cancel" @click="emit('cancel')">Cancel</button>
        <button
          class="mf-btn mf-btn-save"
          :disabled="saving || !monitorName.trim()"
          @click="handleSave"
        >
          {{ saving ? 'Saving...' : (isEditing ? 'Update Monitor' : 'Save Monitor') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/components/MonitorWizard.css"></style>
