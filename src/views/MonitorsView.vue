<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { Monitor } from '../types'

const api = useApi()
const router = useRouter()
const route = useRoute()
const { canWrite } = useAuth()

const monitors = ref<Monitor[]>([])
const loading = ref(false)
const search = ref('')
const statusFilter = ref<string>('all')
const typeFilter = ref<string>('all')
// Optional service filter (deep-linked from a service page via ?service=).
// A monitor matches when a query_config filter pins service_name to it.
const serviceFilter = ref((route.query.service as string) || '')
function monitorMatchesService(m: Monitor): boolean {
  const qc = (m.query_config as any) || {}
  if (typeof qc.service === 'string' && qc.service === serviceFilter.value) return true
  const filters = qc.filters || []
  return Array.isArray(filters) && filters.some((f: any) => {
    const field = String(f?.field ?? '').toLowerCase()
    return (field === 'service_name' || field === 'servicename') && String(f?.value) === serviceFilter.value
  })
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await api.listMonitors()
    monitors.value = res.monitors
  } catch { /* error in api.error */ }
  finally { loading.value = false }
})

const filteredMonitors = computed(() => {
  let result = monitors.value
  if (serviceFilter.value) {
    result = result.filter(monitorMatchesService)
  }
  if (statusFilter.value !== 'all') {
    result = result.filter(m => m.state === statusFilter.value)
  }
  if (typeFilter.value !== 'all') {
    result = result.filter(m => m.type === typeFilter.value)
  }
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    result = result.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    )
  }
  return result
})

