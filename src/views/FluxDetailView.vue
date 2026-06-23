<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { FluxResourceDetail } from '../types'

const props = defineProps<{ kind: string; name: string }>()

const api = useApi()
const { features } = useFeatures()
const res = ref<FluxResourceDetail | null>(null)

onMounted(load)

async function load() {
  try {
    res.value = await api.getFluxResource(props.kind, props.name)
  } catch { /* error in api.error */ }
}

function readyClass(ready: string): string {
  switch (ready) {
    case 'True': return 'badge-ok'
    case 'False': return 'badge-error'
    default: return 'badge-muted'
  }
}
const readyLabel = (r: string) => (r === 'True' ? 'Ready' : r === 'False' ? 'Not Ready' : 'Unknown')

function condClass(status: string): string {
  // For a Ready condition, status=True is good; for Stalled/Reconciling, True is informational.
  return status === 'True' ? 'condition-ok' : status === 'False' ? 'condition-error' : 'condition-warning'
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

function investigateUrl(): string {
  if (!res.value) return '/investigate'
  const r = res.value
  const ctx = `Flux ${r.kind} "${r.name}" in namespace "${r.namespace}" is ${readyLabel(r.ready)}${r.suspended ? ' (suspended)' : ''}. Source: ${r.source}. Applied revision: ${r.last_applied_revision}. ${r.message}`
  return `/investigate?q=${encodeURIComponent(`Investigate Flux ${r.kind} ${r.name}`)}&ctx=${encodeURIComponent(ctx)}`
}
</script>

<template>
  <div class="argo-detail-page">
    <div v-if="api.loading.value && !res" class="empty-state card">
      <div class="search-spinner"></div>
    </div>

    <div v-else-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <template v-else-if="res">
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-header-left">
          <router-link to="/integrations/fluxcd/workloads" class="back-link">&larr; Workloads</router-link>
          <h2 class="detail-title mono">{{ res.name }}</h2>
          <div class="detail-badges">
            <span class="badge badge-project">{{ res.kind }}</span>
            <span class="badge" :class="readyClass(res.ready)">{{ readyLabel(res.ready) }}</span>
            <span v-if="res.suspended" class="badge badge-warning">Suspended</span>
            <span v-else-if="res.reconciling" class="badge badge-warning">Reconciling</span>
          </div>
        </div>
        <router-link v-if="features.sre_agent && res.ready !== 'True'" :to="investigateUrl()" class="btn-investigate-lg">
          Investigate with AI
        </router-link>
      </div>

      <!-- Ready message -->
      <div v-if="res.message" class="conditions-section">
        <div class="condition-banner" :class="res.ready === 'False' ? 'condition-error' : 'condition-warning'">
          <span class="condition-type">{{ res.ready_reason || 'Status' }}</span>
          <span class="condition-message">{{ res.message }}</span>
        </div>
      </div>

      <!-- Source & Revisions -->
      <div class="info-grid">
        <div class="info-card card">
          <div class="info-card-title">Source</div>
          <div class="info-row"><span class="info-label">Source Ref</span><span class="info-value mono">{{ res.source || '—' }}</span></div>
          <div class="info-row" v-if="res.path"><span class="info-label">Path</span><span class="info-value mono">{{ res.path }}</span></div>
          <div class="info-row" v-if="res.chart"><span class="info-label">Chart</span><span class="info-value mono">{{ res.chart }}<template v-if="res.chart_version"> @ {{ res.chart_version }}</template></span></div>
          <div class="info-row" v-if="res.interval"><span class="info-label">Interval</span><span class="info-value mono">{{ res.interval }}</span></div>
          <div class="info-row" v-if="res.namespace"><span class="info-label">Namespace</span><span class="info-value mono">{{ res.namespace }}</span></div>
        </div>
        <div class="info-card card">
          <div class="info-card-title">Revisions</div>
          <div class="info-row"><span class="info-label">Last Applied</span><span class="info-value mono">{{ res.last_applied_revision || '—' }}</span></div>
          <div class="info-row" v-if="res.last_attempted_revision && res.last_attempted_revision !== res.last_applied_revision">
            <span class="info-label">Last Attempted</span><span class="info-value mono">{{ res.last_attempted_revision }}</span>
          </div>
          <div class="info-row" v-if="res.last_reconciled_at"><span class="info-label">Last Reconciled</span><span class="info-value mono">{{ formatDate(res.last_reconciled_at) }}</span></div>
          <div class="info-row" v-if="res.depends_on && res.depends_on.length">
            <span class="info-label">Depends On</span><span class="info-value mono">{{ res.depends_on.join(', ') }}</span>
          </div>
        </div>
      </div>

      <!-- Conditions -->
      <div v-if="res.conditions && res.conditions.length" class="resources-section card">
        <div class="resources-title">Conditions</div>
        <div class="conditions-section">
          <div v-for="(c, i) in res.conditions" :key="i" class="condition-banner" :class="condClass(c.status)">
            <span class="condition-type">{{ c.type }} = {{ c.status }}<template v-if="c.reason"> ({{ c.reason }})</template></span>
            <span class="condition-message">{{ c.message }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ArgoDetailView.css"></style>
