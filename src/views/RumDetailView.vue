<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { RumVitalsSummary, RumPageStats, RumErrorGroup, RumSessionSummary, RumRecord, Filter } from '../types'
import TimePicker from '../components/TimePicker.vue'

const props = defineProps<{ appName: string }>()

const router = useRouter()
const route = useRoute()
const api = useApi()

// ═══ Controls ═══
const selectedPreset = ref(60)

const timeRange = computed(() => {
  const to = new Date()
  const from = new Date(to.getTime() - selectedPreset.value * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
})

const effectiveFilters = computed((): Filter[] => {
  return [{ field: 'AppName', op: '=', value: props.appName }]
})

// ═══ Data ═══
const loadingData = ref(false)
const vitals = ref<RumVitalsSummary[]>([])
const pages = ref<RumPageStats[]>([])
const errors = ref<RumErrorGroup[]>([])
const sessions = ref<RumSessionSummary[]>([])
const totalPageViews = ref(0)
const totalSessions = ref(0)
const totalErrors = ref(0)
const avgLoadTime = ref(0)

// ═══ Replay availability ═══
const replaySessionIds = ref<Set<string>>(new Set())

async function loadReplayAvailability() {
  try {
    const ids = await api.rumReplayAvailable(props.appName)
    replaySessionIds.value = new Set(ids)
  } catch { /* non-critical */ }
}

// ═══ Session Detail ═══
const sessionDetailOpen = ref(false)
const sessionDetailId = ref('')
const sessionEvents = ref<RumRecord[]>([])
const sessionDetailLoading = ref(false)
const sessionEventsPage = ref(1)
const expandedEventIndex = ref<number | null>(null)
const SESSION_EVENTS_PER_PAGE = 50

const filteredSessionEvents = computed(() =>
  sessionEvents.value.filter(e => e.EventType !== 'web_vital')
)
const sessionEventsTotalPages = computed(() =>
  Math.ceil(filteredSessionEvents.value.length / SESSION_EVENTS_PER_PAGE)
)
const pagedSessionEvents = computed(() => {
  const start = (sessionEventsPage.value - 1) * SESSION_EVENTS_PER_PAGE
  return filteredSessionEvents.value.slice(start, start + SESSION_EVENTS_PER_PAGE)
})

// ═══ Formatters ═══
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(0)}ms`
}

function formatVitalValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3)
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  return `${value.toFixed(0)}ms`
}

function ratingColor(rating: string): string {
  if (rating === 'good') return 'var(--ok, #47b881)'
  if (rating === 'needs-improvement') return 'var(--warning, #eab308)'
  return 'var(--error, #e5584f)'
}

function vitalThresholds(name: string): { good: number; poor: number } {
  switch (name) {
    case 'LCP': return { good: 2500, poor: 4000 }
    case 'CLS': return { good: 0.1, poor: 0.25 }
    case 'INP': return { good: 200, poor: 500 }
    case 'FCP': return { good: 1800, poor: 3000 }
    case 'TTFB': return { good: 800, poor: 1800 }
    default: return { good: 100, poor: 300 }
  }
}

function vitalRating(name: string, value: number): string {
  const t = vitalThresholds(name)
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs-improvement'
  return 'poor'
}

// @ts-ignore reserved for template use
function eventTypeClass(type: string): string {
  if (type === 'error') return 'evt-error'
  if (type === 'pageview') return 'evt-pageview'
  if (type === 'interaction') return 'evt-interaction'
  if (type === 'web_vital') return 'evt-vital'
  return 'evt-other'
}

// ═══ Help tooltip ═══
const vitalDescriptions: Record<string, { full: string; desc: string; good: string; poor: string }> = {
  LCP: { full: 'Largest Contentful Paint', desc: 'Time until the largest visible element finishes rendering. Measures perceived load speed.', good: '\u2264 2.5s', poor: '> 4s' },
  FCP: { full: 'First Contentful Paint', desc: 'Time until the browser renders the first piece of DOM content. Measures initial visual response.', good: '\u2264 1.8s', poor: '> 3s' },
  INP: { full: 'Interaction to Next Paint', desc: 'Latency from user input to the next visual update. Measures responsiveness.', good: '\u2264 200ms', poor: '> 500ms' },
  CLS: { full: 'Cumulative Layout Shift', desc: 'Sum of unexpected layout shift scores. Measures visual stability.', good: '\u2264 0.1', poor: '> 0.25' },
  TTFB: { full: 'Time to First Byte', desc: 'Time from navigation start until the first byte of the response. Measures server responsiveness.', good: '\u2264 800ms', poor: '> 1.8s' },
}

// ═══ Computed metrics for top bar ═══
function getVitalP75(name: string): number {
  const v = vitals.value.find(v => v.VitalName === name)
  return v ? v.p75 : 0
}

const errorRate = computed(() => {
  if (totalPageViews.value === 0) return 0
  return (totalErrors.value / totalPageViews.value) * 100
})

const uniqueUsers = computed(() => {
  const users = new Set(sessions.value.map(s => s.UserId).filter(Boolean))
  return users.size
})

const sessionMeta = computed(() => {
  return sessions.value.find(s => s.SessionId === sessionDetailId.value) || null
})

// @ts-ignore reserved for template use
const eventCountsByType = computed(() => {
  const counts: Record<string, number> = {}
  for (const evt of sessionEvents.value) {
    const t = evt.EventType
    if (t === 'pageview' || t === 'error' || t === 'web_vital' || t === 'interaction') {
      counts[t] = (counts[t] || 0) + 1
    } else {
      counts['other'] = (counts['other'] || 0) + 1
    }
  }
  return counts
})

const sessionInfo = computed(() => {
  if (!sessionEvents.value.length) return null
  const first = sessionEvents.value[0]!
  return {
    browser: first.BrowserName ? `${first.BrowserName} ${first.BrowserVersion}` : sessionMeta.value?.browser || '\u2014',
    os: first.OsName ? `${first.OsName} ${first.OsVersion}` : '\u2014',
    device: first.DeviceType || 'Desktop',
    screen: first.ScreenWidth ? `${first.ScreenWidth} \u00d7 ${first.ScreenHeight}` : '\u2014',
    environment: first.Environment || '\u2014',
    appVersion: first.AppVersion || '\u2014',
    referrer: first.Referrer || '\u2014',
  }
})

const sessionPages = computed(() => {
  const pages: Array<{ path: string; traceId: string; time: string }> = []
  const seen = new Set<string>()
  for (const evt of sessionEvents.value) {
    if (evt.EventType === 'pageview' && evt.PagePath && !seen.has(evt.PagePath)) {
      seen.add(evt.PagePath)
      pages.push({
        path: evt.PagePath,
        traceId: evt.TraceId || '',
        time: formatEventTime(Number(evt.Timestamp)),
      })
    }
  }
  return pages
})

// @ts-ignore reserved for template use
const sessionVitals = computed(() => {
  const vitals: Array<{ name: string; value: number; rating: string }> = []
  for (const evt of sessionEvents.value) {
    if (evt.EventType === 'web_vital' && evt.VitalName) {
      vitals.push({ name: evt.VitalName, value: evt.VitalValue, rating: evt.VitalRating || vitalRating(evt.VitalName, evt.VitalValue) })
    }
  }
  return vitals
})

const sessionErrorCount = computed(() =>
  sessionEvents.value.filter(e => e.EventType === 'error').length
)

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function formatEventTime(ts: number): string {
  const d = new Date(ts / 1e6)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  const ms = d.getMilliseconds().toString().padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}

function formatSessionDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m.toString().padStart(2, '0')}:${s}`
}

