<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { ArgoAppDetail } from '../types'

const props = defineProps<{ name: string }>()

const api = useApi()
const { features } = useFeatures()
const app = ref<ArgoAppDetail | null>(null)

onMounted(async () => {
  await loadApp()
})

async function loadApp() {
  try {
    app.value = await api.getArgoApp(props.name)
  } catch { /* error in api.error */ }
}

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

function shortRevision(rev: string): string {
  if (!rev) return ''
  return rev.length > 7 ? rev.substring(0, 7) : rev
}

function formatDate(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function conditionClass(type: string): string {
  const lower = type.toLowerCase()
  if (lower.includes('error') || lower.includes('degraded')) return 'condition-error'
  if (lower.includes('warning')) return 'condition-warning'
  return 'condition-warning'
}

const recentHistory = computed(() => {
  if (!app.value?.history) return []
  return app.value.history.slice(0, 10)
})

function investigateUrl(): string {
  if (!app.value) return '/investigate'
  const ctx = `ArgoCD app "${app.value.name}" in project "${app.value.project}" is ${app.value.health_status}/${app.value.sync_status} in namespace "${app.value.dest_namespace}". Repo: ${app.value.repo}, Path: ${app.value.path}.`
  return `/investigate?q=${encodeURIComponent(`Investigate ArgoCD app ${app.value.name}`)}&ctx=${encodeURIComponent(ctx)}`
}
</script>

<template>
  <div class="argo-detail-page">
    <!-- Loading -->
    <div v-if="api.loading.value && !app" class="empty-state card">
      <div class="search-spinner"></div>
    </div>

    <!-- Error -->
    <div v-else-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <template v-else-if="app">
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-header-left">
          <router-link to="/integrations/argocd/applications" class="back-link">&larr; Applications</router-link>
          <h2 class="detail-title mono">{{ app.name }}</h2>
          <div class="detail-badges">
            <span class="badge badge-project">{{ app.project }}</span>
            <span class="badge" :class="healthClass(app.health_status)">{{ app.health_status }}</span>
            <span class="badge" :class="syncClass(app.sync_status)">{{ app.sync_status }}</span>
          </div>
        </div>
        <router-link v-if="features.sre_agent" :to="investigateUrl()" class="btn-investigate-lg">
          Investigate with AI
        </router-link>
      </div>

      <!-- Conditions -->
      <div v-if="app.conditions && app.conditions.length > 0" class="conditions-section">
        <div
          v-for="(cond, i) in app.conditions"
          :key="i"
          class="condition-banner"
          :class="conditionClass(cond.type)"
        >
          <span class="condition-type">{{ cond.type }}</span>
          <span class="condition-message">{{ cond.message }}</span>
        </div>
      </div>

      <!-- Source & Destination -->
      <div class="info-grid">
        <div class="info-card card">
          <div class="info-card-title">{{ (app as any).sources?.length > 0 ? 'Sources' : 'Source' }}</div>
          <template v-if="(app as any).sources?.length > 0">
            <div v-for="(src, si) in (app as any).sources" :key="si" class="multi-source-block">
              <div class="info-row" v-if="src.repo">
                <span class="info-label">Repo</span>
                <span class="info-value mono">{{ src.repo }}</span>
              </div>
              <div class="info-row" v-if="src.path">
                <span class="info-label">Path</span>
                <span class="info-value mono">{{ src.path }}</span>
              </div>
              <div class="info-row" v-if="src.chart">
                <span class="info-label">Chart</span>
                <span class="info-value mono">{{ src.chart }}</span>
              </div>
              <div class="info-row" v-if="src.target_revision">
                <span class="info-label">Revision</span>
                <span class="info-value mono">{{ src.target_revision }}</span>
              </div>
              <div class="info-row" v-if="src.ref">
                <span class="info-label">Ref</span>
                <span class="info-value mono">{{ src.ref }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="info-row">
              <span class="info-label">Repo</span>
              <span class="info-value mono">{{ app.repo }}</span>
            </div>
            <div class="info-row" v-if="app.path">
              <span class="info-label">Path</span>
              <span class="info-value mono">{{ app.path }}</span>
            </div>
            <div class="info-row" v-if="app.chart">
              <span class="info-label">Chart</span>
              <span class="info-value mono">{{ app.chart }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Target Revision</span>
              <span class="info-value mono">{{ app.target_revision || 'HEAD' }}</span>
            </div>
          </template>
        </div>
        <div class="info-card card">
          <div class="info-card-title">Destination</div>
          <div class="info-row">
            <span class="info-label">Cluster</span>
            <span class="info-value mono">{{ app.dest_server }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Namespace</span>
            <span class="info-value mono">{{ app.dest_namespace }}</span>
          </div>
          <div class="info-row" v-if="app.sync_revision">
            <span class="info-label">Sync Revision</span>
            <span class="info-value mono">{{ shortRevision(app.sync_revision) }}</span>
          </div>
          <div class="info-row" v-if="app.last_synced_at">
            <span class="info-label">Last Synced</span>
            <span class="info-value mono">{{ formatDate(app.last_synced_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Unhealthy Resources -->
      <div v-if="app.unhealthy_resources && app.unhealthy_resources.length > 0" class="resources-section card">
        <div class="resources-title">Unhealthy Resources</div>
        <div class="resources-table">
          <div class="resources-header">
            <div class="rcol-kind">Kind</div>
            <div class="rcol-name">Name</div>
            <div class="rcol-ns">Namespace</div>
            <div class="rcol-health">Health</div>
            <div class="rcol-sync">Sync</div>
          </div>
          <div v-for="(res, i) in app.unhealthy_resources" :key="i" class="resources-row">
            <div class="rcol-kind mono">{{ res.kind }}</div>
            <div class="rcol-name mono">{{ res.name }}</div>
            <div class="rcol-ns mono text-secondary">{{ res.namespace }}</div>
            <div class="rcol-health">
              <span class="badge" :class="healthClass(res.health_status)">{{ res.health_status }}</span>
            </div>
            <div class="rcol-sync">
              <span class="badge" :class="syncClass(res.sync_status)">{{ res.sync_status }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Sync History -->
      <div v-if="recentHistory.length > 0" class="history-section card">
        <div class="history-title">Sync History</div>
        <div class="history-table">
          <div class="history-header">
            <div class="hcol-rev">Revision</div>
            <div class="hcol-deployed">Deployed At</div>
            <div class="hcol-source">Source</div>
          </div>
          <div v-for="(entry, i) in recentHistory" :key="i" class="history-row">
            <div class="hcol-rev mono">{{ shortRevision(entry.revision) }}</div>
            <div class="hcol-deployed mono text-secondary">{{ formatDate(entry.deployed_at) }}</div>
            <div class="hcol-source mono text-muted" :title="entry.source_repo">
              {{ entry.source_path || entry.source_repo }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ArgoDetailView.css"></style>
