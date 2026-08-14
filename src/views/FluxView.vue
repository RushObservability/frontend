<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import type { FluxResource, FluxSource } from '../types'

const api = useApi()
const route = useRoute()
const { features } = useFeatures()

// Both the "workloads" and "sources" catalog pages render this view; switch on the route page.
const page = computed(() => (route.params.page as string) || 'workloads')

const resources = ref<FluxResource[]>([])
const sources = ref<FluxSource[]>([])
const loading = ref(false)

const search = ref('')
const readyFilter = ref('')
const kindFilter = ref('')

async function load() {
  loading.value = true
  try {
    if (page.value === 'sources') {
      sources.value = await api.getFluxSources()
    } else {
      resources.value = await api.getFluxResources()
    }
  } catch { /* surfaced via api.error */ } finally {
    loading.value = false
  }
}

onMounted(load)
watch(page, () => { search.value = ''; readyFilter.value = ''; kindFilter.value = ''; load() })

// ── Workloads (Kustomization + HelmRelease) ──
const stats = computed(() => {
  const all = resources.value
  return {
    total: all.length,
    ready: all.filter((r) => r.ready === 'True').length,
    failed: all.filter((r) => r.ready === 'False').length,
    reconciling: all.filter((r) => r.reconciling).length,
    suspended: all.filter((r) => r.suspended).length,
  }
})

const filteredResources = computed(() => {
  let r = resources.value
  if (search.value) {
    const q = search.value.toLowerCase()
    r = r.filter((x) => x.name.toLowerCase().includes(q) || x.namespace.toLowerCase().includes(q) || x.source.toLowerCase().includes(q))
  }
  if (readyFilter.value) r = r.filter((x) => x.ready === readyFilter.value)
  if (kindFilter.value) r = r.filter((x) => x.kind === kindFilter.value)
  return r
})

const filteredSources = computed(() => {
  let r = sources.value
  if (search.value) {
    const q = search.value.toLowerCase()
    r = r.filter((x) => x.name.toLowerCase().includes(q) || x.namespace.toLowerCase().includes(q) || x.url.toLowerCase().includes(q))
  }
  if (readyFilter.value) r = r.filter((x) => x.ready === readyFilter.value)
  if (kindFilter.value) r = r.filter((x) => x.kind === kindFilter.value)
  return r
})

function readyClass(ready: string): string {
  switch (ready) {
    case 'True': return 'badge-ok'
    case 'False': return 'badge-error'
    default: return 'badge-muted'
  }
}
const readyLabel = (r: string) => (r === 'True' ? 'Ready' : r === 'False' ? 'Not Ready' : 'Unknown')

function shortRev(rev: string): string {
  if (!rev) return '—'
  // e.g. "main@sha1:abcdef..." → keep ref + 7-char sha
  const m = rev.match(/^(.*[@:])([0-9a-f]{7,})/i)
  return m ? `${m[1]}${m[2]!.slice(0, 7)}` : (rev.length > 28 ? rev.slice(0, 28) + '…' : rev)
}

function relativeTime(ts: string): string {
  if (!ts) return '—'
  try {
    const diffSec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  } catch { return ts }
}

function investigateUrl(r: FluxResource): string {
  const ctx = `Flux ${r.kind} "${r.name}" in namespace "${r.namespace}" is ${readyLabel(r.ready)}${r.suspended ? ' (suspended)' : ''}; source ${r.source}; ${r.message}`
  return `/investigate?q=${encodeURIComponent(`Why is Flux ${r.kind} ${r.name} not ready?`)}&ctx=${encodeURIComponent(ctx)}`
}
</script>

