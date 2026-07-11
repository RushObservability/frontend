<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { useApi } from '../composables/useApi'
import type { RushEvent, Filter } from '../types'

const props = withDefaults(defineProps<{
  spans: RushEvent[]
  showService?: boolean
  loading?: boolean
  serviceName?: string
  minutes?: number
  resultLimit?: number
  hasMore?: boolean
  loadingMore?: boolean
  // When set, pins the view to spans or logs and hides the internal toggle —
  // used when Spans and Logs are surfaced as separate top-level tabs.
  forceMode?: 'spans' | 'logs'
}>(), {
  showService: true,
  loading: false,
  minutes: 60,
  resultLimit: 100,
  hasMore: false,
  loadingMore: false,
})

const emit = defineEmits<{
  (e: 'click-span', span: RushEvent): void
  (e: 'click-trace', traceId: string): void
  (e: 'load-more'): void
}>()

const api = useApi()

// ═══ Mode toggle ═══
// Defaults to spans, or follows `forceMode` when the parent pins it.
const mode = ref<'spans' | 'logs'>(props.forceMode ?? 'spans')
watch(() => props.forceMode, (m) => { if (m) mode.value = m })

// ═══ Search state ═══
const searchInput = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const searchActive = ref(false)
const searchLoading = ref(false)
const searchResults = ref<RushEvent[]>([])
const searchFilters = ref<Filter[]>([])
const searchText = ref('')

// Show search bar only when pinned to a service
const showSearch = computed(() => !!props.serviceName)

// Use search results when a search is active, otherwise use prop data
const displaySpans = computed(() => searchActive.value ? searchResults.value : props.spans)
const isLoading = computed(() => searchLoading.value || props.loading)

// ═══ Autocomplete ═══
const KNOWN_FIELDS = [
  'service_name', 'service_version', 'environment', 'host_name',
  'http_method', 'http_path', 'http_status_code', 'status', 'duration_ns',
  'trace_id', 'span_id',
  'attributes.user.id', 'attributes.user.email', 'attributes.user.subscription.plan',
  'attributes.db.system', 'attributes.db.operation', 'attributes.db.table',
  'attributes.cache.system', 'attributes.cache.operation', 'attributes.cache.hit',
  'attributes.gateway.route', 'attributes.email.status', 'attributes.email.provider',
]
const OPERATORS = ['=', '!=', '>=', '<=', '>', '<']

const acItems = ref<{ label: string; insert: string; kind: 'field' | 'op' | 'value' }[]>([])
const acIndex = ref(0)
const acVisible = ref(false)
let acDebounce: ReturnType<typeof setTimeout> | null = null

function getCurrentToken(): { token: string; start: number; end: number } {
  const el = searchInputEl.value
  if (!el) return { token: '', start: 0, end: 0 }
  const pos = el.selectionStart ?? searchInput.value.length
  const text = searchInput.value
  let start = pos
  while (start > 0 && text[start - 1] !== ' ') start--
  return { token: text.slice(start, pos), start, end: pos }
}

function onSearchInput() {
  if (acDebounce) clearTimeout(acDebounce)
  acDebounce = setTimeout(() => updateAutocomplete(), 120)
}

async function updateAutocomplete() {
  const { token } = getCurrentToken()
  if (!token) { acVisible.value = false; return }

  const opMatch = token.match(/^([^=!<>]+)(=|!=|>=|<=|>|<)(.*)$/)
  if (opMatch) {
    const field = opMatch[1]
    const prefix = opMatch[3] || ''
    try {
      const vals = await api.suggestValues(field!, prefix)
      if (!vals.length) { acVisible.value = false; return }
      acItems.value = vals.slice(0, 12).map(v => ({
        label: v,
        insert: `${field}${opMatch[2]}${v}`,
        kind: 'value' as const,
      }))
      acIndex.value = 0
      acVisible.value = true
    } catch { acVisible.value = false }
    return
  }

  const exactField = KNOWN_FIELDS.find(f => f === token)
  if (exactField) {
    acItems.value = OPERATORS.map(op => ({
      label: `${exactField}${op}`,
      insert: `${exactField}${op}`,
      kind: 'op' as const,
    }))
    acIndex.value = 0
    acVisible.value = true
    return
  }

  const lower = token.toLowerCase()
  const matches = KNOWN_FIELDS.filter(f => f.toLowerCase().includes(lower))
  if (matches.length) {
    acItems.value = matches.slice(0, 12).map(f => ({
      label: f,
      insert: f,
      kind: 'field' as const,
    }))
    acIndex.value = 0
    acVisible.value = true
  } else {
    acVisible.value = false
  }
}

