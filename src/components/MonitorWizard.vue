<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { useApi } from '../composables/useApi'
import AutocompleteInput from './AutocompleteInput.vue'
import { TimeSeriesPanel } from './panels'
import { ALERT_TEMPLATE_GROUPS, ALERT_TEMPLATES } from '../lib/alertTemplates'
import { normalizeApmGroups } from '../lib/monitorApm'
import { normalizeThreshold, thresholdOrderError } from '../lib/monitorThresholds'
import type { TimeSeriesPanelSeries } from './panels/types'
import type { Monitor, MonitorComparator, MonitorPreview, NotificationChannel } from '../types'

const props = defineProps<{
  monitorId?: string
}>()

const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'cancel'): void
  (e: 'loaded', name: string): void
}>()

const api = useApi()
const selectedTemplate = ref('blank')
const templatesExpanded = ref(false)

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
  filters: [] as { field: string; op: '=' | '!=' | 'LIKE'; value: string }[],
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
const comparator = ref<MonitorComparator>('above')
const criticalThreshold = ref<number | null>(null)
const warningThreshold = ref<number | null>(null)
const criticalRecovery = ref<number | null>(null)
const warningRecovery = ref<number | null>(null)
const recoveryExpanded = ref(false)

// ── Section 4: Preview ──
const preview = ref<MonitorPreview | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const previewLookbackSecs = ref(10_800)
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

const previewLookbackOptions = [
  { label: '1h', value: 3600 },
  { label: '3h', value: 10800 },
  { label: '6h', value: 21600 },
  { label: '12h', value: 43200 },
  { label: '24h', value: 86400 },
  { label: '48h', value: 172800 },
  { label: '7d', value: 604800 },
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

const severityOptions = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG']

const isEditing = computed(() => !!props.monitorId)
const templateGroups = computed(() => ALERT_TEMPLATE_GROUPS.map(group => ({
  ...group,
  templates: ALERT_TEMPLATES.filter(template => template.group === group.id),
})))
const selectedTemplateName = computed(() => (
  selectedTemplate.value === 'blank'
    ? 'Start blank'
    : ALERT_TEMPLATES.find(template => template.id === selectedTemplate.value)?.name || 'Choose a template'
))
const thresholdUnit = computed(() => (
  monitorType.value === 'apm' && apmConfig.value.metric.includes('latency') ? 'ms'
    : monitorType.value === 'apm' && apmConfig.value.metric === 'error_rate' ? '%'
      : monitorType.value === 'apm' && apmConfig.value.metric === 'request_rate' ? 'req/s'
        : monitorType.value === 'log' ? 'logs'
          : ''
))
const normalizedCriticalThreshold = computed(() => normalizeThreshold(criticalThreshold.value))
const normalizedWarningThreshold = computed(() => normalizeThreshold(warningThreshold.value))
const thresholdValidationError = computed(() => thresholdOrderError(
  comparator.value,
  normalizedCriticalThreshold.value,
  normalizedWarningThreshold.value,
))
const higherValuesAreWorse = computed(() => (
  comparator.value === 'above' || comparator.value === 'above_or_equal'
))
const lowerValuesAreWorse = computed(() => (
  comparator.value === 'below' || comparator.value === 'below_or_equal'
))
const canSave = computed(() => (
  Boolean(monitorName.value.trim())
  && (monitorType.value === 'composite' || normalizedCriticalThreshold.value !== null)
  && thresholdValidationError.value === null
))

function applyBlankTemplate() {
  selectedTemplate.value = 'blank'
  templatesExpanded.value = false
  monitorType.value = 'metric'
  metricExpression.value = ''
  useVisualBuilder.value = true
  metricConfig.value = { metric_name: '', aggregation: 'avg', filters: [], group_by: [] }
  logConfig.value = { search: '', service: '', severities: [], filters: [], group_by: [] }
  apmConfig.value = { service: '', metric: 'error_rate', endpoint_filter: '', group_by: [] }
  compositeConfig.value = { formula: '', monitor_ids: [] }
  evalWindow.value = 300
  comparator.value = 'above'
  criticalThreshold.value = null
  warningThreshold.value = null
  criticalRecovery.value = null
  warningRecovery.value = null
  recoveryExpanded.value = false
  monitorName.value = ''
  message.value = ''
  notificationChannels.value = []
  renotifyInterval.value = null
  tags.value = []
  priority.value = 3
  preview.value = null
  previewError.value = null
}

function applyTemplate(templateId: string) {
  const template = ALERT_TEMPLATES.find(item => item.id === templateId)
  if (!template) return

  selectedTemplate.value = template.id
  templatesExpanded.value = false
  metricExpression.value = ''
  useVisualBuilder.value = true
  metricConfig.value = { metric_name: '', aggregation: 'avg', filters: [], group_by: [] }
  logConfig.value = { search: '', service: '', severities: [], filters: [], group_by: [] }
  apmConfig.value = { service: '', metric: 'error_rate', endpoint_filter: '', group_by: [] }
  compositeConfig.value = { formula: '', monitor_ids: [] }
  monitorType.value = template.monitorType

  if (template.monitorType === 'apm') {
    apmConfig.value = {
      service: template.query.service || '*',
      metric: template.query.metric,
      endpoint_filter: template.query.endpointFilter || '*',
      group_by: [...(template.query.groupBy || [])],
    }
  } else if (template.monitorType === 'log') {
    logConfig.value = {
      search: template.query.search || '',
      service: template.query.service || '',
      severities: [...(template.query.severities || [])],
      filters: (template.query.filters || []).map(filter => ({ ...filter })),
      group_by: [...(template.query.groupBy || [])],
    }
  } else {
    metricConfig.value = {
      metric_name: template.query.metricName,
      aggregation: template.query.aggregation,
      filters: (template.query.filters || []).map(filter => ({ ...filter })),
      group_by: [...(template.query.groupBy || [])],
    }
    buildExpressionFromVisual()
  }
  evalWindow.value = template.evalWindow
  comparator.value = template.comparator
  criticalThreshold.value = template.criticalThreshold
  warningThreshold.value = template.warningThreshold
  criticalRecovery.value = template.criticalRecovery
  warningRecovery.value = template.warningRecovery
  recoveryExpanded.value = template.criticalRecovery !== null || template.warningRecovery !== null
  monitorName.value = template.monitorName
  message.value = template.message
  priority.value = template.priority
  preview.value = null
  previewError.value = null
}

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
      filters: logConfig.value.filters,
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
  if (monitorType.value === 'apm') {
    return normalizeApmGroups(
      apmConfig.value.service,
      apmConfig.value.endpoint_filter,
      apmConfig.value.group_by,
    )
  }
  return []
})

