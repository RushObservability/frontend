<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import { usePollingTask } from '../composables/usePollingTask'
import { createLimiter, formatClock, fromLocalInput, incidentWindow, toLocalInput } from '../lib/notebookTime'
import type { Notebook, NotebookCell, NotebookCellType } from '../types'
import NotebookCellCard from '../components/notebook/NotebookCellCard.vue'
import EmptyState from '../components/EmptyState.vue'

const props = defineProps<{ id: string }>()

const router = useRouter()
const api = useApi()
const { canWrite, isAdmin, user } = useAuth()

const notebook = ref<Notebook | null>(null)
const cells = ref<NotebookCell[]>([])
const loadError = ref<string | null>(null)
const conflict = ref(false)
const saveError = ref<string | null>(null)
const now = ref(new Date())
const run = createLimiter(4)

const ADD_TYPES: Array<{ type: NotebookCellType; label: string }> = [
  { type: 'note', label: 'Note' },
  { type: 'logs', label: 'Logs' },
  { type: 'spans', label: 'Traces' },
  { type: 'panel', label: 'Panel' },
]

async function load() {
  loadError.value = null
  conflict.value = false
  try {
    const res = await api.getNotebook(props.id)
    const { cells: loaded, ...nb } = res
    notebook.value = nb
    cells.value = loaded
    now.value = new Date()
    syncHeader()
  } catch (e) {
    loadError.value = (e as { status?: number })?.status === 404 ? 'This notebook doesn\'t exist or isn\'t shared with you.' : 'Couldn\'t load this notebook.'
  }
}

onMounted(load)
watch(() => props.id, load)

function handleSaveError(e: unknown) {
  if ((e as { status?: number })?.status === 409) conflict.value = true
  else saveError.value = 'Couldn\'t save that change. Try again.'
}

// ── Header: name, status, incident window ──
const nameDraft = ref('')
const startDraft = ref('')
const endDraft = ref('')
const ongoing = ref(true)
const windowError = ref('')

function syncHeader() {
  const nb = notebook.value
  if (!nb) return
  nameDraft.value = nb.name
  startDraft.value = toLocalInput(nb.incident_start)
  endDraft.value = nb.incident_end ? toLocalInput(nb.incident_end) : ''
  ongoing.value = !nb.incident_end
  windowError.value = ''
}

async function saveNotebook(patch: Partial<Pick<Notebook, 'name' | 'status' | 'incident_start' | 'incident_end'>>) {
  const nb = notebook.value
  if (!nb) return
  saveError.value = null
  try {
    notebook.value = await api.updateNotebook(nb.id, { ...patch, updated_at: nb.updated_at })
    syncHeader()
  } catch (e) {
    handleSaveError(e)
  }
}

function saveName() {
  const name = nameDraft.value.trim()
  if (!name) { nameDraft.value = notebook.value?.name || ''; return }
  if (name !== notebook.value?.name) void saveNotebook({ name })
}

function saveWindow() {
  const start = fromLocalInput(startDraft.value)
  const end = ongoing.value ? '' : fromLocalInput(endDraft.value)
  if (!start) { windowError.value = 'Pick when the incident started.'; return }
  if (!ongoing.value && (!end || end <= start)) { windowError.value = 'The end must be after the start.'; return }
  windowError.value = ''
  if (start !== notebook.value?.incident_start || end !== notebook.value?.incident_end) {
    void saveNotebook({ incident_start: start, incident_end: end })
  }
}

function toggleOngoing() {
  if (!ongoing.value && !endDraft.value) endDraft.value = toLocalInput(new Date().toISOString())
  saveWindow()
}

function toggleStatus() {
  const nb = notebook.value
  if (!nb) return
  if (nb.status === 'open') {
    // Resolving an ongoing incident closes its window now.
    void saveNotebook(nb.incident_end ? { status: 'resolved' } : { status: 'resolved', incident_end: new Date().toISOString() })
  } else {
    void saveNotebook({ status: 'open' })
  }
}