const statusCounts = computed(() => {
  const counts = { all: monitors.value.length, ok: 0, warn: 0, alert: 0, no_data: 0 }
  for (const m of monitors.value) {
    if (m.state in counts) counts[m.state as keyof typeof counts]++
  }
  return counts
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
  const labels: Record<string, string> = {
    metric: 'Metric',
    log: 'Log',
    apm: 'APM',
    composite: 'Composite',
  }
  return labels[type] || type
}

function priorityLabel(p: number | null): string {
  if (!p) return ''
  return `P${p}`
}

function groupCount(m: Monitor): number {
  return Object.keys(m.group_states || {}).length
}

function formatDate(ts: string | null): string {
  if (!ts) return 'Never'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function goToDetail(id: string) {
  router.push(`/alerts/${id}`)
}

async function toggleMute(m: Monitor, ev: Event) {
  ev.stopPropagation()
  try {
    if (m.enabled) {
      await api.muteMonitor(m.id)
      m.enabled = false
    } else {
      await api.unmuteMonitor(m.id)
      m.enabled = true
    }
  } catch { /* error in api.error */ }
}

async function removeMonitor(id: string, ev: Event) {
  ev.stopPropagation()
  if (!confirm('Delete this monitor?')) return
  try {
    await api.deleteMonitor(id)
    monitors.value = monitors.value.filter(m => m.id !== id)
  } catch { /* error in api.error */ }
}
</script>

<template>
  <div class="monitors-page">
    <!-- Header -->
    <div class="monitors-header">
      <div class="monitors-header-left">
        <h1 class="monitors-title">Monitors</h1>
        <span class="monitors-count mono text-muted">{{ monitors.length }}</span>
      </div>
      <router-link v-if="canWrite" to="/alerts/new" class="btn-new-monitor">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Monitor
      </router-link>
    </div>

    <div v-if="serviceFilter" class="svc-scope-chip">
      Filtered to service <span class="mono">{{ serviceFilter }}</span>
      <button @click="serviceFilter = ''" title="Clear filter" aria-label="Clear service filter">&times;</button>
    </div>

    <!-- Filter bar -->
    <div class="monitors-filters">
      <div class="status-pills">
        <button
          class="status-pill"
          :class="{ active: statusFilter === 'all' }"
          @click="statusFilter = 'all'"
        >
          All <span class="pill-count">{{ statusCounts.all }}</span>
        </button>
        <button
          class="status-pill status-pill-ok"
          :class="{ active: statusFilter === 'ok' }"
          @click="statusFilter = 'ok'"
        >
          <span class="pill-dot" style="background: var(--ok)"></span>
          OK <span class="pill-count">{{ statusCounts.ok }}</span>
        </button>
        <button
          class="status-pill status-pill-warn"
          :class="{ active: statusFilter === 'warn' }"
          @click="statusFilter = 'warn'"
        >
          <span class="pill-dot" style="background: var(--warning)"></span>
          Warn <span class="pill-count">{{ statusCounts.warn }}</span>
        </button>
        <button
          class="status-pill status-pill-alert"
          :class="{ active: statusFilter === 'alert' }"
          @click="statusFilter = 'alert'"
        >
          <span class="pill-dot" style="background: var(--error)"></span>
          Alert <span class="pill-count">{{ statusCounts.alert }}</span>
        </button>
        <button
          class="status-pill status-pill-nodata"
          :class="{ active: statusFilter === 'no_data' }"
          @click="statusFilter = 'no_data'"
        >
          <span class="pill-dot" style="background: var(--text-muted)"></span>
          No Data <span class="pill-count">{{ statusCounts.no_data }}</span>
        </button>
      </div>
      <div class="filters-right">
        <select class="type-filter" v-model="typeFilter">
          <option value="all">All Types</option>
          <option value="metric">Metric</option>
          <option value="log">Log</option>
          <option value="apm">APM</option>
          <option value="composite">Composite</option>
        </select>
        <div class="search-wrap">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            v-model="search"
            type="text"
            class="search-input"
            placeholder="Search monitors..."
          />
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="empty-state card">
      <div class="text-muted">Loading monitors...</div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && filteredMonitors.length === 0" class="empty-state card">
      <div class="empty-state-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.3"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div v-if="monitors.length === 0">No monitors configured</div>
      <div v-else>No monitors match your filters</div>
      <div class="text-secondary" style="font-size: 11px">
        <router-link to="/alerts/new" style="color: var(--amber)">Create your first monitor</router-link> to start alerting
      </div>
    </div>

    <!-- Monitor cards -->
    <div class="monitor-cards">
      <div
        v-for="m in filteredMonitors"
        :key="m.id"
        class="monitor-card card fade-in"
        :class="'monitor-card-' + m.state"
        @click="goToDetail(m.id)"
      >
        <div class="monitor-card-body">
          <div class="monitor-card-left">
            <div class="monitor-state-indicator" :style="{ background: stateColor(m.state) }"></div>
            <div class="monitor-card-info">
              <div class="monitor-card-top">
                <span class="monitor-card-name">{{ m.name }}</span>
                <span v-if="!m.enabled" class="monitor-muted-badge">MUTED</span>
              </div>
              <div class="monitor-card-meta">
                <span class="monitor-type-badge" :class="'type-' + m.type">{{ typeLabel(m.type) }}</span>
                <span v-if="m.priority" class="monitor-priority-badge" :class="'priority-' + m.priority">{{ priorityLabel(m.priority) }}</span>
                <span v-for="tag in m.tags.slice(0, 3)" :key="tag" class="monitor-tag">{{ tag }}</span>
                <span v-if="m.tags.length > 3" class="monitor-tag monitor-tag-more">+{{ m.tags.length - 3 }}</span>
              </div>
            </div>
          </div>
          <div class="monitor-card-right">
            <div class="monitor-card-state">
              <span class="monitor-state-label mono" :style="{ color: stateColor(m.state) }">{{ stateLabel(m.state) }}</span>
              <span v-if="groupCount(m) > 0" class="monitor-group-count mono text-muted">
                {{ groupCount(m) }} groups
              </span>
            </div>
            <div class="monitor-card-time text-muted mono">
              {{ formatDate(m.last_triggered_at) }}
            </div>
            <div class="monitor-card-actions" v-if="canWrite">
              <router-link :to="'/alerts/' + m.id + '/edit'" class="action-btn" title="Edit" @click.stop>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </router-link>
              <button class="action-btn" :title="m.enabled ? 'Mute' : 'Unmute'" @click="toggleMute(m, $event)">
                <svg v-if="m.enabled" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>
              </button>
              <button class="action-btn action-btn-danger" title="Delete" @click="removeMonitor(m.id, $event)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped src="../styles/views/MonitorsView.css"></style>