// ── Build payload ──
function buildPayload(): Record<string, unknown> {
  return {
    name: monitorName.value,
    type: monitorType.value,
    query_config: queryConfig.value,
    critical: normalizedCriticalThreshold.value,
    critical_recovery: criticalRecovery.value,
    warning: normalizedWarningThreshold.value,
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

const previewQueryReady = computed(() => {
  const cfg = queryConfig.value
  if (cfg.type === 'metric') return Boolean(cfg.metric_name || cfg.expression)
  if (cfg.type === 'apm') return Boolean(cfg.service)
  if (cfg.type === 'log') return Boolean(cfg.search || cfg.service || cfg.severities?.length || cfg.filters?.length)
  return false
})

async function fetchPreview() {
  if (monitorType.value === 'composite') return
  if (!previewQueryReady.value) {
    preview.value = null
    previewError.value = null
    previewLoading.value = false
    return
  }
  previewLoading.value = true
  previewError.value = null
  try {
    const result = await api.previewMonitor({
      ...queryConfig.value,
      lookback_secs: previewLookbackSecs.value,
      group_by: groupBy.value,
      critical: normalizedCriticalThreshold.value,
      critical_recovery: criticalRecovery.value,
      warning: normalizedWarningThreshold.value,
      warning_recovery: warningRecovery.value,
      comparator: comparator.value,
    })
    preview.value = result
  } catch (error) {
    preview.value = null
    previewError.value = error instanceof Error ? error.message : 'The preview request failed.'
  } finally {
    previewLoading.value = false
  }
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
  [
    metricExpression,
    metricConfig,
    logConfig,
    apmConfig,
    compositeConfig,
    evalWindow,
    monitorType,
    comparator,
    criticalThreshold,
    criticalRecovery,
    warningThreshold,
    warningRecovery,
  ],
  () => {
    schedulePreview()
    scheduleSuggestions()
  },
  { deep: true }
)

const previewSeriesName = computed(() => {
  if (monitorType.value === 'log') return 'Matching logs'
  if (monitorType.value === 'apm') {
    return {
      error_rate: 'Error rate',
      p95_latency: 'P95 latency',
      p99_latency: 'P99 latency',
      request_rate: 'Request rate',
    }[apmConfig.value.metric] || 'APM value'
  }
  return metricConfig.value.metric_name || 'Metric value'
})

const previewSeriesColors = [
  'var(--amber)',
  'var(--ok)',
  'var(--purple, #8b5cf6)',
  'var(--warning)',
  'var(--text-secondary)',
  'var(--error)',
]

function previewTimestamp(timestamp: string): number {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}Z`
  return Date.parse(normalized) / 1000
}

const previewSeries = computed<TimeSeriesPanelSeries[]>(() => {
  if (!preview.value) return []
  const source = preview.value.series?.length
    ? preview.value.series
    : [{ group_key: '', points: preview.value.timeseries || [] }]

  return source.slice(0, 8).map((item, index) => ({
    name: item.group_key || previewSeriesName.value,
    points: item.points
      .map(({ timestamp, value }) => [previewTimestamp(timestamp), Number(value)] as [number, number])
      .filter(([timestamp, value]) => Number.isFinite(timestamp) && Number.isFinite(value))
      .sort(([left], [right]) => left - right),
    color: previewSeriesColors[index % previewSeriesColors.length],
    legendValue: source.length === 1 ? preview.value?.current_value ?? undefined : undefined,
  })).filter(item => item.points.length)
})

const previewThresholds = computed(() => {
  const thresholds: Array<{ value: number; color: string; label: string }> = []
  if (normalizedWarningThreshold.value !== null) {
    thresholds.push({ value: normalizedWarningThreshold.value, color: 'var(--warning)', label: `Warning ${normalizedWarningThreshold.value}` })
  }
  if (normalizedCriticalThreshold.value !== null) {
    thresholds.push({ value: normalizedCriticalThreshold.value, color: 'var(--error)', label: `Alert ${normalizedCriticalThreshold.value}` })
  }
  return thresholds
})

const previewRangeLabel = computed(() => (
  previewLookbackOptions.find(option => option.value === previewLookbackSecs.value)?.label || `${previewLookbackSecs.value}s`
))

const previewEvents = computed(() => preview.value?.simulated_events || [])
const previewAlertCount = computed(() => previewEvents.value.filter(event => event.state === 'alert').length)
const previewRecoveryCount = computed(() => previewEvents.value.filter(event => event.state === 'ok').length)
const hasPreviewThreshold = computed(() => normalizedCriticalThreshold.value !== null || normalizedWarningThreshold.value !== null)
const previewBucketLabel = computed(() => {
  const seconds = preview.value?.bucket_secs || evalWindow.value
  return evalWindowOptions.find(option => option.value === seconds)?.label || `${Math.round(seconds / 60)}m`
})

function previewEventLabel(state: string): string {
  if (state === 'alert') return 'Alerted'
  if (state === 'warn') return 'Warning'
  return 'Recovered'
}

function formatPreviewEventTime(timestamp: string): string {
  const parsed = previewTimestamp(timestamp) * 1000
  if (!Number.isFinite(parsed)) return timestamp
  return new Date(parsed).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPreviewValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const formatted = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
  return `${formatted}${thresholdUnit.value === '%' ? '%' : thresholdUnit.value ? ` ${thresholdUnit.value}` : ''}`
}

const previewSourceLabel = computed(() => (
  monitorType.value === 'apm' ? 'APM' : monitorType.value === 'log' ? 'Logs' : 'Metrics'
))

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
  return api.monitorAutocomplete({ type: 'endpoint', prefix, service: apmConfig.value.service }).then(r => r.suggestions).catch(() => [])
}

function fetchLogServices(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'log_service', prefix }).then(r => r.suggestions).catch(() => [])
}

function fetchLogFields(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'log_field', prefix }).then(r => r.suggestions).catch(() => [])
}

function fetchApmGroupFields(prefix: string): Promise<string[]> {
  const fields = ['endpoint', 'http_method', 'http_status_code', 'status', 'span_name', 'kind', 'service_name']
  const normalized = prefix.trim().toLowerCase()
  return Promise.resolve(fields.filter(field => !normalized || field.startsWith(normalized)))
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

function addLogFilter() {
  logConfig.value.filters.push({ field: '', op: '=', value: '' })
}

function removeLogFilter(index: number) {
  logConfig.value.filters.splice(index, 1)
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

function ensureApmWildcardGroups() {
  apmConfig.value.group_by = normalizeApmGroups(
    apmConfig.value.service,
    apmConfig.value.endpoint_filter,
    apmConfig.value.group_by,
  )
}

function addApmGroupBy() {
  addGroupBy(apmConfig.value.group_by)
  ensureApmWildcardGroups()
}

watch(
  [() => apmConfig.value.service, () => apmConfig.value.endpoint_filter],
  ensureApmWildcardGroups,
)

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
  if (!monitorName.value.trim()) {
    saveError.value = 'Enter a name for this alert.'
    return
  }
  if (monitorType.value !== 'composite' && normalizedCriticalThreshold.value === null) {
    saveError.value = 'Set an alert threshold.'
    return
  }
  if (thresholdValidationError.value) {
    saveError.value = thresholdValidationError.value
    return
  }
  saving.value = true
  try {
    if (isEditing.value) {
      await api.updateMonitor(props.monitorId!, buildPayload())
    } else {
      await api.createMonitor(buildPayload())
    }
    emit('saved')
  } catch (e: any) {
    saveError.value = e.message || 'Failed to save alert'
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
      comparator.value = m.comparator
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
        logConfig.value.filters = qc.filters || []
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
      <div v-if="!isEditing" class="mf-section mf-template-section" :class="{ open: templatesExpanded }">
        <button
          type="button"
          class="mf-template-toggle"
          aria-controls="alert-template-drawer"
          :aria-expanded="templatesExpanded"
          @click="templatesExpanded = !templatesExpanded"
        >
          <span class="mf-template-toggle-copy">
            <span class="mf-template-toggle-label">Alert template</span>
            <span class="mf-template-toggle-value">{{ selectedTemplateName }}</span>
          </span>
          <span class="mf-template-toggle-hint">
            {{ templatesExpanded ? 'Close templates' : 'Choose a prebuilt starting point' }}
          </span>
          <svg class="mf-template-chevron" :class="{ open: templatesExpanded }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div id="alert-template-drawer" class="mf-template-drawer" :aria-hidden="!templatesExpanded" :inert="!templatesExpanded">
          <div class="mf-template-drawer-inner">
            <div class="mf-template-content">
              <div class="mf-template-heading">
                <p class="mf-template-intro">Pick a starting point, then choose the service or labels it applies to.</p>
                <button
                  type="button"
                  class="mf-blank-template"
                  :class="{ active: selectedTemplate === 'blank' }"
                  :aria-pressed="selectedTemplate === 'blank'"
                  @click="applyBlankTemplate"
                >
                  Start blank
                </button>
              </div>
              <div class="mf-template-groups" aria-label="Alert templates">
                <section v-for="group in templateGroups" :key="group.id" class="mf-template-group">
                  <header class="mf-template-group-header">
                    <span>{{ group.label }}</span>
                    <small>{{ group.description }}</small>
                  </header>
                  <button
                    v-for="template in group.templates"
                    :key="template.id"
                    type="button"
                    class="mf-template-option"
                    :class="{ active: selectedTemplate === template.id }"
                    :aria-pressed="selectedTemplate === template.id"
                    @click="applyTemplate(template.id)"
                  >
                    <span class="mf-template-copy">
                      <span class="mf-template-name">{{ template.name }}</span>
                      <span class="mf-template-description">{{ template.description }}</span>
                    </span>
                    <span class="mf-template-check" aria-hidden="true">{{ selectedTemplate === template.id ? '✓' : '→' }}</span>
                  </button>
                </section>
              </div>
              <p class="mf-template-hint">Templates only fill the form. Nothing is saved until you review and create the alert.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Section 1: Type Selector ═══ -->
      <div class="mf-section mf-type-section">
        <div class="mf-section-label">Alert type</div>
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
            <label class="mf-label">Field filters</label>
            <div class="mf-filters">
              <div v-for="(filter, i) in logConfig.filters" :key="i" class="mf-filter-row">
                <AutocompleteInput
                  v-model="filter.field"
                  :fetch-suggestions="fetchLogFields"
                  :mono="true"
                  placeholder="field"
                />
                <select v-model="filter.op" class="mf-select mf-filter-select" aria-label="Filter operator">
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value="LIKE">contains</option>
                </select>
                <input v-model="filter.value" class="mf-input mono mf-filter-value" placeholder="value" />
                <button class="mf-filter-rm" title="Remove" @click="removeLogFilter(i)">&times;</button>
              </div>
              <button class="mf-link-btn" @click="addLogFilter">+ Add field filter</button>
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
              placeholder="checkout-api or *"
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
              placeholder="/api/checkout or *"
            />
              <p class="mf-hint text-muted">Leave blank to average across the whole service. Use <code>*</code> or a pattern such as <code>/api/*</code> to split the preview by endpoint.</p>
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
                :fetch-suggestions="fetchApmGroupFields"
                :mono="true"
                placeholder="Add span field..."
                @select="addApmGroupBy"
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
              No existing alerts
            </div>
          </div>
          <div class="mf-field">
            <label class="mf-label">Formula</label>
            <input
              v-model="compositeConfig.formula"
              class="mf-input mono"
              placeholder="A && B && !C"
            />
            <div class="mf-hint text-muted">Use letters to reference alerts. Combine with && (AND), || (OR), ! (NOT)</div>
          </div>
        </template>
      </div>

      <!-- ═══ Section 3: Conditions ═══ -->
      <div class="mf-section">
        <div class="mf-section-label">Conditions</div>
        <div class="mf-condition-direction">
          <span class="mf-cond-text">Trigger when value is</span>
          <select v-model="comparator" class="mf-select mf-select-sm" aria-label="Alert comparator">
            <option value="above">greater than (&gt;)</option>
            <option value="above_or_equal">greater than or equal to (&ge;)</option>
            <option value="equal">equal to (=)</option>
            <option value="below_or_equal">less than or equal to (&le;)</option>
            <option value="below">less than (&lt;)</option>
          </select>
          <span class="mf-cond-text">the thresholds below</span>
        </div>
        <div class="mf-threshold-stack">
          <label class="mf-threshold-rule is-warning" for="monitor-warning-threshold">
            <span class="mf-threshold-rule-mark" aria-hidden="true"></span>
            <span class="mf-threshold-rule-copy">
              <strong>Warning</strong>
              <small>Optional</small>
            </span>
            <span class="mf-threshold-input-wrap">
              <input
                id="monitor-warning-threshold"
                v-model.number="warningThreshold"
                type="number"
                class="mf-input mf-input-num mono"
                :class="{ 'is-invalid': thresholdValidationError }"
                :max="higherValuesAreWorse && normalizedCriticalThreshold !== null ? normalizedCriticalThreshold : undefined"
                :min="lowerValuesAreWorse && normalizedCriticalThreshold !== null ? normalizedCriticalThreshold : undefined"
                :aria-invalid="Boolean(thresholdValidationError)"
                :aria-describedby="thresholdValidationError ? 'monitor-threshold-order-error' : undefined"
                placeholder="Not set"
                step="any"
              />
              <span v-if="thresholdUnit" class="mf-threshold-unit">{{ thresholdUnit }}</span>
            </span>
          </label>
          <label class="mf-threshold-rule is-alert" for="monitor-alert-threshold">
            <span class="mf-threshold-rule-mark" aria-hidden="true"></span>
            <span class="mf-threshold-rule-copy">
              <strong>Alert</strong>
              <small>Required</small>
            </span>
            <span class="mf-threshold-input-wrap">
              <input
                id="monitor-alert-threshold"
                v-model.number="criticalThreshold"
                type="number"
                class="mf-input mf-input-num mono"
                :class="{ 'is-invalid': thresholdValidationError }"
                :min="higherValuesAreWorse && normalizedWarningThreshold !== null ? normalizedWarningThreshold : undefined"
                :max="lowerValuesAreWorse && normalizedWarningThreshold !== null ? normalizedWarningThreshold : undefined"
                :aria-invalid="Boolean(thresholdValidationError)"
                :aria-describedby="thresholdValidationError ? 'monitor-threshold-order-error' : undefined"
                placeholder="500"
                step="any"
              />
              <span v-if="thresholdUnit" class="mf-threshold-unit">{{ thresholdUnit }}</span>
            </span>
          </label>
        </div>
        <p v-if="thresholdValidationError" id="monitor-threshold-order-error" class="mf-threshold-error" role="alert">
          {{ thresholdValidationError }}
        </p>
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
      <TimeSeriesPanel
        v-if="monitorType !== 'composite'"
        class="mf-preview-panel"
        title="Alert preview"
        description="Recent values for this query with the warning and critical thresholds overlaid."
        :series="previewSeries"
        :thresholds="previewThresholds"
        :unit="thresholdUnit"
        :series-name="previewSeriesName"
        :source-label="previewSourceLabel"
        :loading="previewLoading"
        show-chart-when-empty
        :empty-title="previewQueryReady ? 'No samples in this window' : 'Configure the query to see data'"
        :empty-message="previewQueryReady ? 'No matching data was returned. Try another query or a wider window.' : 'Choose a signal and finish its query fields. The preview updates automatically.'"
      >
        <template #actions>
          <div class="mf-preview-actions">
            <label class="mf-preview-lookback">
              <span>Lookback</span>
              <select v-model="previewLookbackSecs" aria-label="Preview lookback" @change="fetchPreview">
                <option v-for="option in previewLookbackOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
        </template>
        <template #details>
          <div v-if="previewError" class="mf-preview-error" role="alert">
            <span aria-hidden="true">!</span>
            <span>{{ previewError }}</span>
          </div>
          <details v-if="previewQueryReady" class="mf-backtest">
            <summary>
              <span class="mf-backtest-summary-copy">
                <strong>Would this alert have fired?</strong>
                <small v-if="!hasPreviewThreshold">Set a warning or critical threshold to test the selected history.</small>
                <small v-else-if="previewLoading">Checking {{ previewRangeLabel }} of history…</small>
                <small v-else-if="previewEvents.length">
                  {{ previewAlertCount }} alert{{ previewAlertCount === 1 ? '' : 's' }} and {{ previewRecoveryCount }} recover{{ previewRecoveryCount === 1 ? 'y' : 'ies' }} found.
                </small>
                <small v-else>No state changes found in the selected history.</small>
              </span>
              <span class="mf-backtest-summary-meta mono">{{ previewRangeLabel }}</span>
              <svg class="mf-backtest-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div class="mf-backtest-body">
              <p class="mf-backtest-note">
                Replays the current thresholds over {{ previewBucketLabel }} evaluation buckets. Use it to check whether this rule would have caught a past incident.
              </p>
              <div v-if="hasPreviewThreshold && previewEvents.length" class="mf-backtest-events">
                <div
                  v-for="(event, index) in previewEvents"
                  :key="`${event.timestamp}-${event.group_key}-${event.state}-${index}`"
                  class="mf-backtest-event"
                >
                  <span class="mf-backtest-state" :class="`is-${event.state}`">
                    {{ previewEventLabel(event.state) }}
                  </span>
                  <span class="mf-backtest-time">{{ formatPreviewEventTime(event.timestamp) }}</span>
                  <span class="mf-backtest-group" :title="event.group_key || 'All matching data'">
                    {{ event.group_key || 'All matching data' }}
                  </span>
                  <span class="mf-backtest-value mono">
                    {{ formatPreviewValue(event.value) }}
                    <small v-if="event.threshold != null">at {{ formatPreviewValue(event.threshold) }}</small>
                  </span>
                </div>
              </div>
              <div v-else class="mf-backtest-empty">
                {{ hasPreviewThreshold ? 'No warning, alert, or recovery transitions were found.' : 'Add a threshold, then open this review again.' }}
              </div>
            </div>
          </details>
        </template>
      </TimeSeriesPanel>

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
          <p class="mf-template-vars text-muted">
            Use in the name or message:
            <code v-pre>{{service}}</code>
            <code v-pre>{{endpoint}}</code>
            <code v-pre>{{value}}</code>
            <code v-pre>{{threshold}}</code>
            <code v-pre>{{state}}</code>
          </p>
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
            <p class="mf-hint text-muted">
              Direct channels are added to every matching
              <router-link to="/settings#alerting">routing rule</router-link>.
            </p>
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
          :disabled="saving || !canSave"
          @click="handleSave"
        >
          {{ saving ? 'Saving...' : (isEditing ? 'Update alert' : 'Save alert') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/components/MonitorWizard.css"></style>
