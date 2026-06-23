<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { TraceResponse, SpanNode } from '../types'

const props = defineProps<{ traceId: string }>()
const router = useRouter()

const api = useApi()
const { features } = useFeatures()
const trace = ref<TraceResponse | null>(null)
const selectedSpan = ref<SpanNode | null>(null)

onMounted(async () => {
  try {
    trace.value = await api.getTrace(props.traceId)
  } catch {
    // error captured in api.error
  }
})

function formatDuration(ns: number): string {
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(0)}µs`
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`
  return `${(ns / 1_000_000_000).toFixed(2)}s`
}

function statusClass(status: string, code: number): string {
  if (status === 'ERROR' || code >= 500) return 'status-error'
  if (code >= 400) return 'status-warning'
  return 'status-ok'
}

// Compute the total trace duration for waterfall bar scaling
const traceDuration = computed(() => trace.value?.duration_ns ?? 1)

// Flatten spans into a list with depth for the waterfall
interface FlatSpan {
  span: SpanNode
  depth: number
}

const flatSpans = computed<FlatSpan[]>(() => {
  if (!trace.value) return []
  const result: FlatSpan[] = []
  function walk(nodes: SpanNode[], depth: number) {
    for (const node of nodes) {
      result.push({ span: node, depth })
      walk(node.children, depth + 1)
    }
  }
  walk(trace.value.spans, 0)
  return result
})

function barWidth(ns: number): string {
  const pct = Math.max((ns / traceDuration.value) * 100, 0.5)
  return `${pct}%`
}

// Parse "YYYY-MM-DD HH:MM:SS.nnnnnnnnn" from nanos_to_string into ms
function parseTraceTimestamp(ts: string): number {
  const iso = ts.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z'
  return new Date(iso).getTime()
}

function barOffset(span: SpanNode): string {
  if (!trace.value || flatSpans.value.length === 0) return '0%'
  const first = flatSpans.value[0]!.span.timestamp
  const firstMs = parseTraceTimestamp(first)
  const spanMs = parseTraceTimestamp(span.timestamp)
  const diffNs = (spanMs - firstMs) * 1_000_000
  const pct = Math.max((diffNs / traceDuration.value) * 100, 0)
  return `${Math.min(pct, 95)}%`
}

function selectSpan(span: SpanNode) {
  selectedSpan.value = selectedSpan.value?.span_id === span.span_id ? null : span
}

// Color assignment per service
const serviceColors = [
  '#3b82f6', '#47b881', '#5b8dd9', '#9b7dd4',
  '#e5584f', '#06b6d4', '#84cc16', '#f97316',
]

function serviceColor(name: string): string {
  if (!trace.value) return serviceColors[0]!
  const idx = trace.value.services.indexOf(name)
  return serviceColors[idx % serviceColors.length]!
}

// ═══ Journey narrative ═══

const traceNarrative = computed(() => {
  if (!trace.value || !flatSpans.value.length) return ''
  const root = flatSpans.value[0]!.span
  const services = trace.value.services
  const dur = formatDuration(trace.value.duration_ns)
  const spanCount = trace.value.span_count

  let text = `A ${root.http_method} request to ${root.http_path}`

  if (services.length === 1) {
    text += ` was handled by ${services[0]} in ${dur}.`
  } else {
    text += ` traveled through ${services.join(' \u2192 ')} across ${spanCount} spans, completing in ${dur}.`
  }

  // Error insights
  const errorSpans = flatSpans.value.filter(f => f.span.status === 'ERROR' || f.span.http_status_code >= 500)
  if (errorSpans.length) {
    const errorSvcs = [...new Set(errorSpans.map(f => f.span.service_name))]
    text += ` Errors occurred in ${errorSvcs.join(', ')}.`
  }

  // Bottleneck insight
  if (flatSpans.value.length > 1) {
    const slowest = flatSpans.value.reduce((a, b) => a.span.duration_ns > b.span.duration_ns ? a : b)
    const pct = Math.round((slowest.span.duration_ns / trace.value.duration_ns) * 100)
    if (pct > 30) {
      text += ` ${slowest.span.service_name} consumed ${pct}% of the total duration.`
    }
  }

  return text
})

// ═══ Service flow diagram ═══

interface FlowNode {
  name: string
  duration_ns: number
  status: string
  http_status_code: number
  color: string
}

const serviceFlow = computed<FlowNode[]>(() => {
  if (!flatSpans.value.length) return []
  const seen = new Map<string, FlowNode>()
  for (const { span } of flatSpans.value) {
    if (!seen.has(span.service_name)) {
      seen.set(span.service_name, {
        name: span.service_name,
        duration_ns: span.duration_ns,
        status: span.status,
        http_status_code: span.http_status_code,
        color: serviceColor(span.service_name),
      })
    }
  }
  return Array.from(seen.values())
})

