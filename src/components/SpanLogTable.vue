<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useApi } from '../composables/useApi'
import type { RushEvent, Filter } from '../types'

const props = withDefaults(defineProps<{
  spans: RushEvent[]
  showService?: boolean
  loading?: boolean
  serviceName?: string
  minutes?: number
}>(), {
  showService: true,
  loading: false,
  minutes: 60,
})

const emit = defineEmits<{
  (e: 'click-span', span: RushEvent): void
  (e: 'click-trace', traceId: string): void
}>()

const api = useApi()

// ═══ Mode toggle ═══
const mode = ref<'spans' | 'logs'>('spans')

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
    const res = await fetch('/api/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time_range: { from, to },
        filters,
        limit: 100,
        search: searchText.value || undefined,
      }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json() as { rows: RushEvent[]; total: number }
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
  timestamp: number
  level: string
  message: string
  spanId: string
  traceId: string
  serviceName: string
}

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
        timestamp: row.event_timestamps[i] ?? row.timestamp,
        level: level || 'info',
        message,
        spanId: row.span_id,
        traceId: row.trace_id,
        serviceName: row.service_name,
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
</script>

<template>
  <div class="slt-root">
    <!-- Header bar -->
    <div class="slt-header">
      <div class="slt-toggle">
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
          placeholder="http_method=GET status=ERROR — filters + free text"
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
      <div class="slt-head">
        <div class="slt-col slt-col-time">Time</div>
        <div class="slt-col slt-col-level">Level</div>
        <div v-if="showService" class="slt-col slt-col-svc">Service</div>
        <div class="slt-col slt-col-msg">Message</div>
        <div class="slt-col slt-col-trace">Trace</div>
      </div>

      <div v-if="isLoading" class="slt-empty">Loading logs...</div>
      <div v-else-if="logs.length === 0" class="slt-empty">{{ searchActive ? 'No logs match your search' : 'No log events found in this time range' }}</div>
      <template v-else>
        <div
          v-for="(log, i) in logs"
          :key="i"
          class="slt-row"
          :class="{ 'slt-error': log.level === 'error' || log.level === 'fatal' }"
          @click="emit('click-trace', log.traceId)"
        >
          <div class="slt-col slt-col-time mono">{{ formatTimestamp(log.timestamp) }}</div>
          <div class="slt-col slt-col-level">
            <span class="slt-level-badge" :class="levelClass(log.level)">{{ log.level }}</span>
          </div>
          <div v-if="showService" class="slt-col slt-col-svc">
            <span class="slt-svc-name">{{ log.serviceName }}</span>
          </div>
          <div class="slt-col slt-col-msg mono">{{ log.message }}</div>
          <div class="slt-col slt-col-trace">
            <router-link
              :to="`/trace/${log.traceId}`"
              class="slt-trace-link mono"
              @click.stop
              title="View full trace"
            >{{ log.traceId.slice(0, 8) }}</router-link>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../styles/components/SpanLogTable.css"></style>