function eventTypeLabel(evt: RumRecord): string {
  switch (evt.EventType) {
    case 'pageview': return 'Page Load'
    case 'error': return 'Error'
    case 'web_vital': return 'Web Vital'
    case 'interaction':
      if (evt.InteractionType === 'click') return 'Click'
      return evt.InteractionType || 'Interaction'
    case 'resource': return 'Network'
    case 'custom': return 'Custom'
    default: return evt.EventType
  }
}

function eventContent(evt: RumRecord): string {
  switch (evt.EventType) {
    case 'pageview': return evt.PagePath
    case 'error': return evt.ErrorMessage
    case 'web_vital': return `${evt.VitalName}: ${formatVitalValue(evt.VitalName, evt.VitalValue)}`
    case 'interaction':
      return evt.InteractionTarget ? `${evt.InteractionTarget}` : evt.EventName
    case 'resource': return evt.EventName || evt.PagePath
    case 'custom': return evt.EventName
    default: return evt.EventName || '\u2014'
  }
}

function toggleEventExpand(index: number, evt: RumRecord) {
  if (evt.EventType !== 'error' || !evt.ErrorStack) return
  expandedEventIndex.value = expandedEventIndex.value === index ? null : index
}

interface StackFrame {
  fn: string
  file: string
  line: string
  col: string
  raw: string
}

