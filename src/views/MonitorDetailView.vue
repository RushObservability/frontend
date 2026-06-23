<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import TimeseriesWidget from '../components/widgets/TimeseriesWidget.vue'
import PanelCard from '../components/PanelCard.vue'
import type { Monitor, MonitorEvent, MonitorPreview } from '../types'

const props = defineProps<{
  id: string
}>()

const api = useApi()
const { features } = useFeatures()
const router = useRouter()

const monitor = ref<Monitor | null>(null)
const events = ref<MonitorEvent[]>([])
const preview = ref<MonitorPreview | null>(null)
const loading = ref(false)

// ── Live graph lookback window ──
const lookbackOptions = [
  { label: '1h', value: 3600 },
  { label: '3h', value: 10800 },
  { label: '6h', value: 21600 },
  { label: '12h', value: 43200 },
  { label: '24h', value: 86400 },
]
const lookbackSecs = ref(10800) // default 3h
const previewLoading = ref(false)

async function loadPreview() {
  const m = monitor.value
  if (!m || m.type === 'composite') return
  previewLoading.value = true
  try {
    // Override eval_window_secs so the graph spans the chosen lookback window.
    preview.value = await api.previewMonitor({ ...m.query_config, eval_window_secs: lookbackSecs.value })
  } catch { /* preview optional */ }
  finally { previewLoading.value = false }
}

function setLookback(secs: number) {
  if (lookbackSecs.value === secs) return
  lookbackSecs.value = secs
  loadPreview()
}

onMounted(async () => {
  loading.value = true
  try {
    const [monRes, evRes] = await Promise.all([
      api.getMonitor(props.id),
      api.listMonitorEvents(props.id),
    ])
    monitor.value = monRes.monitor
    events.value = evRes.events

    // Fetch preview for the live graph
    await loadPreview()
  } catch { /* error in api.error */ }
  finally { loading.value = false }
})

function stateColor(state: string): string {
  if (state === 'ok') return 'var(--ok)'
  if (state === 'warn') return 'var(--warning)'
  if (state === 'alert') return 'var(--error)'
  return 'var(--text-muted)'
}

function stateLabel(state: string): string {
  if (state === 'ok') return 'OK'
  if (state === 'warn') return 'Warn'
  if (state === 'alert') return 'Alert'
  return 'No Data'
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = { metric: 'Metric', log: 'Log', apm: 'APM', composite: 'Composite' }
  return labels[type] || type
}

function formatDate(ts: string | null): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return ts }
}

const groupEntries = computed(() => {
  if (!monitor.value) return []
  return Object.entries(monitor.value.group_states || {}).map(([key, state]) => ({ key, state }))
})

// ── Live graph (standard TimeseriesWidget) ──
// Map the preview timeseries to the widget's [epoch-seconds, value] series shape.
const previewSeries = computed(() => {
  if (!preview.value || !preview.value.timeseries.length) return []
  const points = preview.value.timeseries.map((p, i) => {
    const t = Date.parse(p.timestamp.replace(' ', 'T'))
    return [Number.isNaN(t) ? i : t / 1000, p.value] as [number, number]
  })
  return [{ name: 'value', points }]
})

const previewThresholds = computed(() => {
  const m = monitor.value
  if (!m) return []
  const out: Array<{ value: number; color: string; label: string }> = []
  if (m.critical != null) out.push({ value: m.critical, color: 'var(--error)', label: `crit ${m.critical}` })
  if (m.warning != null) out.push({ value: m.warning, color: 'var(--warning)', label: `warn ${m.warning}` })
  return out
})

// State timeline segments
const timelineSegments = computed(() => {
  if (!events.value.length) return []
  const sorted = [...events.value].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const segments: { state: string; startPct: number; widthPct: number }[] = []
  if (sorted.length === 0) return segments

  const earliest = new Date(sorted[0]!.created_at).getTime()
  const latest = Date.now()
  const range = latest - earliest || 1

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i]!
    const start = new Date(ev.created_at).getTime()
    const end = i < sorted.length - 1 ? new Date(sorted[i + 1]!.created_at).getTime() : latest
    segments.push({
      state: ev.new_state,
      startPct: ((start - earliest) / range) * 100,
      widthPct: ((end - start) / range) * 100,
    })
  }
  return segments
})

function investigateMonitor() {
  const m = monitor.value
  if (!m) return
  const ctx = `Monitor "${m.name}" is ${m.state}. Query type: ${m.type}. Current value exceeded threshold.`
  router.push({
    path: '/investigate',
    query: {
      q: `Investigate firing monitor: ${m.name}`,
      ctx,
    },
  })
}

