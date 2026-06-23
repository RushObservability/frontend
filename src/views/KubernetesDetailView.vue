<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi'
import type { K8sResourceDetail } from '../types'

const props = defineProps<{ kind: string; namespace: string; name: string }>()

const api = useApi()
const detail = ref<K8sResourceDetail | null>(null)

onMounted(load)
async function load() {
  try { detail.value = await api.getK8sResource(props.kind, props.namespace, props.name) } catch { /* error in api.error */ }
}

const cols = computed(() => detail.value?.summary.cols || {})
const labelEntries = computed(() => Object.entries(detail.value?.labels || {}))

function condClass(status: string): string {
  return status === 'True' ? 'condition-ok' : status === 'False' ? 'condition-error' : 'condition-warning'
}
function formatDate(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return ts }
}
</script>

<template>
  <div class="argo-detail-page">
    <div v-if="api.loading.value && !detail" class="empty-state card"><div class="search-spinner"></div></div>
    <div v-else-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <template v-else-if="detail">
      <div class="detail-header">
        <div class="detail-header-left">
          <router-link to="/integrations/kubernetes/workloads" class="back-link">&larr; Kubernetes</router-link>
          <h2 class="detail-title mono">{{ detail.summary.name }}</h2>
          <div class="detail-badges">
            <span class="badge badge-project">{{ kind }}</span>
            <span v-if="detail.summary.namespace" class="badge badge-muted">{{ detail.summary.namespace }}</span>
            <span class="badge" :class="detail.summary.unhealthy ? 'badge-error' : 'badge-ok'">{{ detail.summary.unhealthy ? 'Unhealthy' : 'Healthy' }}</span>
          </div>
        </div>
      </div>

      <!-- Summary fields + owners -->
      <div class="info-grid">
        <div class="info-card card">
          <div class="info-card-title">Status</div>
          <div v-for="(v, k) in cols" :key="k" class="info-row">
            <span class="info-label">{{ k }}</span>
            <span class="info-value mono">{{ v || '—' }}</span>
          </div>
          <div class="info-row" v-if="detail.summary.creation_ts">
            <span class="info-label">created</span>
            <span class="info-value mono">{{ formatDate(detail.summary.creation_ts) }}</span>
          </div>
        </div>
        <div class="info-card card">
          <div class="info-card-title">Metadata</div>
          <div class="info-row" v-if="detail.owners.length">
            <span class="info-label">Owned by</span>
            <span class="info-value mono">{{ detail.owners.map(o => o.kind + '/' + o.name).join(', ') }}</span>
          </div>
          <div class="info-row" v-for="[lk, lv] in labelEntries.slice(0, 12)" :key="lk">
            <span class="info-label">{{ lk }}</span>
            <span class="info-value mono">{{ lv }}</span>
          </div>
          <div v-if="!detail.owners.length && !labelEntries.length" class="info-row">
            <span class="info-value mono text-muted">No labels or owners</span>
          </div>
        </div>
      </div>

      <!-- Containers (pods) -->
      <div v-if="detail.containers.length" class="resources-section card">
        <div class="resources-title">Containers</div>
        <div class="resources-table">
          <div class="resources-header">
            <div class="rcol-name">Name</div>
            <div class="rcol-kind">Image</div>
            <div class="rcol-health">Ready</div>
            <div class="rcol-ns">Restarts</div>
            <div class="rcol-sync">State</div>
          </div>
          <div v-for="(c, i) in detail.containers" :key="i" class="resources-row">
            <div class="rcol-name mono">{{ c.name }}</div>
            <div class="rcol-kind mono text-muted" :title="c.image">{{ c.image }}</div>
            <div class="rcol-health"><span class="badge" :class="c.ready ? 'badge-ok' : 'badge-error'">{{ c.ready ? 'Yes' : 'No' }}</span></div>
            <div class="rcol-ns mono">{{ c.restarts }}</div>
            <div class="rcol-sync mono">{{ c.state }}<template v-if="c.reason"> ({{ c.reason }})</template></div>
          </div>
        </div>
      </div>

      <!-- Conditions -->
      <div v-if="detail.conditions.length" class="resources-section card">
        <div class="resources-title">Conditions</div>
        <div class="conditions-section">
          <div v-for="(c, i) in detail.conditions" :key="i" class="condition-banner" :class="condClass(c.status)">
            <span class="condition-type">{{ c.type }} = {{ c.status }}<template v-if="c.reason"> ({{ c.reason }})</template></span>
            <span class="condition-message">{{ c.message }}</span>
          </div>
        </div>
      </div>

      <!-- Events -->
      <div v-if="detail.events.length" class="resources-section card">
        <div class="resources-title">Events</div>
        <div class="resources-table">
          <div class="resources-header">
            <div class="rcol-kind">Type</div>
            <div class="rcol-name">Reason</div>
            <div class="rcol-sync">Message</div>
            <div class="rcol-ns">Count</div>
          </div>
          <div v-for="(e, i) in detail.events" :key="i" class="resources-row">
            <div class="rcol-kind"><span class="badge" :class="e.type === 'Warning' ? 'badge-warning' : 'badge-muted'">{{ e.type }}</span></div>
            <div class="rcol-name mono">{{ e.reason }}</div>
            <div class="rcol-sync mono text-secondary" :title="e.message">{{ e.message }}</div>
            <div class="rcol-ns mono">{{ e.count }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ArgoDetailView.css"></style>