const duration = computed(() => {
  if (!notebook.value) return ''
  const w = incidentWindow(notebook.value, now.value)
  const minutes = Math.round((w.to.getTime() - w.from.getTime()) / 60_000)
  const h = Math.floor(minutes / 60)
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`
})

const canDelete = computed(() => Boolean(notebook.value && canWrite.value && (isAdmin.value || notebook.value.owner_id === user.value?.id)))

async function deleteNotebook() {
  const nb = notebook.value
  if (!nb || !window.confirm(`Delete "${nb.name}" and all its cells? This can't be undone.`)) return
  try {
    await api.deleteNotebook(nb.id)
    void router.push('/notebooks')
  } catch {
    saveError.value = 'Couldn\'t delete this notebook.'
  }
}

// ── Refresh ──
const needsPolling = computed(() => Boolean(notebook.value && (!notebook.value.incident_end || cells.value.some(c => c.time.mode === 'live'))))
const poller = usePollingTask({ category: 'notebook', intervalMs: 60_000, run: () => { now.value = new Date() } })
watch(needsPolling, active => (active ? poller.start() : poller.stop()), { immediate: true })

// ── Cells ──
// Saves to one cell run one after another, so each carries the updated_at
// returned by the previous save instead of conflicting with it.
const saveChains = new Map<string, Promise<void>>()

function updateCell(cellId: string, patch: Partial<Pick<NotebookCell, 'title' | 'body' | 'query_config' | 'time' | 'display_config'>>) {
  const previous = saveChains.get(cellId) ?? Promise.resolve()
  const next = previous.then(async () => {
    const current = cells.value.find(c => c.id === cellId)
    if (!current || !notebook.value) return
    saveError.value = null
    try {
      const saved = await api.updateNotebookCell(notebook.value.id, cellId, { ...patch, updated_at: current.updated_at })
      cells.value = cells.value.map(c => (c.id === cellId ? saved : c))
    } catch (e) {
      handleSaveError(e)
    }
  })
  saveChains.set(cellId, next)
}

function defaultsFor(type: NotebookCellType): Partial<NotebookCell> {
  if (type === 'logs' || type === 'spans') return { query_config: { search: '' } }
  return {}
}

/** A position between the neighbours at `index`, or null when there's no gap left. */
function positionAt(index: number): number | null {
  const before = cells.value[index - 1]?.position ?? 0
  const after = cells.value[index]?.position
  if (after === undefined) return before + 1000
  return after - before > 1 ? Math.floor((before + after) / 2) : null
}

async function insertCell(index: number, type: NotebookCellType, from?: NotebookCell) {
  const nb = notebook.value
  if (!nb) return
  saveError.value = null
  const position = positionAt(index)
  try {
    const created = await api.createNotebookCell(nb.id, {
      cell_type: type,
      ...(from
        ? { title: from.title, body: from.body, query_config: from.query_config, time: from.time, display_config: from.display_config }
        : defaultsFor(type)),
      ...(position === null ? {} : { position }),
    })
    if (position === null) {
      // No room between the neighbours: append, then renumber everything.
      const ids = cells.value.map(c => c.id)
      ids.splice(index, 0, created.id)
      cells.value = (await api.reorderNotebookCells(nb.id, ids)).cells
    } else {
      cells.value = [...cells.value.slice(0, index), created, ...cells.value.slice(index)]
    }
  } catch (e) {
    handleSaveError(e)
  }
}

async function moveCell(index: number, direction: -1 | 1) {
  const nb = notebook.value
  const target = index + direction
  if (!nb || target < 0 || target >= cells.value.length) return
  const ids = cells.value.map(c => c.id)
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  try {
    cells.value = (await api.reorderNotebookCells(nb.id, ids)).cells
  } catch (e) {
    handleSaveError(e)
  }
}

async function removeCell(cell: NotebookCell) {
  const nb = notebook.value
  if (!nb) return
  if ((cell.body || cell.cell_type !== 'note') && !window.confirm('Delete this cell?')) return
  try {
    await api.deleteNotebookCell(nb.id, cell.id)
    cells.value = cells.value.filter(c => c.id !== cell.id)
  } catch (e) {
    handleSaveError(e)
  }
}
</script>

<template>
  <div class="nb-page">
    <router-link to="/notebooks" class="nb-back">← Notebooks</router-link>

    <EmptyState v-if="loadError" tone="error" title="Notebook unavailable" :description="loadError" />
    <EmptyState v-else-if="!notebook" tone="loading" title="Loading notebook" />

    <template v-else>
      <header class="nb-header">
        <div class="nb-header-main">
          <input
            v-model="nameDraft"
            class="nb-name"
            :readonly="!canWrite"
            maxlength="255"
            aria-label="Notebook name"
            @blur="saveName"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <div class="nb-meta mono">
            <span class="nb-status" :class="`nb-status--${notebook.status}`">{{ notebook.status === 'open' ? 'Open' : 'Resolved' }}</span>
            <span>{{ notebook.owner_name }}</span>
            <span>{{ notebook.visibility === 'private' ? 'Private' : 'Team' }}</span>
          </div>
        </div>
        <div class="nb-header-actions">
          <button type="button" class="nb-btn" title="Re-run every cell" @click="now = new Date()">Refresh</button>
          <button v-if="canWrite" type="button" class="nb-btn" @click="toggleStatus">{{ notebook.status === 'open' ? 'Mark resolved' : 'Reopen' }}</button>
          <button v-if="canDelete" type="button" class="nb-btn nb-btn--danger" @click="deleteNotebook">Delete</button>
        </div>
      </header>

      <section class="nb-window" aria-label="Incident window">
        <span class="nb-window-label">Incident window</span>
        <label>Start <input v-model="startDraft" type="datetime-local" :readonly="!canWrite" @change="saveWindow" /></label>
        <label v-if="!ongoing">End <input v-model="endDraft" type="datetime-local" :readonly="!canWrite" @change="saveWindow" /></label>
        <label class="nb-ongoing"><input v-model="ongoing" type="checkbox" :disabled="!canWrite" @change="toggleOngoing" /> Ongoing</label>
        <span class="nb-window-span mono">
          {{ formatClock(notebook.incident_start, true) }} → {{ notebook.incident_end ? formatClock(notebook.incident_end, true) : 'now' }} · {{ duration }}
        </span>
        <p v-if="windowError" class="nb-error" role="alert">{{ windowError }}</p>
      </section>

      <div v-if="conflict" class="nb-banner" role="alert">
        Someone else changed this notebook since you opened it. Your last change wasn't saved.
        <button type="button" class="nb-btn" @click="load">Reload</button>
      </div>
      <div v-else-if="saveError" class="nb-banner" role="alert">{{ saveError }}</div>

      <div class="nb-cells">
        <template v-for="(cell, index) in cells" :key="cell.id">
          <div v-if="canWrite" class="nb-insert" :aria-label="`Add a cell before cell ${index + 1}`" role="group">
            <button v-for="option in ADD_TYPES" :key="option.type" type="button" class="nb-insert-btn" @click="insertCell(index, option.type)">+ {{ option.label }}</button>
          </div>
          <NotebookCellCard
            :cell="cell"
            :notebook="notebook"
            :now="now"
            :can-write="canWrite"
            :is-first="index === 0"
            :is-last="index === cells.length - 1"
            :run="run"
            @update="patch => updateCell(cell.id, patch)"
            @move="direction => moveCell(index, direction)"
            @duplicate="insertCell(index + 1, cell.cell_type, cell)"
            @remove="removeCell(cell)"
          />
        </template>

        <EmptyState
          v-if="!cells.length"
          compact
          icon="▤"
          title="Start the incident record"
          :description="canWrite ? 'Add a note about what you saw, or a log search, trace search, or panel. Each one keeps its own time range.' : 'Nothing has been added to this notebook yet.'"
        />
        <div v-if="canWrite" class="nb-add" role="group" aria-label="Add a cell at the end">
          <span class="nb-add-label">Add</span>
          <button v-for="option in ADD_TYPES" :key="option.type" type="button" class="nb-btn" @click="insertCell(cells.length, option.type)">+ {{ option.label }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/views/NotebookView.css"></style>