function parseStackTrace(stack: string): { message: string; frames: StackFrame[] } {
  const lines = stack.split('\n')
  let message = ''
  const frames: StackFrame[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Match "at functionName (file:line:col)" or "at file:line:col"
    const atMatch = trimmed.match(/^at\s+(?:(.+?)\s+\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))$/)
    if (atMatch) {
      frames.push({
        fn: atMatch[1] || '(anonymous)',
        file: atMatch[2] || atMatch[5] || '',
        line: atMatch[3] || atMatch[6] || '',
        col: atMatch[4] || atMatch[7] || '',
        raw: trimmed,
      })
      continue
    }

    // Match Firefox/Safari style: "functionName@file:line:col"
    const ffMatch = trimmed.match(/^(.+?)@(.+?):(\d+):(\d+)$/)
    if (ffMatch) {
      frames.push({
        fn: ffMatch[1] || '(anonymous)',
        file: ffMatch[2] || '',
        line: ffMatch[3] || '',
        col: ffMatch[4] || '',
        raw: trimmed,
      })
      continue
    }

    // First non-frame line is the error message
    if (!frames.length && !message) {
      message = trimmed
    }
  }

  return { message, frames }
}

function shortFileName(path: string): string {
  // Extract just filename from full path/URL
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// ═══ Fetch data ═══
async function fetchData() {
  loadingData.value = true
  const req = { time_range: timeRange.value, filters: effectiveFilters.value }

  try {
    const [vitalsRes, pagesRes, errorsRes, sessionsRes] = await Promise.all([
      api.rumVitals(req).catch(() => ({ vitals: [] })),
      api.rumPages({ ...req, limit: 20 }).catch(() => ({ pages: [] })),
      api.rumErrors({ ...req, limit: 20 }).catch(() => ({ errors: [] })),
      api.rumSessions({ ...req, limit: 50 }).catch(() => ({ sessions: [] })),
    ])

    vitals.value = vitalsRes.vitals
    pages.value = pagesRes.pages
    errors.value = errorsRes.errors
    sessions.value = sessionsRes.sessions

    totalPageViews.value = pagesRes.pages.reduce((s: number, p: RumPageStats) => s + p.views, 0)
    totalSessions.value = sessionsRes.sessions.length
    totalErrors.value = errorsRes.errors.reduce((s: number, e: RumErrorGroup) => s + e.count, 0)
    avgLoadTime.value = pagesRes.pages.length
      ? pagesRes.pages.reduce((s: number, p: RumPageStats) => s + p.avg_load_ms * p.views, 0) / (totalPageViews.value || 1)
      : 0
  } finally {
    loadingData.value = false
  }
}

async function openSession(id: string) {
  sessionDetailId.value = id
  sessionDetailOpen.value = true
  sessionDetailLoading.value = true
  sessionEventsPage.value = 1
  expandedEventIndex.value = null
  syncUrlState()
  try {
    const res = await api.rumSession(id)
    sessionEvents.value = res.events
  } catch {
    sessionEvents.value = []
  } finally {
    sessionDetailLoading.value = false
  }
}

function closeSessionDetail() {
  sessionDetailOpen.value = false
  sessionDetailId.value = ''
  sessionEvents.value = []
  syncUrlState()
}

// ═══ URL state sync ═══
function syncUrlState() {
  const query: Record<string, string> = {}
  if (selectedPreset.value !== 60) query.t = String(selectedPreset.value)
  if (sessionDetailOpen.value && sessionDetailId.value) query.session = sessionDetailId.value
  router.replace({ query })
}

// ═══ Lifecycle ═══
let initializing = true

onMounted(() => {
  // Restore state from URL before first fetch
  const q = route.query
  if (q.t) {
    const t = parseInt(q.t as string, 10)
    if (t > 0) {
      selectedPreset.value = t
    }
  }

  fetchData()
  loadReplayAvailability()
  initializing = false

  // Restore session from URL
  const sessionFromUrl = q.session as string | undefined
  if (sessionFromUrl) {
    openSession(sessionFromUrl)
  }
})

watch(selectedPreset, () => {
  if (initializing) return
  syncUrlState()
  fetchData()
})
</script>

<template>
  <div class="rum">
    <!-- ═══ Header ═══ -->
    <div class="rum-header">
      <div class="rum-header-left">
        <button class="back-btn" @click="router.push('/rum')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          RUM
        </button>
        <h2 class="page-title">{{ appName }}</h2>
      </div>
      <TimePicker v-model="selectedPreset" />
    </div>

    <!-- ═══ Loading indicator ═══ -->
    <div v-if="loadingData" class="loading-bar"></div>

    <!-- ═══ Top Metrics Bar ═══ -->
    <div class="metrics-bar" :class="{ dimmed: loadingData }">
      <div class="metric-item">
        <div class="metric-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="metric-label">Avg INP</div>
        <div class="metric-value">{{ formatVitalValue('INP', getVitalP75('INP')) }}</div>
      </div>
      <div class="metric-sep"></div>
      <div class="metric-item">
        <div class="metric-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </div>
        <div class="metric-label">Avg CLS</div>
        <div class="metric-value">{{ getVitalP75('CLS').toFixed(2) }}</div>
      </div>
      <div class="metric-sep"></div>
      <div class="metric-item">
        <div class="metric-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="metric-label">Pageload Time</div>
        <div class="metric-value">{{ formatDuration(avgLoadTime) }}</div>
      </div>
      <div class="metric-sep"></div>
      <div class="metric-item">
        <div class="metric-icon metric-icon-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <div class="metric-label">Error Rate</div>
        <div class="metric-value" :class="{ 'has-errors': errorRate > 0 }">{{ errorRate.toFixed(0) }}<span class="metric-unit">%</span></div>
      </div>
      <div class="metric-sep"></div>
      <div class="metric-item">
        <div class="metric-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="metric-label">User Count</div>
        <div class="metric-value">{{ uniqueUsers }}</div>
      </div>
    </div>

    <!-- ═══ Web Vitals + Pages/Errors Layout ═══ -->
    <div class="section-header-row">
      <div class="section-title">Web Vitals</div>
    </div>

    <div class="main-layout" :class="{ dimmed: loadingData }">
      <!-- Left column: Web Vitals + Sessions -->
      <div class="main-col">
        <div class="vitals-list" v-if="vitals.length">
          <div v-for="v in vitals" :key="v.VitalName" class="vital-row" :class="'rating-' + vitalRating(v.VitalName, v.p75)">
            <div class="vital-row-top">
              <span class="vital-name vital-has-tip">
                {{ v.VitalName }}
                <div v-if="vitalDescriptions[v.VitalName]" class="vital-tip">
                  <div class="vital-tip-title">{{ vitalDescriptions[v.VitalName]!.full }}</div>
                  <div class="vital-tip-desc">{{ vitalDescriptions[v.VitalName]!.desc }}</div>
                  <div class="vital-tip-thresholds">
                    <span class="vh-good">Good: {{ vitalDescriptions[v.VitalName]!.good }}</span>
                    <span class="vh-poor">Poor: {{ vitalDescriptions[v.VitalName]!.poor }}</span>
                  </div>
                </div>
              </span>
              <span class="vital-p75-inline">{{ formatVitalValue(v.VitalName, v.p75) }}</span>
              <span class="vital-p75-label">p75</span>
              <span
                class="vital-badge"
                :style="{ background: ratingColor(vitalRating(v.VitalName, v.p75)) }"
              >
                {{ vitalRating(v.VitalName, v.p75) }}
              </span>
            </div>
            <div class="vital-bar">
              <div class="vital-bar-seg good" :style="{ width: v.good_pct + '%' }" :title="'Good: ' + v.good_pct.toFixed(1) + '%'"></div>
              <div class="vital-bar-seg needs-imp" :style="{ width: v.needs_improvement_pct + '%' }" :title="'Needs improvement: ' + v.needs_improvement_pct.toFixed(1) + '%'"></div>
              <div class="vital-bar-seg poor" :style="{ width: v.poor_pct + '%' }" :title="'Poor: ' + v.poor_pct.toFixed(1) + '%'"></div>
            </div>
            <div class="vital-pct-row">
              <span class="good-text">{{ v.good_pct.toFixed(0) }}% good</span>
              <span class="ni-text">{{ v.needs_improvement_pct.toFixed(0) }}% needs improvement</span>
              <span class="poor-text">{{ v.poor_pct.toFixed(0) }}% poor</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-section muted">No web vitals data for this period.</div>

        <!-- Sessions -->
        <div class="stacked-panel">
          <div class="section-title">Sessions</div>
          <table class="rum-table" v-if="sessions.length">
            <thead>
              <tr>
                <th>Session</th>
                <th>User</th>
                <th>Browser</th>
                <th class="num">Pages</th>
                <th class="num">Errors</th>
                <th class="num">Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in sessions"
                :key="s.SessionId"
                class="clickable-row"
                @click="openSession(s.SessionId)"
              >
                <td class="mono">{{ s.SessionId.slice(0, 8) }}...</td>
                <td>{{ s.UserId || '\u2014' }}</td>
                <td>{{ s.browser }}</td>
                <td class="num">{{ s.page_count }}</td>
                <td class="num" :class="{ 'has-errors': s.error_count > 0 }">{{ s.error_count }}</td>
                <td class="num">{{ s.duration_s.toFixed(1) }}s</td>
                <td class="td-replay" @click.stop>
                  <router-link
                    v-if="replaySessionIds.has(s.SessionId)"
                    :to="`/rum/${encodeURIComponent(props.appName)}/replay/${encodeURIComponent(s.SessionId)}`"
                    class="btn-replay"
                  >▶ Replay</router-link>
                  <span v-else class="btn-replay btn-replay--unavailable" title="No recording available">▶ Replay</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-section muted">No sessions in this period.</div>
        </div>
      </div>

      <!-- Right column: Top Pages + Errors -->
      <div class="main-col">
        <!-- Top Pages -->
        <div class="stacked-panel">
          <div class="section-title">Top Pages</div>
          <table class="rum-table" v-if="pages.length">
            <thead>
              <tr>
                <th>Page</th>
                <th class="num">Views</th>
                <th class="num">Sessions</th>
                <th class="num">Avg Load</th>
                <th class="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in pages.slice(0, 10)" :key="p.PagePath">
                <td class="mono page-cell" :title="p.PagePath">{{ truncate(p.PagePath, 30) }}</td>
                <td class="num">{{ formatCompact(p.views) }}</td>
                <td class="num">{{ formatCompact(p.unique_sessions) }}</td>
                <td class="num">{{ formatDuration(p.avg_load_ms) }}</td>
                <td class="num" :class="{ 'has-errors': p.error_count > 0 }">{{ p.error_count }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-section muted">No page data.</div>
        </div>

        <!-- Errors -->
        <div class="stacked-panel">
          <div class="section-title">Errors</div>
          <table class="rum-table" v-if="errors.length">
            <thead>
              <tr>
                <th>Message</th>
                <th class="num">Count</th>
                <th class="num">Sessions</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in errors.slice(0, 10)" :key="e.ErrorMessage + e.ErrorType">
                <td class="mono err-cell" :title="e.ErrorMessage">{{ truncate(e.ErrorMessage, 40) }}</td>
                <td class="num">{{ formatCompact(e.count) }}</td>
                <td class="num">{{ e.affected_sessions }}</td>
                <td class="mono">{{ e.ErrorType || '\u2014' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-section muted">No errors in this period.</div>
        </div>
      </div>
    </div>

    <!-- ═══ Session Detail Panel ═══ -->
    <Teleport to="body">
      <Transition name="slide-down">
        <div v-if="sessionDetailOpen" class="detail-overlay" @click.self="closeSessionDetail()">
          <div class="detail-panel" @click.stop>
            <div class="detail-panel-inner">
              <!-- Header -->
              <div class="sp-header">
                <div class="sp-header-left">
                  <span class="sp-title">Session {{ sessionDetailId }}</span>
                  <span class="sp-app-badge">{{ appName }}</span>
                </div>
                <button class="dp-close" @click="closeSessionDetail()">&times;</button>
              </div>

              <!-- Meta row -->
              <div v-if="sessionMeta" class="sp-meta">
                <span class="sp-meta-item">
                  <svg class="sp-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {{ sessionMeta.UserId || 'Anonymous' }}
                </span>
                <span class="sp-meta-item">
                  <svg class="sp-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  Desktop
                </span>
                <span class="sp-meta-item">
                  <svg class="sp-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>
                  {{ sessionMeta.browser }}
                </span>
                <span class="sp-meta-item">
                  <svg class="sp-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {{ formatSessionDuration(sessionMeta.duration_s) }}
                </span>
              </div>

              <div v-if="sessionDetailLoading" class="dp-loading">Loading session...</div>

              <div v-else class="sp-body">
                <!-- Overview -->
                <div v-if="sessionInfo" class="sp-overview">
                  <div class="sp-stats-row">
                    <div class="sp-stat">
                      <div class="sp-stat-val">{{ sessionMeta?.page_count ?? sessionPages.length }}</div>
                      <div class="sp-stat-label">Pages</div>
                    </div>
                    <div class="sp-stat">
                      <div class="sp-stat-val" :class="{ 'has-errors': sessionErrorCount > 0 }">{{ sessionErrorCount }}</div>
                      <div class="sp-stat-label">Errors</div>
                    </div>
                    <div class="sp-stat">
                      <div class="sp-stat-val">{{ sessionEvents.length }}</div>
                      <div class="sp-stat-label">Events</div>
                    </div>
                    <div class="sp-stat">
                      <div class="sp-stat-val">{{ sessionMeta ? formatSessionDuration(sessionMeta.duration_s) : '\u2014' }}</div>
                      <div class="sp-stat-label">Duration</div>
                    </div>
                  </div>

                  <div class="sp-info-grid">
                    <div class="sp-info-col">
                      <div class="sp-info-section-title">Environment</div>
                      <table class="sp-info-table">
                        <tr><td class="sp-info-k">Browser</td><td class="sp-info-v">{{ sessionInfo.browser }}</td></tr>
                        <tr><td class="sp-info-k">OS</td><td class="sp-info-v">{{ sessionInfo.os }}</td></tr>
                        <tr><td class="sp-info-k">Device</td><td class="sp-info-v">{{ sessionInfo.device }}</td></tr>
                        <tr><td class="sp-info-k">Screen</td><td class="sp-info-v mono">{{ sessionInfo.screen }}</td></tr>
                        <tr><td class="sp-info-k">Env</td><td class="sp-info-v">{{ sessionInfo.environment }}</td></tr>
                        <tr><td class="sp-info-k">App Version</td><td class="sp-info-v mono">{{ sessionInfo.appVersion }}</td></tr>
                        <tr v-if="sessionInfo.referrer !== '\u2014'"><td class="sp-info-k">Referrer</td><td class="sp-info-v mono">{{ truncate(sessionInfo.referrer, 50) }}</td></tr>
                      </table>
                    </div>
                    <div class="sp-info-col">
                      <div class="sp-info-section-title">Visited Pages</div>
                      <div v-if="sessionPages.length" class="sp-pages-list">
                        <div v-for="p in sessionPages" :key="p.path" class="sp-page-item">
                          <span class="sp-page-path mono">{{ p.path }}</span>
                          <span class="sp-page-time">{{ p.time }}</span>
                          <router-link
                            v-if="p.traceId"
                            :to="'/trace/' + p.traceId"
                            class="sp-page-trace"
                            @click.stop
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
                            View trace
                          </router-link>
                        </div>
                      </div>
                      <div v-else class="sp-info-empty">No page views recorded</div>
                    </div>
                  </div>
                </div>

                <!-- Events table -->
                <div v-if="sessionEvents.length" class="sp-events-header">
                  {{ sessionEvents.length }} events
                </div>

                <table v-if="filteredSessionEvents.length" class="sp-table">
                  <thead>
                    <tr>
                      <th class="sp-th-time">Time</th>
                      <th class="sp-th-type">Type</th>
                      <th>Content</th>
                      <th class="sp-th-trace">Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(evt, i) in pagedSessionEvents" :key="i">
                      <tr
                        class="sp-row"
                        :class="{
                          'sp-row-error': evt.EventType === 'error',
                          'sp-row-expandable': evt.EventType === 'error' && evt.ErrorStack,
                          'sp-row-expanded': expandedEventIndex === i,
                        }"
                        @click="toggleEventExpand(i, evt)"
                      >
                        <td class="sp-cell-time mono">{{ formatEventTime(Number(evt.Timestamp)) }}</td>
                        <td class="sp-cell-type">
                          <span class="sp-type-dot" :class="'sp-dot-' + evt.EventType"></span>
                          {{ eventTypeLabel(evt) }}
                        </td>
                        <td class="sp-cell-content">
                          <span :class="{ 'sp-content-error': evt.EventType === 'error' }">{{ eventContent(evt) }}</span>
                          <svg v-if="evt.EventType === 'error' && evt.ErrorStack" class="sp-expand-icon" :class="{ rotated: expandedEventIndex === i }" width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </td>
                        <td class="sp-cell-trace">
                          <router-link
                            v-if="evt.TraceId"
                            :to="'/trace/' + evt.TraceId"
                            class="sp-trace-btn"
                            @click.stop
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
                            View
                          </router-link>
                          <span v-else class="sp-no-trace">&mdash;</span>
                        </td>
                      </tr>
                      <tr v-if="expandedEventIndex === i && evt.ErrorStack" class="sp-stack-row">
                        <td colspan="4" class="sp-stack-cell">
                          <div class="st-console">
                            <!-- Error header -->
                            <div class="st-header">
                              <span class="st-error-badge">{{ evt.ErrorType || 'Error' }}</span>
                              <span class="st-error-msg">{{ parseStackTrace(evt.ErrorStack).message || evt.ErrorMessage }}</span>
                            </div>
                            <!-- Stack frames -->
                            <div class="st-frames">
                              <div
                                v-for="(frame, fi) in parseStackTrace(evt.ErrorStack).frames"
                                :key="fi"
                                class="st-frame"
                                :class="{ 'st-frame-app': !frame.file.includes('node_modules') && !frame.file.includes('.esm-bundler.') }"
                              >
                                <span class="st-frame-at">at</span>
                                <span class="st-frame-fn">{{ frame.fn }}</span>
                                <span class="st-frame-loc">
                                  <span class="st-frame-file">{{ shortFileName(frame.file) }}</span><span class="st-frame-sep">:</span><span class="st-frame-line">{{ frame.line }}</span><span v-if="frame.col" class="st-frame-sep">:</span><span v-if="frame.col" class="st-frame-col">{{ frame.col }}</span>
                                </span>
                              </div>
                              <!-- Fallback if parsing fails -->
                              <pre v-if="!parseStackTrace(evt.ErrorStack).frames.length" class="st-raw">{{ evt.ErrorStack }}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
                <!-- Pagination -->
                <div v-if="sessionEventsTotalPages > 1" class="sp-pagination">
                  <button class="sp-page-btn" :disabled="sessionEventsPage <= 1" @click="sessionEventsPage--">&laquo; Prev</button>
                  <span class="sp-page-info">
                    Page {{ sessionEventsPage }} of {{ sessionEventsTotalPages }}
                    <span class="muted">({{ filteredSessionEvents.length }} events)</span>
                  </span>
                  <button class="sp-page-btn" :disabled="sessionEventsPage >= sessionEventsTotalPages" @click="sessionEventsPage++">Next &raquo;</button>
                </div>
                <div v-if="!filteredSessionEvents.length" class="empty-section muted">No events found for this session.</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped src="../styles/views/RumDetailView.css"></style>
