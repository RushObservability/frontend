<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { LogRecord, Filter, CountBucket } from '../types'
import TimePicker from '../components/TimePicker.vue'

const router = useRouter()

const api = useApi()
const { features } = useFeatures()

// ═══ Time range ═══
const selectedPreset = ref(60)

const timeRange = computed(() => {
  const to = new Date()
  const from = new Date(to.getTime() - selectedPreset.value * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
})

// ═══ Search ═══
const searchInput = ref('')
const filters = ref<Filter[]>([])
const results = ref<LogRecord[]>([])
const total = ref(0)
const histogram = ref<CountBucket[]>([])
const PAGE_SIZE = 100
const loadingMore = ref(false)
const hasMore = computed(() => results.value.length < total.value)
const expandedRow = ref<number | null>(null)

// ═══ Quick filters ═══
const severityFilter = ref<string | null>(null)
const serviceFilter = ref<string | null>(null)

function parseSearch() {
  const raw = searchInput.value.trim()
  if (!raw) { filters.value = []; return }

  const newFilters: Filter[] = []
  const parts = raw.split(/\s+/)
  const textParts: string[] = []

  for (const part of parts) {
    const opMatch = part.match(/^([a-zA-Z0-9_.]+)(=|!=|>=|<=|>|<|~)(.+)$/)
    if (opMatch) {
      const [, field, rawOp, value] = opMatch
      const opMap: Record<string, string> = { '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=', '~': 'LIKE' }
      const op = opMap[rawOp!] || '='
      newFilters.push({ field: field!, op, value: value! })
    } else {
      textParts.push(part)
    }
  }
  filters.value = newFilters
  searchInput.value = textParts.concat(newFilters.map(f => `${f.field}${f.op}${f.value}`)).join(' ')
}

function getActiveFilters(): Filter[] {
  parseSearch()
  const all = [...filters.value]
  if (severityFilter.value) all.push({ field: 'severity_text', op: '=', value: severityFilter.value })
  if (serviceFilter.value) all.push({ field: 'service_name', op: '=', value: serviceFilter.value })
  return all
}

async function search() {
  const activeFilters = getActiveFilters()
  const searchParam = searchInput.value.replace(/\S+=\S+/g, '').trim() || undefined

  try {
    const [logsResult, countResult] = await Promise.allSettled([
      api.queryLogs({
        time_range: timeRange.value,
        filters: activeFilters,
        limit: PAGE_SIZE,
        search: searchParam,
      }),
      api.countLogs({
        time_range: timeRange.value,
        filters: activeFilters,
        interval: selectedPreset.value <= 60 ? '1m' : selectedPreset.value <= 360 ? '5m' : '1h',
        search: searchParam,
      }),
    ])

    if (logsResult.status === 'fulfilled') {
      results.value = logsResult.value.rows
      total.value = logsResult.value.total
    }
    if (countResult.status === 'fulfilled') {
      histogram.value = countResult.value
    }
  } catch { /* captured in api.error */ }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const activeFilters = getActiveFilters()
    const searchParam = searchInput.value.replace(/\S+=\S+/g, '').trim() || undefined
    const res = await api.queryLogs({
      time_range: timeRange.value,
      filters: activeFilters,
      limit: PAGE_SIZE,
      offset: results.value.length,
      search: searchParam,
    })
    results.value = [...results.value, ...res.rows]
    total.value = res.total
  } catch { /* captured */ }
  finally { loadingMore.value = false }
}

function toggleRow(i: number) {
  expandedRow.value = expandedRow.value === i ? null : i
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') search()
}

function addFilter(field: string, value: string) {
  const existing = searchInput.value.trim()
  const token = `${field}=${value}`
  if (!existing.includes(token)) {
    searchInput.value = existing ? `${existing} ${token}` : token
  }
  search()
}

function clearSeverityFilter() {
  severityFilter.value = null
  search()
}

function setSeverityFilter(sev: string) {
  severityFilter.value = severityFilter.value === sev ? null : sev
  search()
}

function clearServiceFilter() {
  serviceFilter.value = null
  search()
}

// ═══ Histogram ═══
const histogramMax = computed(() => Math.max(...histogram.value.map(b => b.count), 1))
const hoveredBucket = ref<number | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)