function acSelect(item: typeof acItems.value[0]) {
  const { start } = getCurrentToken()
  const before = searchInput.value.slice(0, start)
  const afterPos = searchInputEl.value?.selectionStart ?? searchInput.value.length
  const after = searchInput.value.slice(afterPos)
  const needsSpace = item.kind === 'value'
  searchInput.value = before + item.insert + (needsSpace ? ' ' : '') + after
  acVisible.value = false
  nextTick(() => {
    const newPos = before.length + item.insert.length + (needsSpace ? 1 : 0)
    searchInputEl.value?.setSelectionRange(newPos, newPos)
    searchInputEl.value?.focus()
  })
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!acVisible.value) {
    if (e.key === 'Enter') runSearch()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    acIndex.value = Math.max(acIndex.value - 1, 0)
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    if (acItems.value[acIndex.value]) acSelect(acItems.value[acIndex.value]!)
  } else if (e.key === 'Escape') {
    acVisible.value = false
  }
}

function onSearchBlur() {
  setTimeout(() => { acVisible.value = false }, 150)
}

// ═══ Search execution ═══
function parseSearchInput() {
  const input = searchInput.value.trim()
  const newFilters: Filter[] = []
  const textParts: string[] = []

  let i = 0
  while (i < input.length) {
    if (input[i] === ' ' || input[i] === '\t') { i++; continue }
    if (input[i] === '"') {
      const start = i
      i++
      while (i < input.length && input[i] !== '"') i++
      if (i < input.length) i++
      textParts.push(input.substring(start, i))
    } else {
      let word = ''
      while (i < input.length && input[i] !== ' ' && input[i] !== '\t' && input[i] !== '"') {
        word += input[i]; i++
      }
      if (!word) continue
      if (word.toUpperCase() === 'OR' || word.toUpperCase() === 'AND') {
        textParts.push(word)
      } else {
        const match = word.match(/^([^=!<>]+)(!=|>=|<=|=|>|<)(.+)$/)
        if (match) {
          const field = match[1] ?? ''
          const op = match[2] ?? '='
          const value = match[3] ?? ''
          const numVal = Number(value)
          newFilters.push({ field, op, value: isNaN(numVal) ? value : numVal })
        } else {
          textParts.push(word)
        }
      }
    }
  }
  searchFilters.value = newFilters
  searchText.value = textParts.join(' ')
}

