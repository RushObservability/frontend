<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { Dashboard, DashboardTemplate, DashboardExport } from '../types'

const router = useRouter()
const api = useApi()
const { canWrite } = useAuth()

const dashboards = ref<Dashboard[]>([])
const showCreate = ref(false)
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

onMounted(loadDashboards)

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
  const rows = [...dashboards.value]
  const k = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => dir * String(a[k] ?? '').localeCompare(String(b[k] ?? '')))
  return rows
})
function setSort(k: DashSortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = k === 'name' ? 'asc' : 'desc' }
}
function sortInd(k: DashSortKey): string {
  if (sortKey.value !== k) return ''
  return sortDir.value === 'asc' ? ' ▲' : ' ▼'
}

function visibilityIcon(v: string): string {
  if (v === 'private') return '\u{1F512}'
  if (v === 'global') return '\u{1F310}'
  return '\u{1F465}'
}

function visibilityLabel(v: string): string {
  if (v === 'private') return 'Private'
  if (v === 'global') return 'Global'
  return 'Team'
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
    <div class="page-header">
      <h1 class="page-title">Dashboards</h1>
      <div class="header-actions" v-if="canWrite">
        <button class="btn-secondary" @click="openImport">Import</button>
        <button class="btn-secondary" @click="openTemplates">+ From Template</button>
        <button class="btn-create" @click="showCreate = !showCreate">+ New Dashboard</button>
      </div>
    </div>

    <!-- Create form -->
    <div v-if="showCreate" class="create-form card fade-in">
      <div class="form-row">
        <input
          v-model="newName"
          class="form-input mono"
          placeholder="Dashboard name"
          @keyup.enter="create"
        />
        <input
          v-model="newDescription"
          class="form-input"
          placeholder="Description (optional)"
          @keyup.enter="create"
        />
        <select v-model="newVisibility" class="form-input" style="flex: 0 0 120px">
          <option value="private">Private</option>
          <option value="tenant">Team</option>
          <option value="global">Global</option>
        </select>
        <button class="btn-save" @click="create">Create</button>
      </div>
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

    <div v-else class="dashboard-table-wrap card">
      <table class="dashboard-table">
        <thead>
          <tr>
            <th class="dt-col-name sortable" @click="setSort('name')">Name<span class="dt-sort">{{ sortInd('name') }}</span></th>
            <th class="dt-col-vis sortable" @click="setSort('visibility')">Visibility<span class="dt-sort">{{ sortInd('visibility') }}</span></th>
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
            @click="router.push(`/dashboards/${dash.id}`)"
          >
            <td class="dt-col-name">
              <div class="dt-name">{{ dash.name }}</div>
              <div v-if="dash.description" class="dt-desc text-muted">{{ dash.description }}</div>
            </td>
            <td class="dt-col-vis">
              <span class="dt-vis" :title="visibilityLabel(dash.visibility)">{{ visibilityIcon(dash.visibility) }} {{ visibilityLabel(dash.visibility) }}</span>
            </td>
            <td class="dt-col-tags">
              <span v-for="tag in (dash.tags || []).slice(0, 4)" :key="tag" class="tag-pill">{{ tag }}</span>
            </td>
            <td class="dt-col-updated mono text-muted">{{ formatDate(dash.updated_at) }}</td>
            <td class="dt-col-actions">
              <button class="dash-action-btn" title="Export" @click.stop="exportDash(dash.id)">&#8615;</button>
              <button v-if="canWrite" class="dash-delete" title="Delete" @click.stop="remove(dash.id)">&times;</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped src="../styles/views/DashboardsListView.css"></style>
