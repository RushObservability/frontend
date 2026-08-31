<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { Dashboard, DashboardTemplate, DashboardExport } from '../types'

const router = useRouter()
const api = useApi()
const { canWrite } = useAuth()

const dashboards = ref<Dashboard[]>([])
const showCreate = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const scopeFilter = ref<'all' | Dashboard['visibility']>('all')
const pendingDelete = ref<Dashboard | null>(null)
const newName = ref('')
const newDescription = ref('')
const newVisibility = ref<'private' | 'tenant' | 'global'>('tenant')

// Template picker
const showTemplates = ref(false)
const templates = ref<DashboardTemplate[]>([])
const templateName = ref('')
const selectedTemplate = ref<DashboardTemplate | null>(null)

// Import
const showImport = ref(false)
const importJson = ref('')
const importError = ref('')

onMounted(() => {
  loadDashboards()
  window.addEventListener('keydown', focusSearchShortcut)
})
onUnmounted(() => window.removeEventListener('keydown', focusSearchShortcut))

function focusSearchShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (event.key === '/' && !isTyping) {
    event.preventDefault()
    searchInput.value?.focus()
  }
}

async function loadDashboards() {
  try {
    const res = await api.listDashboards()
    dashboards.value = res.dashboards
  } catch {
    // error in api.error
  }
}

async function create() {
  if (!newName.value.trim()) return
  try {
    const dash = await api.createDashboard({
      name: newName.value.trim(),
      description: newDescription.value.trim(),
      visibility: newVisibility.value,
    })
    newName.value = ''
    newDescription.value = ''
    newVisibility.value = 'tenant'
    showCreate.value = false
    router.push(`/dashboards/${dash.id}`)
  } catch {
    // error in api.error
  }
}

async function remove(id: string) {
  try {
    await api.deleteDashboard(id)
    dashboards.value = dashboards.value.filter(d => d.id !== id)
    pendingDelete.value = null
  } catch {
    // error in api.error
  }
}

async function openTemplates() {
  showTemplates.value = true
  try {
    const res = await api.listDashboardTemplates()
    templates.value = res.templates
  } catch {
    // error in api.error
  }
}

function selectTemplate(tpl: DashboardTemplate) {
  selectedTemplate.value = tpl
  templateName.value = tpl.name
}

async function createFromTemplate() {
  if (!selectedTemplate.value || !templateName.value.trim()) return
  try {
    const dash = await api.createFromTemplate(selectedTemplate.value.id, templateName.value.trim())
    showTemplates.value = false
    selectedTemplate.value = null
    templateName.value = ''
    router.push(`/dashboards/${dash.id}`)
  } catch {
    // error in api.error
  }
}

async function exportDash(id: string) {
  try {
    const data = await api.exportDashboard(id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dashboard-${id}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    // error in api.error
  }
}

function openImport() {
  showImport.value = true
  importJson.value = ''
  importError.value = ''
}

async function doImport() {
  importError.value = ''
  try {
    const parsed: DashboardExport = JSON.parse(importJson.value)
    const dash = await api.importDashboard(parsed)
    showImport.value = false
    importJson.value = ''
    router.push(`/dashboards/${dash.id}`)
  } catch (e: any) {
    importError.value = e.message || 'Invalid JSON'
  }
}

function handleFileImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    importJson.value = reader.result as string
  }
  reader.readAsText(file)
}

// ── Table sorting ──
type DashSortKey = 'name' | 'visibility' | 'updated_at'
const sortKey = ref<DashSortKey>('updated_at')
const sortDir = ref<'asc' | 'desc'>('desc')
const sortedDashboards = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const rows = dashboards.value.filter((dash) => {
    const matchesScope = scopeFilter.value === 'all' || dash.visibility === scopeFilter.value
    const matchesQuery = !query || [dash.name, dash.description, ...(dash.tags || [])]
      .some(value => value.toLowerCase().includes(query))
    return matchesScope && matchesQuery
  })
  const k = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => dir * String(a[k] ?? '').localeCompare(String(b[k] ?? '')))
  return rows
})