async function runSearch() {
  if (!props.serviceName) return
  parseSearchInput()

  // If input is empty, clear search and revert to prop data
  if (searchFilters.value.length === 0 && !searchText.value) {
    clearSearch()
    return
  }

  searchLoading.value = true
  searchActive.value = true

  const now = new Date()
  const from = new Date(now.getTime() - props.minutes * 60 * 1000).toISOString()
  const to = now.toISOString()

  // Always pin the service filter
  const filters: Filter[] = [
    { field: 'service_name', op: '=', value: props.serviceName },
    ...searchFilters.value,
  ]

  try {
    const data = await api.queryEvents({
      time_range: { from, to },
      filters,
      limit: props.resultLimit,
      search: searchText.value || undefined,
    })
    searchResults.value = data.rows
  } catch {
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

function clearSearch() {
  searchInput.value = ''
  searchFilters.value = []
  searchText.value = ''
  searchActive.value = false
  searchResults.value = []
}

// Clear search results when time range changes
watch(() => props.minutes, () => {
  if (searchActive.value) runSearch()
})

// ═══ Log extraction from span events ═══
interface LogEntry {
  id: string
  timestamp: number
  level: string
  message: string
  eventName: string
  attributes: Record<string, unknown>
  spanId: string
  traceId: string
  serviceName: string
  serviceVersion: string
  environment: string
  hostName: string
  httpMethod: string
  httpPath: string
  httpStatusCode: number
  durationNs: number
}

const selectedLogId = ref<string | null>(null)
const loadMoreRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

const logs = computed<LogEntry[]>(() => {
  const entries: LogEntry[] = []
  for (const row of displaySpans.value) {
    if (!row.event_names?.length) continue
    for (let i = 0; i < row.event_names.length; i++) {
      let attrs: Record<string, unknown> = {}
      try { attrs = JSON.parse(row.event_attributes[i] || '{}') } catch { /* skip */ }
      const message = (attrs['log.message'] as string) || (attrs['exception.message'] as string) || row.event_names[i] || ''
      const level = ((attrs['log.level'] as string) || (attrs['log.severity'] as string) || '').toLowerCase()
      entries.push({
        id: `${row.trace_id}:${row.span_id}:${row.event_timestamps[i] ?? row.timestamp}:${i}`,
        timestamp: row.event_timestamps[i] ?? row.timestamp,
        level: level || 'info',
        message,
        eventName: row.event_names[i] || 'log',
        attributes: attrs,
        spanId: row.span_id,
        traceId: row.trace_id,
        serviceName: row.service_name,
        serviceVersion: row.service_version,
        environment: row.environment,
        hostName: row.host_name,
        httpMethod: row.http_method,
        httpPath: row.http_path,
        httpStatusCode: row.http_status_code,
        durationNs: row.duration_ns,
      })
    }
  }
  entries.sort((a, b) => b.timestamp - a.timestamp)
  return entries
})

// ═══ Formatters ═══
function formatTimestamp(ns: number): string {
  const d = new Date(ns / 1_000_000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  const ms = d.getMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function formatDuration(ns: number): string {
  const ms = ns / 1_000_000
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(1)}ms`
  return `${(ms * 1000).toFixed(0)}us`
}

function statusClass(status: string, code: number): string {
  if (status === 'ERROR' || code >= 500) return 'status-error'
  if (code >= 400) return 'status-warning'
  return 'status-ok'
}

function durationClass(ns: number): string {
  if (ns >= 1_000_000_000) return 'dur-slow'
  if (ns >= 500_000_000) return 'dur-warn'
  if (ns >= 100_000_000) return 'dur-med'
  return 'dur-fast'
}

const maxDuration = computed(() => Math.max(...displaySpans.value.map(r => r.duration_ns), 1))

function durBarWidth(ns: number): string {
  return `${Math.max((ns / maxDuration.value) * 100, 2)}%`
}

function durBarColor(ns: number): string {
  if (ns >= 1_000_000_000) return 'var(--error)'
  if (ns >= 500_000_000) return '#e88a40'
  if (ns >= 100_000_000) return 'var(--warning)'
  return 'var(--ok)'
}

function levelClass(level: string): string {
  if (level === 'error' || level === 'fatal') return 'lvl-error'
  if (level === 'warn' || level === 'warning') return 'lvl-warn'
  if (level === 'debug' || level === 'trace') return 'lvl-debug'
  return 'lvl-info'
}

const logCounts = computed(() => {
  const out = { error: 0, warn: 0, info: 0, debug: 0 }
  for (const log of logs.value) {
    if (log.level === 'error' || log.level === 'fatal') out.error++
    else if (log.level === 'warn' || log.level === 'warning') out.warn++
    else if (log.level === 'debug' || log.level === 'trace') out.debug++
    else out.info++
  }
  return out
})

function logShare(count: number): string {
  return `${logs.value.length ? (count / logs.value.length) * 100 : 0}%`
}

function toggleLog(log: LogEntry) {
  selectedLogId.value = selectedLogId.value === log.id ? null : log.id
}

function detailAttributes(log: LogEntry): [string, unknown][] {
  const hidden = new Set(['log.message', 'exception.message', 'log.level', 'log.severity'])
  return Object.entries(log.attributes)
    .filter(([key]) => !hidden.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
}

function formatAttribute(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function humanRange(): string {
  const m = props.minutes
  if (m % 1440 === 0) return `${m / 1440}d`
  if (m % 60 === 0) return `${m / 60}h`
  return `${m}m`
}

function setupLoadMoreObserver() {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (!loadMoreRef.value || !props.hasMore || props.loadingMore || searchActive.value || mode.value !== 'logs') return
  if (typeof IntersectionObserver === 'undefined') return
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && props.hasMore && !props.loadingMore) emit('load-more')
  }, { rootMargin: '500px 0px' })
  loadMoreObserver.observe(loadMoreRef.value)
}

// Re-arm after every appended page. If a sparse page still leaves the sentinel
// near the viewport, the next page loads automatically until scrolling space
// is filled or the selected time window is exhausted.
watch(
  [() => props.hasMore, () => props.loadingMore, () => logs.value.length, searchActive, mode],
  () => nextTick(setupLoadMoreObserver),
  { immediate: true },
)
onBeforeUnmount(() => loadMoreObserver?.disconnect())
</script>

<template>
  <div class="slt-root" :class="{ 'slt-logs-mode': mode === 'logs' }">
    <!-- Header bar -->
    <div class="slt-header">
      <div v-if="!forceMode" class="slt-toggle">
        <button
          class="slt-mode-btn"
          :class="{ active: mode === 'spans' }"
          @click="mode = 'spans'"
        >Spans <span class="slt-count">{{ displaySpans.length }}</span></button>
        <button
          class="slt-mode-btn"
          :class="{ active: mode === 'logs' }"
          @click="mode = 'logs'"
        >Logs <span class="slt-count">{{ logs.length }}</span></button>
      </div>
      <div v-else-if="mode === 'logs'" class="slt-log-heading">
        <span class="slt-log-mark" aria-hidden="true" />
        <div>
          <div class="slt-log-title">Log stream</div>
          <div class="slt-log-subtitle">{{ serviceName }} · last {{ humanRange() }}</div>
        </div>
      </div>
      <div v-else class="slt-count-label">{{ displaySpans.length }} spans</div>
      <div v-if="forceMode && mode === 'logs'" class="slt-log-counters" aria-label="Log level counts">
        <span class="slt-log-counter"><strong class="mono">{{ logs.length }}</strong> events</span>
        <span v-if="logCounts.error" class="slt-log-counter is-error"><strong class="mono">{{ logCounts.error }}</strong> errors</span>
        <span v-if="logCounts.warn" class="slt-log-counter is-warn"><strong class="mono">{{ logCounts.warn }}</strong> warnings</span>
      </div>
      <button v-if="searchActive" class="slt-clear-btn" @click="clearSearch">Clear</button>
    </div>

    <!-- ═══ Search bar ═══ -->
    <div v-if="showSearch" class="slt-search-row">
      <span class="slt-pinned-svc mono">{{ serviceName }}</span>
      <div class="slt-search-bar">
        <span class="slt-search-prompt mono">$</span>
        <input
          ref="searchInputEl"
          v-model="searchInput"
          class="slt-search-input"
          :placeholder="mode === 'logs' ? 'Search log messages or filter status=ERROR' : 'http_method=GET status=ERROR — filters + free text'"
          @input="onSearchInput"
          @keydown="onSearchKeydown"
          @blur="onSearchBlur"
          @focus="onSearchInput"
        />
        <button class="slt-search-btn" @click="runSearch">Run</button>
        <!-- Autocomplete dropdown -->
        <div v-if="acVisible && acItems.length" class="slt-ac-dropdown">
          <div
            v-for="(item, i) in acItems"
            :key="i"
            class="slt-ac-item"
            :class="{ 'slt-ac-active': acIndex === i, ['slt-ac-kind-' + item.kind]: true }"
            @mousedown.prevent="acSelect(item)"
            @mouseenter="acIndex = i"
          >
            <span class="slt-ac-badge mono">{{ item.kind === 'field' ? 'field' : item.kind === 'op' ? 'op' : 'val' }}</span>
            <span class="slt-ac-label mono">{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Spans table ═══ -->
    <template v-if="mode === 'spans'">
      <div class="slt-head">
        <div class="slt-col slt-col-time">Time</div>
        <div v-if="showService" class="slt-col slt-col-svc">Service</div>
        <div class="slt-col slt-col-method">Method</div>
        <div class="slt-col slt-col-path">Resource</div>
        <div class="slt-col slt-col-status">Status</div>
        <div class="slt-col slt-col-dur">Duration</div>
        <div class="slt-col slt-col-trace">Trace</div>
      </div>

      <div v-if="isLoading" class="slt-empty">Loading spans...</div>
      <div v-else-if="displaySpans.length === 0" class="slt-empty">{{ searchActive ? 'No spans match your search' : 'No spans found in this time range' }}</div>
      <template v-else>
        <div
          v-for="(row, i) in displaySpans"
          :key="row.span_id || i"
          class="slt-row"
          :class="{ 'slt-error': row.status === 'ERROR' || row.http_status_code >= 500 }"
          @click="emit('click-span', row)"
        >
          <div class="slt-col slt-col-time mono">{{ formatTimestamp(row.timestamp) }}</div>
          <div v-if="showService" class="slt-col slt-col-svc">
            <span class="slt-svc-name">{{ row.service_name }}</span>
          </div>
          <div class="slt-col slt-col-method">
            <span class="method-badge" :class="row.http_method">{{ row.http_method }}</span>
          </div>
          <div class="slt-col slt-col-path mono">{{ row.http_path || '\u2014' }}</div>
          <div class="slt-col slt-col-status">
            <span class="mono" :class="statusClass(row.status, row.http_status_code)">{{ row.http_status_code || '\u2014' }}</span>
          </div>
          <div class="slt-col slt-col-dur">
            <div class="slt-dur-bar">
              <div class="slt-dur-fill" :style="{ width: durBarWidth(row.duration_ns), background: durBarColor(row.duration_ns) }" />
            </div>
            <span class="mono" :class="durationClass(row.duration_ns)">{{ formatDuration(row.duration_ns) }}</span>
          </div>
          <div class="slt-col slt-col-trace">
            <router-link
              :to="`/trace/${row.trace_id}`"
              class="slt-trace-link mono"
              @click.stop
              title="View full trace"
            >{{ row.trace_id.slice(0, 8) }}</router-link>
          </div>
        </div>
      </template>
    </template>

    <!-- ═══ Logs table ═══ -->
    <template v-if="mode === 'logs'">
      <div v-if="logs.length" class="slt-level-distribution" aria-label="Log severity distribution">
        <span v-if="logCounts.error" class="dist-error" :style="{ width: logShare(logCounts.error) }" :title="`${logCounts.error} errors`" />
        <span v-if="logCounts.warn" class="dist-warn" :style="{ width: logShare(logCounts.warn) }" :title="`${logCounts.warn} warnings`" />
        <span v-if="logCounts.info" class="dist-info" :style="{ width: logShare(logCounts.info) }" :title="`${logCounts.info} info`" />
        <span v-if="logCounts.debug" class="dist-debug" :style="{ width: logShare(logCounts.debug) }" :title="`${logCounts.debug} debug`" />
      </div>
      <div class="slt-head">
        <div class="slt-col slt-col-time">Time</div>
        <div class="slt-col slt-col-level">Level</div>
        <div v-if="showService" class="slt-col slt-col-svc">Service</div>
        <div class="slt-col slt-col-msg">Message</div>
        <div class="slt-col slt-col-trace">Detail</div>
      </div>

      <div v-if="isLoading" class="slt-empty">Loading logs...</div>
      <div v-else-if="logs.length === 0" class="slt-empty">{{ searchActive ? 'No logs match your search' : 'No log events found in this time range' }}</div>
      <template v-else>
        <div v-for="log in logs" :key="log.id" class="slt-log-group" :class="{ expanded: selectedLogId === log.id }">
          <div
            class="slt-row slt-log-row"
            :class="{ 'slt-error': log.level === 'error' || log.level === 'fatal' }"
            role="button"
            tabindex="0"
            :aria-expanded="selectedLogId === log.id"
            @click="toggleLog(log)"
            @keydown.enter.prevent="toggleLog(log)"
            @keydown.space.prevent="toggleLog(log)"
          >
            <div class="slt-col slt-col-time mono">{{ formatTimestamp(log.timestamp) }}</div>
            <div class="slt-col slt-col-level">
              <span class="slt-level-badge" :class="levelClass(log.level)">{{ log.level }}</span>
            </div>
            <div v-if="showService" class="slt-col slt-col-svc">
              <span class="slt-svc-name">{{ log.serviceName }}</span>
            </div>
            <div class="slt-col slt-col-msg">{{ log.message }}</div>
            <div class="slt-col slt-col-trace">
              <span class="slt-open-log">{{ selectedLogId === log.id ? 'Close' : 'Inspect' }}</span>
            </div>
          </div>

          <div v-if="selectedLogId === log.id" class="slt-log-detail" @click.stop>
            <div class="slt-log-detail-message">{{ log.message }}</div>

            <div class="slt-log-meta-strip">
              <div><span>Event</span><strong class="mono">{{ log.eventName }}</strong></div>
              <div><span>Timestamp</span><strong class="mono">{{ formatTimestamp(log.timestamp) }}</strong></div>
              <div v-if="log.environment"><span>Environment</span><strong>{{ log.environment }}</strong></div>
              <div v-if="log.hostName"><span>Host</span><strong class="mono">{{ log.hostName }}</strong></div>
              <div v-if="log.httpPath"><span>Request</span><strong class="mono">{{ log.httpMethod }} {{ log.httpPath }}</strong></div>
              <div v-if="log.httpStatusCode"><span>Status</span><strong class="mono" :class="statusClass('', log.httpStatusCode)">{{ log.httpStatusCode }}</strong></div>
            </div>

            <div v-if="detailAttributes(log).length" class="slt-log-fields">
              <div class="slt-log-section-title">Structured fields <span>{{ detailAttributes(log).length }}</span></div>
              <div class="slt-log-field-grid">
                <div v-for="([key, value]) in detailAttributes(log)" :key="key" class="slt-log-field">
                  <span class="slt-log-field-key">{{ key }}</span>
                  <span class="slt-log-field-value mono" :title="formatAttribute(value)">{{ formatAttribute(value) }}</span>
                </div>
              </div>
            </div>

            <div class="slt-log-detail-footer">
              <div class="slt-log-correlation">
                <span>trace <strong class="mono">{{ log.traceId.slice(0, 16) }}</strong></span>
                <span>span <strong class="mono">{{ log.spanId.slice(0, 16) }}</strong></span>
                <span v-if="log.durationNs">parent duration <strong class="mono">{{ formatDuration(log.durationNs) }}</strong></span>
              </div>
              <router-link :to="`/trace/${log.traceId}`" class="slt-view-trace" @click.stop>View correlated trace →</router-link>
            </div>
          </div>
        </div>
        <div
          v-if="!searchActive && (hasMore || loadingMore)"
          ref="loadMoreRef"
          class="slt-load-more"
          aria-live="polite"
        >
          <span v-if="loadingMore" class="slt-load-spinner" aria-hidden="true" />
          <span>{{ loadingMore ? 'Loading older logs…' : 'More logs available' }}</span>
          <button v-if="hasMore && !loadingMore" @click="emit('load-more')">Load older logs</button>
        </div>
        <div v-else-if="!searchActive && logs.length" class="slt-log-end">End of selected time window · {{ logs.length }} logs</div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../styles/components/SpanLogTable.css"></style>
