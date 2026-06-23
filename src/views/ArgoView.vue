<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { ArgoApp } from '../types'

const api = useApi()
const { features } = useFeatures()

const apps = ref<ArgoApp[]>([])
const search = ref('')
const healthFilter = ref('')
const syncFilter = ref('')

onMounted(async () => {
  await loadApps()
})

async function loadApps() {
  try {
    apps.value = await api.getArgoApps()
  } catch { /* error in api.error */ }
}

const filteredApps = computed(() => {
  let result = apps.value
  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.project.toLowerCase().includes(q) ||
      a.dest_namespace.toLowerCase().includes(q)
    )
  }
  if (healthFilter.value) {
    result = result.filter(a => a.health_status === healthFilter.value)
  }
  if (syncFilter.value) {
    result = result.filter(a => a.sync_status === syncFilter.value)
  }
  return result
})

const stats = computed(() => {
  const all = apps.value
  return {
    total: all.length,
    healthy: all.filter(a => a.health_status === 'Healthy').length,
    degraded: all.filter(a => a.health_status === 'Degraded').length,
    progressing: all.filter(a => a.health_status === 'Progressing').length,
    outOfSync: all.filter(a => a.sync_status === 'OutOfSync').length,
  }
})

function healthClass(status: string): string {
  switch (status) {
    case 'Healthy': return 'badge-ok'
    case 'Degraded':
    case 'Missing': return 'badge-error'
    case 'Progressing': return 'badge-warning'
    case 'Suspended':
    case 'Unknown':
    default: return 'badge-muted'
  }
}

function syncClass(status: string): string {
  switch (status) {
    case 'Synced': return 'badge-ok'
    case 'OutOfSync': return 'badge-warning'
    default: return 'badge-muted'
  }
}

function truncateRepo(repo: string): string {
  if (!repo) return ''
  // Remove protocol prefix and truncate
  const clean = repo.replace(/^https?:\/\//, '').replace(/\.git$/, '')
  return clean.length > 40 ? clean.substring(0, 37) + '...' : clean
}

function relativeTime(ts: string): string {
  if (!ts) return 'never'
  try {
    const d = new Date(ts)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  } catch { return ts }
}

function investigateUrl(app: ArgoApp): string {
  const ctx = `ArgoCD app "${app.name}" in project "${app.project}" is ${app.health_status} and ${app.sync_status} in namespace "${app.dest_namespace}"`
  return `/investigate?q=${encodeURIComponent(`Why is ${app.name} ${app.health_status}?`)}&ctx=${encodeURIComponent(ctx)}`
}
</script>

<template>
  <div class="argo-page">
    <div class="section-header">
      <h2 class="section-title">ArgoCD Applications</h2>
    </div>

    <!-- Stats Bar -->
    <div class="stats-bar" v-if="apps.length > 0">
      <div class="stat-item">
        <span class="stat-value">{{ stats.total }}</span>
        <span class="stat-label">Total</span>
      </div>
      <div class="stat-item stat-ok">
        <span class="stat-value">{{ stats.healthy }}</span>
        <span class="stat-label">Healthy</span>
      </div>
      <div class="stat-item stat-error">
        <span class="stat-value">{{ stats.degraded }}</span>
        <span class="stat-label">Degraded</span>
      </div>
      <div class="stat-item stat-warning">
        <span class="stat-value">{{ stats.progressing }}</span>
        <span class="stat-label">Progressing</span>
      </div>
      <div class="stat-item stat-warning">
        <span class="stat-value">{{ stats.outOfSync }}</span>
        <span class="stat-label">OutOfSync</span>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <input
        v-model="search"
        class="filter-input mono"
        placeholder="Search by name, project, or namespace..."
      />
      <select v-model="healthFilter" class="filter-select mono">
        <option value="">All Health</option>
        <option value="Healthy">Healthy</option>
        <option value="Degraded">Degraded</option>
        <option value="Progressing">Progressing</option>
        <option value="Missing">Missing</option>
        <option value="Suspended">Suspended</option>
        <option value="Unknown">Unknown</option>
      </select>
      <select v-model="syncFilter" class="filter-select mono">
        <option value="">All Sync</option>
        <option value="Synced">Synced</option>
        <option value="OutOfSync">OutOfSync</option>
      </select>
    </div>

    <!-- Error State -->
    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <!-- Empty State -->
    <div v-else-if="apps.length === 0 && !api.loading.value" class="empty-state card">
      <div class="empty-state-icon">&#9881;</div>
      <div>No ArgoCD applications found</div>
      <div class="text-secondary" style="font-size: 11px">Check that the ArgoCD integration is enabled and the namespace is correct.</div>
    </div>

    <!-- No Results -->
    <div v-else-if="filteredApps.length === 0" class="empty-state card">
      <div class="empty-state-icon">&#9906;</div>
      <div>No matching applications</div>
    </div>

    <!-- Table -->
    <div v-else class="argo-table card">
      <div class="argo-table-header">
        <div class="col-name">Name</div>
        <div class="col-project">Project</div>
        <div class="col-health">Health</div>
        <div class="col-sync">Sync</div>
        <div class="col-repo">Repo</div>
        <div class="col-ns">Namespace</div>
        <div class="col-synced">Last Synced</div>
        <div class="col-action"></div>
      </div>
      <router-link
        v-for="app in filteredApps"
        :key="app.name"
        :to="{ name: 'argocd-detail', params: { name: app.name } }"
        class="argo-table-row"
      >
        <div class="col-name">
          <span class="app-name mono">{{ app.name }}</span>
        </div>
        <div class="col-project mono text-secondary">{{ app.project }}</div>
        <div class="col-health">
          <span class="badge" :class="healthClass(app.health_status)">{{ app.health_status }}</span>
        </div>
        <div class="col-sync">
          <span class="badge" :class="syncClass(app.sync_status)">{{ app.sync_status }}</span>
        </div>
        <div class="col-repo mono text-muted" :title="app.repo">{{ truncateRepo(app.repo) }}</div>
        <div class="col-ns mono text-secondary">{{ app.dest_namespace }}</div>
        <div class="col-synced mono text-muted">{{ relativeTime(app.last_synced_at) }}</div>
        <div class="col-action">
          <router-link
            v-if="features.sre_agent && app.health_status !== 'Healthy'"
            :to="investigateUrl(app)"
            class="btn-investigate"
            @click.stop
          >
            Investigate
          </router-link>
        </div>
      </router-link>
    </div>
  </div>
</template>

<style scoped src="../styles/views/ArgoView.css"></style>
