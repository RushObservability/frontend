<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { K8sSummary, K8sResource } from '../types'

const api = useApi()
const route = useRoute()

const page = computed(() => (route.params.page as string) || 'workloads')

// group → ordered list of resource kinds
const GROUPS: Record<string, string[]> = {
  workloads: ['deployments', 'statefulsets', 'daemonsets', 'pods', 'jobs', 'cronjobs'],
  networking: ['services', 'ingresses'],
  config: ['configmaps', 'secrets'],
  cluster: ['nodes', 'namespaces', 'events'],
}
// kind → display label + columns (key in `cols` → header). Name/Namespace/Age added automatically.
const KINDS: Record<string, { label: string; namespaced: boolean; cols: Array<[string, string]> }> = {
  deployments: { label: 'Deployments', namespaced: true, cols: [['ready', 'Ready'], ['uptodate', 'Up-to-date'], ['available', 'Available']] },
  statefulsets: { label: 'StatefulSets', namespaced: true, cols: [['ready', 'Ready']] },
  daemonsets: { label: 'DaemonSets', namespaced: true, cols: [['desired', 'Desired'], ['current', 'Current'], ['ready', 'Ready'], ['available', 'Available']] },
  pods: { label: 'Pods', namespaced: true, cols: [['ready', 'Ready'], ['status', 'Status'], ['restarts', 'Restarts'], ['node', 'Node']] },
  jobs: { label: 'Jobs', namespaced: true, cols: [['completions', 'Completions'], ['active', 'Active'], ['failed', 'Failed']] },
  cronjobs: { label: 'CronJobs', namespaced: true, cols: [['schedule', 'Schedule'], ['suspend', 'Suspend'], ['active', 'Active'], ['last_schedule', 'Last Schedule']] },
  services: { label: 'Services', namespaced: true, cols: [['type', 'Type'], ['cluster_ip', 'Cluster IP'], ['ports', 'Ports']] },
  ingresses: { label: 'Ingresses', namespaced: true, cols: [['class', 'Class'], ['hosts', 'Hosts'], ['address', 'Address']] },
  configmaps: { label: 'ConfigMaps', namespaced: true, cols: [['keys', 'Keys']] },
  secrets: { label: 'Secrets', namespaced: true, cols: [['type', 'Type'], ['keys', 'Keys']] },
  nodes: { label: 'Nodes', namespaced: false, cols: [['status', 'Status'], ['roles', 'Roles'], ['version', 'Version']] },
  namespaces: { label: 'Namespaces', namespaced: false, cols: [['status', 'Status']] },
  events: { label: 'Events', namespaced: true, cols: [['type', 'Type'], ['reason', 'Reason'], ['object', 'Object'], ['message', 'Message'], ['count', 'Count']] },
}

const summary = ref<K8sSummary | null>(null)
const namespaces = ref<string[]>([])
const selectedNs = ref<string>('') // '' = all
const search = ref('')
const unhealthyOnly = ref(false)
const data = ref<Record<string, K8sResource[]>>({})
const loading = ref(false)

const kinds = computed<string[]>(() => GROUPS[page.value] ?? GROUPS.workloads ?? [])

async function loadSummary() {
  try { summary.value = await api.getK8sSummary() } catch { /* ignore */ }
}
async function loadNamespaces() {
  try { namespaces.value = (await api.getK8sNamespaces()).map((n) => n.name).sort() } catch { /* ignore */ }
}
async function loadGroup() {
  loading.value = true
  const next: Record<string, K8sResource[]> = {}
  await Promise.all(kinds.value.map(async (k) => {
    const ns = KINDS[k]!.namespaced ? (selectedNs.value || undefined) : undefined
    try { next[k] = await api.getK8sResources(k, ns) } catch { next[k] = [] }
  }))
  data.value = next
  loading.value = false
}

onMounted(async () => { await Promise.all([loadSummary(), loadNamespaces(), loadGroup()]) })
watch(page, () => { search.value = ''; loadGroup() })
watch(selectedNs, loadGroup)

function rowsFor(kind: string): K8sResource[] {
  let r = data.value[kind] || []
  if (unhealthyOnly.value) r = r.filter((x) => x.unhealthy)
  if (search.value) {
    const q = search.value.toLowerCase()
    r = r.filter((x) => x.name.toLowerCase().includes(q) || x.namespace.toLowerCase().includes(q))
  }
  return r
}
// Show the Namespace column only for namespaced kinds when not scoped to one namespace.
function showNs(kind: string): boolean {
  return KINDS[kind]!.namespaced && !selectedNs.value
}
function clickable(kind: string): boolean {
  return kind !== 'events'
}