async function toggleMute() {
  if (!monitor.value) return
  try {
    if (monitor.value.enabled) {
      await api.muteMonitor(monitor.value.id)
      monitor.value.enabled = false
    } else {
      await api.unmuteMonitor(monitor.value.id)
      monitor.value.enabled = true
    }
  } catch { /* error in api.error */ }
}

async function deleteMonitor() {
  if (!monitor.value) return
  if (!confirm('Delete this monitor?')) return
  try {
    await api.deleteMonitor(monitor.value.id)
    router.push('/alerts')
  } catch { /* error in api.error */ }
}
</script>

<template>
  <div class="monitor-detail-page">
    <div v-if="loading" class="empty-state card">
      <div class="text-muted">Loading monitor...</div>
    </div>

    <template v-if="!loading && monitor">
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-header-left">
          <router-link to="/alerts" class="back-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </router-link>
          <div class="detail-title-section">
            <div class="detail-title-row">
              <h1 class="detail-title">{{ monitor.name }}</h1>
              <span class="detail-state-badge" :style="{ background: stateColor(monitor.state), color: 'var(--bg-root)' }">
                {{ stateLabel(monitor.state) }}
              </span>
              <span class="detail-type-badge mono">{{ typeLabel(monitor.type) }}</span>
              <span v-if="!monitor.enabled" class="detail-muted-badge">MUTED</span>
            </div>
            <div class="detail-meta text-muted">
              <span>Created {{ formatDate(monitor.created_at) }}</span>
              <span v-if="monitor.last_eval_at"> &middot; Last evaluated {{ formatDate(monitor.last_eval_at) }}</span>
              <span v-if="monitor.priority"> &middot; P{{ monitor.priority }}</span>
            </div>
          </div>
        </div>
        <div class="detail-actions">
          <router-link :to="'/alerts/' + monitor.id + '/edit'" class="btn-detail btn-detail-secondary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </router-link>
          <button v-if="features.sre_agent" class="btn-investigate" @click="investigateMonitor">Investigate</button>
          <button class="btn-detail btn-detail-secondary" @click="toggleMute">
            {{ monitor.enabled ? 'Mute' : 'Unmute' }}
          </button>
          <button class="btn-detail btn-detail-danger" @click="deleteMonitor">Delete</button>
        </div>
      </div>

      <!-- Tags -->
      <div v-if="monitor.tags.length" class="detail-tags">
        <span v-for="tag in monitor.tags" :key="tag" class="detail-tag">{{ tag }}</span>
      </div>

      <!-- Live graph -->
      <PanelCard
        class="detail-section"
        title="Live"
        description="The monitor's evaluated metric over the selected lookback, with alert thresholds drawn as reference lines."
      >
        <template #actions>
          <div class="lookback-toggle" role="group" aria-label="Lookback window">
            <button
              v-for="opt in lookbackOptions"
              :key="opt.value"
              class="lookback-btn"
              :class="{ active: lookbackSecs === opt.value }"
              @click="setLookback(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </template>
        <div v-if="previewSeries.length" class="detail-chart" :class="{ 'is-loading': previewLoading }">
          <TimeseriesWidget :buckets="[]" :series="previewSeries" :thresholds="previewThresholds" />
        </div>
        <div v-else class="detail-chart detail-chart-empty text-muted">
          {{ previewLoading ? 'Loading…' : 'No preview data available' }}
        </div>
      </PanelCard>

      <!-- State timeline -->
      <PanelCard
        v-if="timelineSegments.length > 0"
        class="detail-section"
        title="State Timeline"
        description="Monitor state (OK / alerting / no-data) across the evaluated window."
      >
        <div class="state-timeline">
          <div
            v-for="(seg, i) in timelineSegments"
            :key="i"
            class="timeline-segment"
            :style="{
              left: seg.startPct + '%',
              width: Math.max(seg.widthPct, 0.5) + '%',
              background: stateColor(seg.state),
            }"
            :title="stateLabel(seg.state)"
          ></div>
        </div>
      </PanelCard>

      <!-- Group breakdown -->
      <div v-if="groupEntries.length > 0" class="detail-section card">
        <div class="section-title">Group Breakdown</div>
        <table class="groups-table">
          <thead>
            <tr>
              <th>Group Key</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in groupEntries" :key="g.key">
              <td class="mono">{{ g.key }}</td>
              <td>
                <span class="group-state-badge" :style="{ color: stateColor(g.state) }">
                  <span class="group-state-dot" :style="{ background: stateColor(g.state) }"></span>
                  {{ stateLabel(g.state) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Events table -->
      <div class="detail-section card">
        <div class="section-title">Events</div>
        <div v-if="events.length === 0" class="events-empty text-muted">
          No state transition events yet
        </div>
        <table v-else class="events-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Transition</th>
              <th>Value</th>
              <th>Threshold</th>
              <th>Group</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ev in events" :key="ev.id">
              <td class="mono text-muted">{{ formatDate(ev.created_at) }}</td>
              <td>
                <span class="transition-badge">
                  <span :style="{ color: stateColor(ev.prev_state) }">{{ stateLabel(ev.prev_state) }}</span>
                  <span class="transition-arrow">&rarr;</span>
                  <span :style="{ color: stateColor(ev.new_state) }">{{ stateLabel(ev.new_state) }}</span>
                </span>
              </td>
              <td class="mono">{{ ev.value.toFixed(2) }}</td>
              <td class="mono text-muted">{{ ev.threshold.toFixed(2) }}</td>
              <td class="mono text-muted">{{ ev.group_key || '-' }}</td>
              <td class="text-secondary" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ ev.message || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.monitor-detail-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* ── Header ── */
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
}
.detail-header-left {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
}
.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  transition: all 0.15s;
  flex-shrink: 0;
  margin-top: 2px;
}
.back-link:hover {
  color: var(--text-primary);
  border-color: var(--border-default);
  background: var(--bg-hover);
}
.detail-title-section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.detail-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.detail-state-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.detail-type-badge {
  font-size: 10px;
  padding: 2px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
}
.detail-muted-badge {
  font-size: 9px;
  padding: 2px 6px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.detail-meta {
  font-size: 11px;
}

/* ── Actions ── */
.detail-actions {
  display: flex;
  gap: var(--sp-2);
  flex-shrink: 0;
}
.btn-detail {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-default);
  transition: all 0.15s;
  text-decoration: none;
  cursor: pointer;
}
.btn-detail-secondary {
  background: var(--bg-surface);
  color: var(--text-secondary);
}
.btn-detail-secondary:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.btn-detail-danger {
  background: var(--bg-surface);
  color: var(--error);
  border-color: var(--error-dim);
}
.btn-detail-danger:hover {
  background: var(--error-dim);
}
.btn-investigate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: var(--amber-dim);
  color: var(--amber);
  border: 1px solid var(--amber-glow);
  border-radius: var(--r-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
}
.btn-investigate:hover {
  background: var(--amber-glow);
  color: var(--amber-hover);
}