const hoveredBucketData = computed(() => {
  if (hoveredBucket.value === null) return null
  const b = histogram.value[hoveredBucket.value]
  if (!b) return null
  const t = new Date(b.bucket)
  const hh = t.getHours().toString().padStart(2, '0')
  const mm = t.getMinutes().toString().padStart(2, '0')
  return {
    time: `${hh}:${mm}`,
    total: b.count,
    ok: b.count - (b.error_count || 0),
    errors: b.error_count || 0,
    errRate: b.count ? (((b.error_count || 0) / b.count) * 100).toFixed(1) : '0.0',
  }
})

function onBarEnter(i: number, e: MouseEvent) {
  hoveredBucket.value = i
  tooltipX.value = (e.target as HTMLElement).offsetLeft
  tooltipY.value = (e.target as HTMLElement).offsetTop
}
function onBarLeave() { hoveredBucket.value = null }

// ═══ Formatters ═══
function formatTimestamp(ts: number): string {
  // Timestamp is nanoseconds from epoch (DateTime64(9))
  const ms = ts / 1_000_000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return String(ts)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  const millis = d.getMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${millis}`
}

function severityClass(sev: string): string {
  switch (sev?.toUpperCase()) {
    case 'ERROR': case 'FATAL': case 'CRITICAL': return 'sev-error'
    case 'WARN': case 'WARNING': return 'sev-warn'
    case 'DEBUG': case 'TRACE': return 'sev-debug'
    default: return 'sev-info'
  }
}

function truncateBody(body: string, max = 200): string {
  return body.length > max ? body.slice(0, max) + '...' : body
}

const HIDDEN_ATTR_PREFIXES = ['k8s.', 'host.']
function filterAttrs(attrs: Record<string, string>): [string, string][] {
  return Object.entries(attrs || {}).filter(([k]) => !HIDDEN_ATTR_PREFIXES.some(p => k.startsWith(p)))
}

function isJson(str: string): boolean {
  const t = str.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function formatJson(str: string): string {
  try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

function copyLogJson(row: LogRecord) {
  const obj = {
    timestamp: new Date(row.Timestamp / 1_000_000).toISOString(),
    service: row.ServiceName,
    severity: row.SeverityText,
    body: row.Body,
    trace_id: row.TraceId || undefined,
    span_id: row.SpanId || undefined,
    scope: row.ScopeName || undefined,
    resource_attributes: row.ResourceAttributes,
    log_attributes: row.LogAttributes,
  }
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
}

function investigateLog(row: LogRecord) {
  const ts = new Date(row.Timestamp / 1_000_000).toISOString()
  const ctx = [
    `Log entry from ${row.ServiceName} at ${ts}`,
    `Severity: ${row.SeverityText}`,
    `Message: ${row.Body.slice(0, 500)}`,
    row.TraceId ? `Trace ID: ${row.TraceId}` : '',
    row.SpanId ? `Span ID: ${row.SpanId}` : '',
  ].filter(Boolean).join('\n')

  router.push({
    path: '/investigate',
    query: {
      q: `Investigate this ${row.SeverityText} log from ${row.ServiceName}: "${row.Body.slice(0, 100)}"`,
      ctx,
    },
  })
}

// ═══ Init ═══
onMounted(() => search())
</script>

<template>
  <div class="logs-view">
    <!-- ═══ Header ═══ -->
    <div class="logs-header">
      <h1 class="logs-title">Logs</h1>
      <div class="logs-controls">
        <TimePicker v-model="selectedPreset" />
      </div>
    </div>

    <!-- ═══ Search Bar ═══ -->
    <div class="search-section card">
      <div class="search-row">
        <input
          v-model="searchInput"
          class="search-input mono"
          placeholder="Search logs... (e.g. error or service_name=gateway severity_text=ERROR)"
          @keydown="handleSearchKeydown"
        />
        <button class="btn btn-search" @click="search">Search</button>
      </div>
      <!-- Quick filters -->
      <div class="quick-filters">
        <div class="qf-group">
          <span class="qf-label">Severity:</span>
          <button
            v-for="sev in ['DEBUG', 'INFO', 'WARN', 'ERROR']"
            :key="sev"
            class="qf-pill"
            :class="{ active: severityFilter === sev, [severityClass(sev)]: true }"
            @click="setSeverityFilter(sev)"
          >
            {{ sev }}
          </button>
          <button v-if="severityFilter" class="qf-clear" @click="clearSeverityFilter">&#10005;</button>
        </div>
        <div v-if="serviceFilter" class="qf-group">
          <span class="qf-label">Service:</span>
          <span class="qf-active mono">{{ serviceFilter }}</span>
          <button class="qf-clear" @click="clearServiceFilter">&#10005;</button>
        </div>
        <div class="qf-total mono">
          {{ total.toLocaleString() }} logs
        </div>
      </div>
    </div>

    <!-- ═══ Histogram ═══ -->
    <div v-if="histogram.length" class="histogram-section card">
      <div class="histogram-strip" @mouseleave="onBarLeave">
        <div
          v-for="(bucket, i) in histogram"
          :key="i"
          class="histo-col"
          :class="{ 'histo-col-active': hoveredBucket === i }"
          @mouseenter="onBarEnter(i, $event)"
          @mouseleave="onBarLeave"
        >
          <div class="histo-stack" :style="{ height: `${(bucket.count / histogramMax) * 100}%` }">
            <div
              class="histo-bar histo-bar-ok"
              :style="{ flexBasis: `${((bucket.count - (bucket.error_count || 0)) / bucket.count) * 100}%` }"
            />
            <div
              v-if="bucket.error_count"
              class="histo-bar histo-bar-err"
              :style="{ flexBasis: `${(bucket.error_count / bucket.count) * 100}%` }"
            />
          </div>
        </div>
        <!-- Tooltip -->
        <div
          v-if="hoveredBucketData"
          class="histo-tooltip"
          :style="{ left: `${tooltipX}px`, top: `${tooltipY - 8}px` }"
        >
          <div class="htt-time mono">{{ hoveredBucketData.time }}</div>
          <div class="htt-row">
            <span class="htt-label">Total</span>
            <span class="htt-val mono">{{ hoveredBucketData.total }}</span>
          </div>
          <div class="htt-row">
            <span class="histo-legend-dot histo-dot-ok" />
            <span class="htt-label">OK</span>
            <span class="htt-val mono">{{ hoveredBucketData.ok }}</span>
          </div>
          <div class="htt-row">
            <span class="histo-legend-dot histo-dot-err" />
            <span class="htt-label">Errors</span>
            <span class="htt-val mono htt-err">{{ hoveredBucketData.errors }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ States ═══ -->
    <div v-if="api.loading.value && !results.length" class="empty-state card">
      <div class="empty-state-icon">&#9676;</div>
      <div>Querying...</div>
    </div>
    <div v-else-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon status-error">&#10005;</div>
      <div class="mono" style="font-size: 11px">{{ api.error.value }}</div>
    </div>
    <div v-else-if="!results.length && !api.loading.value" class="empty-state card">
      <div class="empty-state-icon">&#9671;</div>
      <div>No logs found</div>
      <div class="text-muted" style="font-size: 11px">Try a broader time range or different search terms</div>
    </div>

    <!-- ═══ Log Table ═══ -->
    <div v-else class="event-table card">
      <div class="et-head">
        <div class="et-col et-col-time">Time</div>
        <div class="et-col et-col-sev">Severity</div>
        <div class="et-col et-col-svc">Service</div>
        <div class="et-col et-col-body">Body</div>
      </div>

      <template v-for="(row, i) in results" :key="i">
        <div
          class="et-row"
          :class="{
            'et-selected': expandedRow === i,
            'et-error': row.SeverityText === 'ERROR' || row.SeverityText === 'FATAL',
          }"
          @click="toggleRow(i)"
        >
          <div class="et-col et-col-time mono">{{ formatTimestamp(row.Timestamp) }}</div>
          <div class="et-col et-col-sev">
            <span class="sev-badge" :class="severityClass(row.SeverityText)">{{ row.SeverityText || 'INFO' }}</span>
          </div>
          <div class="et-col et-col-svc">
            <span class="svc-badge" @click.stop="addFilter('service_name', row.ServiceName)">{{ row.ServiceName }}</span>
          </div>
          <div class="et-col et-col-body mono">{{ truncateBody(row.Body) }}</div>
        </div>

        <!-- ═══ Expanded Detail ═══ -->
        <div v-if="expandedRow === i" class="et-detail">
          <!-- Toolbar -->
          <div class="ld-toolbar">
            <div class="ld-toolbar-left">
              <span class="sev-badge" :class="severityClass(row.SeverityText)">{{ row.SeverityText || 'INFO' }}</span>
              <span class="ld-svc" @click.stop="addFilter('service_name', row.ServiceName)">{{ row.ServiceName }}</span>
              <span class="ld-ts mono">{{ new Date(row.Timestamp / 1_000_000).toISOString() }}</span>
            </div>
            <div class="ld-toolbar-right">
              <router-link v-if="row.TraceId" :to="`/trace/${row.TraceId}`" class="ld-action" @click.stop title="View trace">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Trace
              </router-link>
              <button class="ld-action" @click.stop="copyLogJson(row)" title="Copy as JSON">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy JSON
              </button>
              <button v-if="features.sre_agent" class="btn-investigate" @click.stop="investigateLog(row)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                Investigate
              </button>
            </div>
          </div>

          <!-- Message body -->
          <div class="ld-message">
            <div class="ld-message-header">
              <span class="ld-section-label">Message</span>
              <button class="ld-copy-btn" @click.stop="copyToClipboard(row.Body)" title="Copy message">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <pre class="ld-body mono">{{ isJson(row.Body) ? formatJson(row.Body) : row.Body }}</pre>
          </div>

          <!-- Fields grid -->
          <div class="ld-fields">
            <!-- Core fields -->
            <div class="ld-field-group">
              <div class="ld-section-label">Fields</div>
              <div class="ld-field-table">
                <div class="ld-field-row" @click.stop="addFilter('service_name', row.ServiceName)">
                  <span class="ld-field-key">service_name</span>
                  <span class="ld-field-val mono">{{ row.ServiceName }}</span>
                  <span class="ld-field-filter" title="Filter by value">&#xBB;</span>
                </div>
                <div v-if="row.TraceId" class="ld-field-row">
                  <span class="ld-field-key">trace_id</span>
                  <router-link :to="`/trace/${row.TraceId}`" class="ld-field-val mono ld-link" @click.stop>{{ row.TraceId }}</router-link>
                </div>
                <div v-if="row.SpanId" class="ld-field-row">
                  <span class="ld-field-key">span_id</span>
                  <span class="ld-field-val mono">{{ row.SpanId }}</span>
                </div>
                <div v-if="row.ScopeName" class="ld-field-row">
                  <span class="ld-field-key">scope</span>
                  <span class="ld-field-val mono">{{ row.ScopeName }}</span>
                </div>
              </div>
            </div>

            <!-- Resource attributes -->
            <div v-if="filterAttrs(row.ResourceAttributes).length" class="ld-field-group">
              <div class="ld-section-label">Resource</div>
              <div class="ld-field-table">
                <div v-for="[key, val] in filterAttrs(row.ResourceAttributes)" :key="key" class="ld-field-row" @click.stop="addFilter(`resource.${key}`, val)">
                  <span class="ld-field-key">{{ key }}</span>
                  <span class="ld-field-val mono">{{ val }}</span>
                  <span class="ld-field-filter" title="Filter by value">&#xBB;</span>
                </div>
              </div>
            </div>

            <!-- Log attributes -->
            <div v-if="Object.keys(row.LogAttributes || {}).length" class="ld-field-group">
              <div class="ld-section-label">Attributes</div>
              <div class="ld-field-table">
                <div v-for="(val, key) in row.LogAttributes" :key="key" class="ld-field-row" @click.stop="addFilter(`log.${key}`, String(val))">
                  <span class="ld-field-key">{{ key }}</span>
                  <span class="ld-field-val mono">{{ val }}</span>
                  <span class="ld-field-filter" title="Filter by value">&#xBB;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Load more -->
      <div v-if="hasMore" class="load-more">
        <button class="btn btn-load-more" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Loading...' : `Load more (${results.length} / ${total.toLocaleString()})` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/LogsView.css"></style>