// ═══ Computed insights ═══

const traceInsights = computed(() => {
  if (!trace.value || !flatSpans.value.length) return []
  const insights: { text: string; type: 'info' | 'warning' | 'error' }[] = []
  const totalNs = trace.value.duration_ns

  // Service time breakdown
  const svcDurations = new Map<string, number>()
  for (const { span } of flatSpans.value) {
    const cur = svcDurations.get(span.service_name) || 0
    svcDurations.set(span.service_name, Math.max(cur, span.duration_ns))
  }

  // Bottleneck detection
  const sorted = [...svcDurations.entries()].sort((a, b) => b[1] - a[1])
  if (sorted.length > 1 && sorted[0]) {
    const pct = Math.round((sorted[0][1] / totalNs) * 100)
    if (pct > 40) {
      insights.push({ text: `${sorted[0][0]} is the bottleneck at ${pct}% of total time`, type: 'warning' })
    }
  }

  // Error detection
  for (const { span } of flatSpans.value) {
    if (span.status === 'ERROR' || span.http_status_code >= 500) {
      insights.push({ text: `Error in ${span.service_name}: ${span.http_method} ${span.http_path} returned ${span.http_status_code}`, type: 'error' })
    }
  }

  // Span count
  insights.push({ text: `${trace.value.span_count} spans across ${trace.value.services.length} services`, type: 'info' })

  return insights
})

// ═══ Unified log stream ═══

interface StreamEvent {
  timestamp: string
  service_name: string
  span_id: string
  http_method: string
  http_path: string
  name: string
  level: string
  message: string
  attributes: Record<string, unknown>
  serviceColor: string
}

const logStream = computed<StreamEvent[]>(() => {
  if (!flatSpans.value.length) return []
  const events: StreamEvent[] = []
  for (const { span } of flatSpans.value) {
    for (const ev of span.events) {
      events.push({
        timestamp: ev.timestamp,
        service_name: span.service_name,
        span_id: span.span_id,
        http_method: span.http_method,
        http_path: span.http_path,
        name: ev.name,
        level: String(ev.attributes?.['log.level'] || ev.name || ''),
        message: String(ev.attributes?.['log.message'] || ev.name || ''),
        attributes: ev.attributes,
        serviceColor: serviceColor(span.service_name),
      })
    }
  }
  events.sort((a, b) => {
    if (a.timestamp < b.timestamp) return -1
    if (a.timestamp > b.timestamp) return 1
    return 0
  })
  return events
})

// ═══ Attribute grouping ═══

function groupAttributes(attrs: Record<string, unknown>): { group: string; entries: [string, unknown][] }[] {
  const groups: Record<string, [string, unknown][]> = {
    'User Context': [],
    'Business Logic': [],
    'HTTP': [],
    'Infrastructure': [],
    'Other': [],
  }

  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('user.') || k.startsWith('notification.')) groups['User Context']!.push([k, v])
    else if (k.startsWith('article.') || k.startsWith('email.') || k.startsWith('queue.') || k.startsWith('gateway.') || k.startsWith('feature_flags.') || k.startsWith('downstream.')) groups['Business Logic']!.push([k, v])
    else if (k.startsWith('http.') || k.startsWith('url.') || k.startsWith('net.') || k.startsWith('network.') || k.startsWith('server.') || k.startsWith('user_agent.')) groups['HTTP']!.push([k, v])
    else if (k.startsWith('db.') || k.startsWith('cache.') || k === 'service.name' || k === 'service.version' || k === 'host.name' || k.startsWith('deploy.')) groups['Infrastructure']!.push([k, v])
    else groups['Other']!.push([k, v])
  }

  return Object.entries(groups)
    .filter(([, entries]) => entries.length > 0)
    .map(([group, entries]) => ({ group, entries }))
}

function investigateTrace() {
  const t = trace.value
  if (!t) return
  const root = t.spans[0]
  const errorSpans = t.spans.filter(s => s.status === 'ERROR' || s.http_status_code >= 500)
  const ctx = [
    `Trace ID: ${props.traceId}`,
    `Root service: ${root?.service_name || 'unknown'}`,
    `Total spans: ${t.spans.length}`,
    errorSpans.length ? `Error spans: ${errorSpans.map(s => `${s.service_name} ${s.http_method} ${s.http_path} (${s.http_status_code})`).join(', ')}` : '',
  ].filter(Boolean).join('\n')

  router.push({
    path: '/investigate',
    query: {
      q: errorSpans.length
        ? `Investigate errors in trace ${props.traceId} — ${errorSpans.length} span(s) failed`
        : `Investigate trace ${props.traceId} from ${root?.service_name || 'unknown'}`,
      ctx,
    },
  })
}
</script>