function relativeTime(ts: string): string {
  if (!ts) return '—'
  try {
    const diffSec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (diffSec < 60) return `${diffSec}s`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`
    return `${Math.floor(diffSec / 86400)}d`
  } catch { return ts }
}
</script>

<template>
  <div class="argo-page">
    <div class="section-header">
      <h2 class="section-title">Kubernetes — {{ (page.charAt(0).toUpperCase() + page.slice(1)) }}</h2>
    </div>

    <!-- Cluster stat bar -->
    <div class="stats-bar" v-if="summary">
      <div class="stat-item"><span class="stat-value">{{ summary.nodes_ready }}/{{ summary.nodes_total }}</span><span class="stat-label">Nodes Ready</span></div>
      <div class="stat-item stat-ok"><span class="stat-value">{{ summary.pods_running }}/{{ summary.pods_total }}</span><span class="stat-label">Pods Running</span></div>
      <div class="stat-item stat-error"><span class="stat-value">{{ summary.pods_unhealthy }}</span><span class="stat-label">Pods Unhealthy</span></div>
      <div class="stat-item"><span class="stat-value">{{ summary.namespaces }}</span><span class="stat-label">Namespaces</span></div>
      <div class="stat-item stat-warning"><span class="stat-value">{{ summary.warnings }}</span><span class="stat-label">Warnings</span></div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <input v-model="search" class="filter-input mono" placeholder="Search by name or namespace…" />
      <select v-model="selectedNs" class="filter-select mono">
        <option value="">All namespaces</option>
        <option v-for="ns in namespaces" :key="ns" :value="ns">{{ ns }}</option>
      </select>
      <label class="k8s-toggle">
        <input type="checkbox" v-model="unhealthyOnly" /> Unhealthy only
      </label>
    </div>

    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <!-- One section per kind in the group -->
    <template v-for="kind in kinds" :key="kind">
      <div class="k8s-section">
        <h3 class="k8s-section-title">{{ KINDS[kind]!.label }} <span class="k8s-count">{{ rowsFor(kind).length }}</span></h3>
        <div v-if="!rowsFor(kind).length" class="k8s-empty">{{ loading ? 'Loading…' : 'None' }}</div>
        <div v-else class="argo-table card">
          <div class="argo-table-header">
            <div class="col-name">Name</div>
            <div v-if="showNs(kind)" class="col-ns">Namespace</div>
            <div v-for="c in KINDS[kind]!.cols" :key="c[0]" class="col-generic">{{ c[1] }}</div>
            <div class="col-age">Age</div>
          </div>
          <component
            :is="clickable(kind) ? 'router-link' : 'div'"
            v-for="r in rowsFor(kind)"
            :key="r.namespace + '/' + r.name"
            :to="clickable(kind) ? { name: 'kubernetes-detail', params: { kind, namespace: r.namespace || '_', name: r.name } } : undefined"
            class="argo-table-row"
            :class="{ 'k8s-row-unhealthy': r.unhealthy }"
          >
            <div class="col-name"><span class="app-name mono">{{ r.name }}</span></div>
            <div v-if="showNs(kind)" class="col-ns mono text-secondary">{{ r.namespace }}</div>
            <div v-for="c in KINDS[kind]!.cols" :key="c[0]" class="col-generic mono text-secondary" :title="r.cols[c[0]]">{{ r.cols[c[0]] || '—' }}</div>
            <div class="col-age mono text-muted">{{ relativeTime(r.creation_ts) }}</div>
          </component>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ArgoView.css"></style>
<style scoped>
.k8s-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.k8s-section { margin-bottom: var(--sp-5, 20px); }
.k8s-section-title { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--text-primary); }
.k8s-count { color: var(--text-tertiary); font-weight: 400; margin-left: 4px; }
.k8s-empty { font-size: 12px; color: var(--text-tertiary); padding: 4px 2px 8px; }
.col-generic { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 12px; }
.col-age { width: 64px; flex-shrink: 0; }
.argo-table-row.k8s-row-unhealthy .col-name { box-shadow: inset 2px 0 0 var(--error, #ef4444); }
</style>