<template>
  <div class="argo-page">
    <div class="section-header">
      <h2 class="section-title">{{ page === 'sources' ? 'Flux Sources' : 'Flux Workloads' }}</h2>
    </div>

    <!-- Stats (workloads only) -->
    <div class="stats-bar" v-if="page !== 'sources' && resources.length > 0">
      <div class="stat-item"><span class="stat-value">{{ stats.total }}</span><span class="stat-label">Total</span></div>
      <div class="stat-item stat-ok"><span class="stat-value">{{ stats.ready }}</span><span class="stat-label">Ready</span></div>
      <div class="stat-item stat-error"><span class="stat-value">{{ stats.failed }}</span><span class="stat-label">Failed</span></div>
      <div class="stat-item stat-warning"><span class="stat-value">{{ stats.reconciling }}</span><span class="stat-label">Reconciling</span></div>
      <div class="stat-item stat-warning"><span class="stat-value">{{ stats.suspended }}</span><span class="stat-label">Suspended</span></div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <input v-model="search" class="filter-input mono" placeholder="Search by name, namespace, or source…" />
      <select v-model="readyFilter" class="filter-select mono">
        <option value="">All Ready states</option>
        <option value="True">Ready</option>
        <option value="False">Not Ready</option>
        <option value="Unknown">Unknown</option>
      </select>
      <select v-model="kindFilter" class="filter-select mono">
        <option value="">All Kinds</option>
        <template v-if="page === 'sources'">
          <option value="GitRepository">GitRepository</option>
          <option value="OCIRepository">OCIRepository</option>
          <option value="HelmRepository">HelmRepository</option>
          <option value="Bucket">Bucket</option>
        </template>
        <template v-else>
          <option value="Kustomization">Kustomization</option>
          <option value="HelmRelease">HelmRelease</option>
        </template>
      </select>
    </div>

    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <!-- ── Sources table ── -->
    <template v-if="page === 'sources'">
      <div v-if="!sources.length && !loading" class="empty-state card">
        <div class="empty-state-icon">&#9881;</div>
        <div>No Flux sources found</div>
        <div class="text-secondary" style="font-size: 11px">Check that the FluxCD integration is enabled and the namespace is correct.</div>
      </div>
      <div v-else-if="filteredSources.length" class="argo-table card">
        <div class="argo-table-header">
          <div class="col-name">Name</div>
          <div class="col-project">Kind</div>
          <div class="col-ns">Namespace</div>
          <div class="col-health">Ready</div>
          <div class="col-repo">URL</div>
          <div class="col-synced">Revision</div>
          <div class="col-sync">Suspended</div>
        </div>
        <div v-for="s in filteredSources" :key="s.kind + s.namespace + s.name" class="argo-table-row" style="cursor: default">
          <div class="col-name"><span class="app-name mono">{{ s.name }}</span></div>
          <div class="col-project mono text-secondary">{{ s.kind }}</div>
          <div class="col-ns mono text-secondary">{{ s.namespace }}</div>
          <div class="col-health"><span class="badge" :class="readyClass(s.ready)">{{ readyLabel(s.ready) }}</span></div>
          <div class="col-repo mono text-muted" :title="s.url">{{ s.url }}</div>
          <div class="col-synced mono text-muted" :title="s.revision">{{ shortRev(s.revision) }}</div>
          <div class="col-sync">{{ s.suspended ? 'Yes' : '—' }}</div>
        </div>
      </div>
    </template>

    <!-- ── Workloads table ── -->
    <template v-else>
      <div v-if="!resources.length && !loading" class="empty-state card">
        <div class="empty-state-icon">&#9881;</div>
        <div>No Flux Kustomizations or HelmReleases found</div>
        <div class="text-secondary" style="font-size: 11px">Check that the FluxCD integration is enabled and the namespace is correct.</div>
      </div>
      <div v-else-if="filteredResources.length" class="argo-table card">
        <div class="argo-table-header">
          <div class="col-name">Name</div>
          <div class="col-project">Kind</div>
          <div class="col-ns">Namespace</div>
          <div class="col-health">Ready</div>
          <div class="col-repo">Source</div>
          <div class="col-synced">Revision</div>
          <div class="col-sync">Last reconciled</div>
          <div class="col-action"></div>
        </div>
        <router-link
          v-for="r in filteredResources"
          :key="r.kind + r.namespace + r.name"
          :to="{ name: 'fluxcd-detail', params: { kind: r.kind, name: r.name } }"
          class="argo-table-row"
        >
          <div class="col-name">
            <span class="app-name mono">{{ r.name }}</span>
            <span v-if="r.suspended" class="badge badge-warning" style="margin-left:6px">suspended</span>
          </div>
          <div class="col-project mono text-secondary">{{ r.kind }}</div>
          <div class="col-ns mono text-secondary">{{ r.namespace }}</div>
          <div class="col-health">
            <span class="badge" :class="readyClass(r.ready)">{{ readyLabel(r.ready) }}</span>
          </div>
          <div class="col-repo mono text-muted" :title="r.source">{{ r.source || '—' }}</div>
          <div class="col-synced mono text-muted" :title="r.revision">{{ shortRev(r.revision) }}</div>
          <div class="col-sync mono text-muted">{{ relativeTime(r.last_reconciled_at) }}</div>
          <div class="col-action">
            <router-link
              v-if="features.sre_agent && r.ready !== 'True'"
              :to="investigateUrl(r)"
              class="btn-investigate"
              @click.stop
            >Investigate</router-link>
          </div>
        </router-link>
      </div>
      <div v-else-if="resources.length && !filteredResources.length" class="empty-state card">
        <div class="empty-state-icon">&#9906;</div>
        <div>No matching workloads</div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ArgoView.css"></style>