<template>
  <div class="trace-view">
    <!-- Header -->
    <div class="trace-header">
      <div class="trace-header-left">
        <router-link to="/" class="back-link">&#8592; Explore</router-link>
        <h1 class="trace-title mono">{{ traceId }}</h1>
      </div>
      <div v-if="trace" class="trace-stats">
        <div class="tstat">
          <span class="tstat-value mono">{{ trace.span_count }}</span>
          <span class="tstat-label">spans</span>
        </div>
        <div class="tstat-divider" />
        <div class="tstat">
          <span class="tstat-value mono">{{ formatDuration(trace.duration_ns) }}</span>
          <span class="tstat-label">duration</span>
        </div>
        <div class="tstat-divider" />
        <div class="tstat">
          <span class="tstat-value">
            <span
              v-for="svc in trace.services"
              :key="svc"
              class="service-tag"
              :style="{ borderColor: serviceColor(svc), color: serviceColor(svc) }"
            >{{ svc }}</span>
          </span>
          <span class="tstat-label">services</span>
        </div>
        <div class="tstat-divider" />
        <button v-if="features.sre_agent" class="btn-investigate" @click="investigateTrace">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          Investigate
        </button>
      </div>
    </div>

    <!-- Loading / Error -->
    <div v-if="api.loading.value" class="empty-state card">
      <div class="empty-state-icon">&#9676;</div>
      <div>Loading trace...</div>
    </div>

    <div v-else-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon status-error">&#10005;</div>
      <div class="mono" style="font-size: 11px">{{ api.error.value }}</div>
    </div>

    <template v-else-if="trace">
      <!-- ═══ The Journey ═══ -->
      <div class="journey card fade-in">
        <div class="journey-label">THE JOURNEY</div>

        <!-- Narrative -->
        <div class="journey-narrative">{{ traceNarrative }}</div>

        <!-- Service Flow Diagram -->
        <div class="journey-flow">
          <template v-for="(node, idx) in serviceFlow" :key="node.name">
            <div
              class="flow-node"
              :class="{ 'flow-error': node.status === 'ERROR' || node.http_status_code >= 500 }"
              :style="{ borderColor: node.color + '30' }"
            >
              <div class="flow-dot" :style="{ background: node.color, boxShadow: `0 0 8px ${node.color}60` }" />
              <div class="flow-name">{{ node.name }}</div>
              <div class="flow-dur mono">{{ formatDuration(node.duration_ns) }}</div>
              <div class="flow-code mono" :class="statusClass(node.status, node.http_status_code)">
                {{ node.http_status_code }}
              </div>
            </div>
            <div v-if="idx < serviceFlow.length - 1" class="flow-arrow">
              <svg width="36" height="12" viewBox="0 0 36 12">
                <line x1="0" y1="6" x2="28" y2="6" stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="4 3" />
                <polygon points="28,2 36,6 28,10" fill="var(--border-strong)" />
              </svg>
            </div>
          </template>
        </div>

        <!-- Insights -->
        <div v-if="traceInsights.length" class="journey-insights">
          <div
            v-for="(insight, i) in traceInsights"
            :key="i"
            class="insight"
            :class="'insight-' + insight.type"
          >
            <span class="insight-dot" />
            <span>{{ insight.text }}</span>
          </div>
        </div>
      </div>

      <!-- ═══ Waterfall ═══ -->
      <div class="waterfall-panel card fade-in" style="animation-delay: 100ms">
        <div class="waterfall-label">TIMELINE</div>

        <!-- Time axis -->
        <div class="time-axis">
          <span class="mono text-muted">0ms</span>
          <span class="mono text-muted">{{ formatDuration(traceDuration / 4) }}</span>
          <span class="mono text-muted">{{ formatDuration(traceDuration / 2) }}</span>
          <span class="mono text-muted">{{ formatDuration((traceDuration * 3) / 4) }}</span>
          <span class="mono text-muted">{{ formatDuration(traceDuration) }}</span>
        </div>

        <!-- Span rows -->
        <div
          v-for="(item, i) in flatSpans"
          :key="item.span.span_id"
          class="waterfall-row"
          :class="{
            selected: selectedSpan?.span_id === item.span.span_id,
            'is-error': item.span.status === 'ERROR' || item.span.http_status_code >= 500,
          }"
          :style="{ animationDelay: `${i * 30 + 150}ms` }"
          @click="selectSpan(item.span)"
        >
          <!-- Label section -->
          <div class="span-label" :style="{ paddingLeft: `${item.depth * 20 + 12}px` }">
            <span class="span-connector" v-if="item.depth > 0">&#9492;&#9472;</span>
            <span
              class="span-service"
              :style="{ color: serviceColor(item.span.service_name) }"
            >{{ item.span.service_name }}</span>
            <span class="span-op mono">
              {{ item.span.http_method }} {{ item.span.http_path }}
            </span>
          </div>

          <!-- Bar section -->
          <div class="span-bar-track">
            <div class="span-bar-grid">
              <div class="grid-line" />
              <div class="grid-line" />
              <div class="grid-line" />
              <div class="grid-line" />
            </div>
            <div
              class="span-bar"
              :style="{
                width: barWidth(item.span.duration_ns),
                left: barOffset(item.span),
                backgroundColor: serviceColor(item.span.service_name),
              }"
            >
              <span class="bar-duration mono">{{ formatDuration(item.span.duration_ns) }}</span>
            </div>
          </div>

          <!-- Status -->
          <div class="span-status">
            <span
              class="mono"
              :class="statusClass(item.span.status, item.span.http_status_code)"
            >{{ item.span.http_status_code }}</span>
          </div>
        </div>
      </div>

      <!-- ═══ Log Stream ═══ -->
      <div v-if="logStream.length" class="log-stream card fade-in" style="animation-delay: 200ms">
        <div class="log-stream-header">
          <div class="log-stream-label">LOG STREAM</div>
          <span class="log-stream-count mono">{{ logStream.length }} events</span>
        </div>

        <div class="log-stream-list">
          <div
            v-for="(ev, i) in logStream"
            :key="i"
            class="log-row"
            :class="'log-level-' + ev.level"
          >
            <span class="log-ts mono text-muted">{{ ev.timestamp?.slice(11, 23) || '' }}</span>
            <span
              class="log-service"
              :style="{ color: ev.serviceColor }"
            >{{ ev.service_name }}</span>
            <span
              class="log-badge mono"
              :class="'level-' + ev.level"
            >{{ ev.level }}</span>
            <span class="log-msg mono">{{ ev.message }}</span>
            <span class="log-span-ctx mono text-muted">{{ ev.http_method }} {{ ev.http_path }}</span>
          </div>
        </div>
      </div>

      <!-- ═══ Detail Panel ═══ -->
      <div v-if="selectedSpan" class="detail-panel card fade-in">
        <div class="detail-header">
          <div class="detail-title">
            <span
              class="detail-service"
              :style="{ color: serviceColor(selectedSpan.service_name) }"
            >{{ selectedSpan.service_name }}</span>
            <span class="mono text-secondary">{{ selectedSpan.http_method }} {{ selectedSpan.http_path }}</span>
          </div>
          <button class="detail-close" @click="selectedSpan = null">&#10005;</button>
        </div>

        <!-- Quick stats -->
        <div class="detail-quick">
          <div class="dq-item">
            <span class="dq-label">Duration</span>
            <span class="dq-value mono">{{ formatDuration(selectedSpan.duration_ns) }}</span>
          </div>
          <div class="dq-item">
            <span class="dq-label">Status</span>
            <span class="dq-value mono" :class="statusClass(selectedSpan.status, selectedSpan.http_status_code)">
              {{ selectedSpan.status }} {{ selectedSpan.http_status_code }}
            </span>
          </div>
          <div class="dq-item">
            <span class="dq-label">Span ID</span>
            <span class="dq-value mono">{{ selectedSpan.span_id }}</span>
          </div>
          <div class="dq-item">
            <span class="dq-label">Version</span>
            <span class="dq-value mono">{{ selectedSpan.service_version }}</span>
          </div>
        </div>

        <!-- Grouped attributes -->
        <div class="detail-groups">
          <div v-for="group in groupAttributes(selectedSpan.attributes)" :key="group.group" class="attr-group">
            <div class="attr-group-title">{{ group.group }}</div>
            <div class="attr-grid">
              <template v-for="[key, value] in group.entries" :key="key">
                <div class="attr-key mono">{{ key }}</div>
                <div class="attr-val mono">{{ typeof value === 'object' ? JSON.stringify(value, null, 2) : value }}</div>
              </template>
            </div>
          </div>
        </div>

        <!-- Logs & Events -->
        <div v-if="selectedSpan.events.length" class="detail-events">
          <div class="detail-events-title">Logs &amp; Events ({{ selectedSpan.events.length }})</div>
          <div v-for="(ev, i) in selectedSpan.events" :key="i" class="detail-event">
            <span class="event-ts mono text-muted">{{ ev.timestamp?.slice(11, 23) || '' }}</span>
            <span
              class="event-badge mono"
              :class="'level-' + (ev.attributes?.['log.level'] || ev.name)"
            >{{ ev.attributes?.['log.level'] || ev.name }}</span>
            <span class="event-msg mono">{{ ev.attributes?.['log.message'] || ev.name }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/TraceView.css"></style>