/* ── Tags ── */
.detail-tags {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
}
.detail-tag {
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 2px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill);
  color: var(--text-secondary);
}

/* ── Sections ── */
/* Plain card sections (Group breakdown, Events) keep their own padding. */
.detail-section.card {
  padding: var(--sp-4);
}
/* PanelCard-based sections get padding from the panel body, not the root. */
.detail-section.panel-card {
  padding: 0;
}
.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: var(--sp-3);
}

/* ── Chart ── */
.live-graph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
.live-graph-head .section-title {
  margin-bottom: 0;
}
.lookback-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-root);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}
.lookback-btn {
  padding: 3px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all 0.12s;
}
.lookback-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.lookback-btn.active {
  background: var(--amber);
  color: var(--text-inverse);
}
.detail-chart {
  width: 100%;
  height: 450px;
  transition: opacity 0.15s;
}
.detail-chart.is-loading {
  opacity: 0.5;
}
.detail-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--r-md);
}

/* ── State Timeline ── */
.state-timeline {
  position: relative;
  height: 20px;
  background: var(--bg-raised);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.timeline-segment {
  position: absolute;
  top: 0;
  height: 100%;
  opacity: 0.8;
  transition: opacity 0.15s;
}
.timeline-segment:hover {
  opacity: 1;
}

/* ── Groups table ── */
.groups-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.groups-table th {
  text-align: left;
  padding: var(--sp-2);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-default);
}
.groups-table td {
  padding: var(--sp-2);
  border-bottom: 1px solid var(--border-subtle);
}
.groups-table tr:hover {
  background: var(--bg-hover);
}
.group-state-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
}
.group-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Events table ── */
.events-empty {
  font-size: 12px;
  padding: var(--sp-4);
  text-align: center;
}
.events-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.events-table th {
  text-align: left;
  padding: var(--sp-2);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-default);
}
.events-table td {
  padding: var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--border-subtle);
}
.events-table tr:hover {
  background: var(--bg-hover);
}
.transition-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 500;
}
.transition-arrow {
  color: var(--text-muted);
}
</style>