const dashboardCounts = computed(() => ({
  all: dashboards.value.length,
  tenant: dashboards.value.filter(d => d.visibility === 'tenant').length,
  private: dashboards.value.filter(d => d.visibility === 'private').length,
  global: dashboards.value.filter(d => d.visibility === 'global').length,
}))

const newestUpdate = computed(() => {
  if (!dashboards.value.length) return null
  return dashboards.value.reduce((latest, dash) =>
    new Date(dash.updated_at).getTime() > new Date(latest.updated_at).getTime() ? dash : latest)
})
function setSort(k: DashSortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = k === 'name' ? 'asc' : 'desc' }
}
function sortInd(k: DashSortKey): string {
  if (sortKey.value !== k) return ''
  return sortDir.value === 'asc' ? ' ▲' : ' ▼'
}

function visibilityLabel(v: string): string {
  if (v === 'private') return 'Private'
  if (v === 'global') return 'Global'
  return 'Team'
}

function relativeDate(ts: string): string {
  const elapsed = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'just now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function dashboardInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'D'
}

function categoryLabel(c: string): string {
  return c.toUpperCase()
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}
</script>

<template>
  <div class="dashboards-page">
    <div class="dashboards-heading">
      <div>
        <div class="page-eyebrow">OPERATIONS LIBRARY</div>
        <h1 class="page-title">Dashboards</h1>
        <p class="page-intro">Reusable views for service health, capacity, and incident response.</p>
      </div>
      <div class="header-actions" v-if="canWrite">
        <button class="btn-secondary" @click="openImport">Import JSON</button>
        <button class="btn-secondary" @click="openTemplates">Browse templates</button>
        <button class="btn-create" @click="showCreate = true"><span aria-hidden="true">+</span> New dashboard</button>
      </div>
    </div>

    <div v-if="dashboards.length" class="library-summary" aria-label="Dashboard library summary">
      <div class="summary-primary">
        <span class="summary-value mono">{{ dashboardCounts.all }}</span>
        <span class="summary-label">boards available</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat"><span class="scope-dot scope-dot--tenant"></span>{{ dashboardCounts.tenant }} team</div>
      <div class="summary-stat"><span class="scope-dot scope-dot--global"></span>{{ dashboardCounts.global }} global</div>
      <div class="summary-stat"><span class="scope-dot scope-dot--private"></span>{{ dashboardCounts.private }} private</div>
      <div v-if="newestUpdate" class="summary-latest">
        Latest change <strong>{{ relativeDate(newestUpdate.updated_at) }}</strong>
      </div>
    </div>

    <div v-if="dashboards.length" class="library-controls">
      <label class="dashboard-search">
        <span class="search-glyph" aria-hidden="true"></span>
        <input ref="searchInput" v-model="searchQuery" type="search" placeholder="Search dashboards, descriptions, or tags" aria-label="Search dashboards" />
        <kbd>/</kbd>
      </label>
      <div class="scope-filters" aria-label="Filter dashboards by visibility">
        <button
          v-for="scope in (['all', 'tenant', 'global', 'private'] as const)"
          :key="scope"
          :class="{ active: scopeFilter === scope }"
          @click="scopeFilter = scope"
        >
          {{ scope === 'tenant' ? 'Team' : scope.charAt(0).toUpperCase() + scope.slice(1) }}
          <span>{{ dashboardCounts[scope] }}</span>
        </button>
      </div>
      <div class="result-count mono">{{ sortedDashboards.length }} shown</div>
    </div>

    <!-- Create modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <form class="modal create-modal card" @submit.prevent="create">
        <div class="modal-header">
          <div>
            <div class="modal-kicker">NEW DASHBOARD</div>
            <h2>Build an operational view</h2>
          </div>
          <button type="button" class="modal-close" aria-label="Close" @click="showCreate = false">&times;</button>
        </div>
        <div class="modal-body create-fields">
          <label>
            <span>Name</span>
            <input v-model="newName" class="form-input" placeholder="e.g. Checkout service health" autofocus />
          </label>
          <label>
            <span>Description <em>optional</em></span>
            <textarea v-model="newDescription" class="form-input" rows="3" placeholder="What questions should this dashboard answer?"></textarea>
          </label>
          <fieldset>
            <legend>Who can see it?</legend>
            <label v-for="option in ([
              { value: 'tenant', title: 'Team', note: 'Visible to this tenant' },
              { value: 'private', title: 'Private', note: 'Only visible to you' },
              { value: 'global', title: 'Global', note: 'Visible across tenants' },
            ] as const)" :key="option.value" class="visibility-option" :class="{ selected: newVisibility === option.value }">
              <input v-model="newVisibility" type="radio" :value="option.value" />
              <span><strong>{{ option.title }}</strong><small>{{ option.note }}</small></span>
            </label>
          </fieldset>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" @click="showCreate = false">Cancel</button>
          <button type="submit" class="btn-save" :disabled="!newName.trim()">Create dashboard</button>
        </div>
      </form>
    </div>

    <!-- Import modal -->
    <div v-if="showImport" class="modal-overlay" @click.self="showImport = false">
      <div class="modal card">
        <div class="modal-header">
          <h2>Import Dashboard</h2>
          <button class="modal-close" @click="showImport = false">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-secondary" style="font-size: 12px; margin-bottom: 8px">
            Paste exported JSON or upload a file.
          </p>
          <input type="file" accept=".json" @change="handleFileImport" style="margin-bottom: 8px; font-size: 12px" />
          <textarea
            v-model="importJson"
            class="form-input mono"
            placeholder='{"format_version":"v1",...}'
            rows="8"
            style="width: 100%; resize: vertical"
          ></textarea>
          <div v-if="importError" class="text-error" style="font-size: 11px; margin-top: 4px">{{ importError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showImport = false">Cancel</button>
          <button class="btn-save" @click="doImport" :disabled="!importJson.trim()">Import</button>
        </div>
      </div>
    </div>

    <!-- Template picker modal -->
    <div v-if="showTemplates" class="modal-overlay" @click.self="showTemplates = false">
      <div class="modal modal-wide card">
        <div class="modal-header">
          <h2>Create from Template</h2>
          <button class="modal-close" @click="showTemplates = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="!selectedTemplate" class="template-grid">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="template-card card"
              @click="selectTemplate(tpl)"
            >
              <div class="template-category">{{ categoryLabel(tpl.category) }}</div>
              <div class="template-name">{{ tpl.name }}</div>
              <div class="template-desc text-secondary">{{ tpl.description }}</div>
              <div v-if="tpl.is_builtin" class="template-badge">Built-in</div>
            </div>
          </div>
          <div v-else class="template-confirm">
            <p class="text-secondary" style="font-size: 12px; margin-bottom: 8px">
              Creating dashboard from <strong>{{ selectedTemplate.name }}</strong>
            </p>
            <input
              v-model="templateName"
              class="form-input mono"
              placeholder="Dashboard name"
              @keyup.enter="createFromTemplate"
              style="width: 100%; margin-bottom: 8px"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button v-if="selectedTemplate" class="btn-secondary" @click="selectedTemplate = null">Back</button>
          <button class="btn-secondary" @click="showTemplates = false; selectedTemplate = null">Cancel</button>
          <button
            v-if="selectedTemplate"
            class="btn-save"
            @click="createFromTemplate"
            :disabled="!templateName.trim()"
          >Create</button>
        </div>
      </div>
    </div>

    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <div v-else-if="dashboards.length === 0 && !api.loading.value" class="empty-state card">
      <div class="empty-state-icon">&#9632;</div>
      <div>No dashboards yet</div>
      <div class="text-secondary" style="font-size: 11px">Start from a template, or build one from scratch.</div>
      <div v-if="canWrite" class="empty-actions">
        <button class="btn-create" @click="openTemplates">Start from template</button>
        <button class="btn-secondary" @click="showCreate = true">New dashboard</button>
      </div>
    </div>

    <div v-else-if="sortedDashboards.length" class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr>
            <th class="dt-col-name sortable" @click="setSort('name')">Dashboard<span class="dt-sort">{{ sortInd('name') }}</span></th>
            <th class="dt-col-vis sortable" @click="setSort('visibility')">Scope<span class="dt-sort">{{ sortInd('visibility') }}</span></th>
            <th class="dt-col-tags">Tags</th>
            <th class="dt-col-updated sortable" @click="setSort('updated_at')">Updated<span class="dt-sort">{{ sortInd('updated_at') }}</span></th>
            <th class="dt-col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="dash in sortedDashboards"
            :key="dash.id"
            class="dt-row"
            tabindex="0"
            @click="router.push(`/dashboards/${dash.id}`)"
            @keydown.enter="router.push(`/dashboards/${dash.id}`)"
            @keydown.space.prevent="router.push(`/dashboards/${dash.id}`)"
          >
            <td class="dt-col-name">
              <div class="dt-dashboard-identity">
                <div class="dashboard-mark" :class="`dashboard-mark--${dash.visibility}`">{{ dashboardInitial(dash.name) }}</div>
                <div class="dt-name-copy">
                  <div class="dt-name">{{ dash.name }} <span class="row-arrow" aria-hidden="true">→</span></div>
                  <div v-if="dash.description" class="dt-desc text-muted">{{ dash.description }}</div>
                  <div v-else class="dt-desc text-muted">No description added</div>
                </div>
              </div>
            </td>
            <td class="dt-col-vis">
              <span class="dt-vis" :class="`dt-vis--${dash.visibility}`"><span class="scope-dot" :class="`scope-dot--${dash.visibility}`"></span>{{ visibilityLabel(dash.visibility) }}</span>
            </td>
            <td class="dt-col-tags">
              <span v-for="tag in (dash.tags || []).slice(0, 4)" :key="tag" class="tag-pill">{{ tag }}</span>
            </td>
            <td class="dt-col-updated" :title="formatDate(dash.updated_at)">
              <strong>{{ relativeDate(dash.updated_at) }}</strong>
              <span class="mono text-muted">{{ formatDate(dash.updated_at) }}</span>
            </td>
            <td class="dt-col-actions">
              <button class="dash-action-btn" title="Export dashboard" aria-label="Export dashboard" @click.stop="exportDash(dash.id)">Export</button>
              <button v-if="canWrite" class="dash-delete" title="Delete dashboard" aria-label="Delete dashboard" @click.stop="pendingDelete = dash">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="dashboards.length" class="no-results">
      <div class="no-results-mark">0</div>
      <div>
        <strong>No dashboards match</strong>
        <p>Try a different search or visibility filter.</p>
      </div>
      <button class="btn-secondary" @click="searchQuery = ''; scopeFilter = 'all'">Clear filters</button>
    </div>

    <div v-if="pendingDelete" class="modal-overlay" @click.self="pendingDelete = null">
      <div class="modal confirm-modal card" role="alertdialog" aria-modal="true" aria-labelledby="delete-dashboard-title">
        <div class="confirm-symbol">!</div>
        <div>
          <div class="modal-kicker">DESTRUCTIVE ACTION</div>
          <h2 id="delete-dashboard-title">Delete “{{ pendingDelete.name }}”?</h2>
          <p>This removes the dashboard and its widgets. Export it first if you may need it later.</p>
        </div>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="pendingDelete = null">Keep dashboard</button>
          <button class="btn-danger" @click="remove(pendingDelete.id)">Delete permanently</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/DashboardsListView.css"></style>
