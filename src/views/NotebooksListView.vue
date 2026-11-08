<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import { formatClock, fromLocalInput, incidentWindow, toLocalInput } from '../lib/notebookTime'
import type { Notebook } from '../types'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const api = useApi()
const { canWrite } = useAuth()

const notebooks = ref<Notebook[]>([])
const loaded = ref(false)
const loadError = ref(false)
const query = ref('')
const statusFilter = ref<'all' | Notebook['status']>('all')

const showCreate = ref(false)
const newName = ref('')
const newStart = ref('')
const newVisibility = ref<Notebook['visibility']>('tenant')
const createError = ref('')
const creating = ref(false)

onMounted(async () => {
  try {
    notebooks.value = (await api.listNotebooks()).notebooks
  } catch {
    loadError.value = true
  } finally {
    loaded.value = true
  }
})

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return notebooks.value.filter(nb =>
    (statusFilter.value === 'all' || nb.status === statusFilter.value)
    && (!q || [nb.name, nb.description, nb.owner_name, ...nb.tags].some(v => v.toLowerCase().includes(q))))
})

const counts = computed(() => ({
  all: notebooks.value.length,
  open: notebooks.value.filter(nb => nb.status === 'open').length,
  resolved: notebooks.value.filter(nb => nb.status === 'resolved').length,
}))

function openCreate() {
  newName.value = ''
  newStart.value = toLocalInput(new Date().toISOString())
  newVisibility.value = 'tenant'
  createError.value = ''
  showCreate.value = true
}

async function create() {
  const name = newName.value.trim()
  const start = fromLocalInput(newStart.value)
  if (!name) { createError.value = 'Name the incident.'; return }
  if (!start) { createError.value = 'Pick when the incident started.'; return }
  creating.value = true
  try {
    const nb = await api.createNotebook({ name, incident_start: start, visibility: newVisibility.value })
    void router.push(`/notebooks/${encodeURIComponent(nb.id)}`)
  } catch {
    createError.value = 'Couldn\'t create the notebook. Try again.'
  } finally {
    creating.value = false
  }
}

function windowLabel(nb: Notebook): string {
  const w = incidentWindow(nb, new Date())
  const minutes = Math.round((w.to.getTime() - w.from.getTime()) / 60_000)
  const span = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  return `${formatClock(nb.incident_start, true)} → ${nb.incident_end ? formatClock(nb.incident_end, true) : 'now'} · ${span}`
}
</script>

<template>
  <div class="nb-page">
    <div class="nb-list-heading">
      <div>
        <h1 class="nb-page-title">Notebooks</h1>
        <p class="nb-page-intro">Incident records: notes, log and trace searches, and panels, each with its own time range.</p>
      </div>
      <button v-if="canWrite" type="button" class="nb-btn nb-btn--primary" @click="openCreate">+ New notebook</button>
    </div>

    <div v-if="notebooks.length" class="nb-list-controls">
      <input v-model="query" type="search" class="nb-search-input" placeholder="Search names, owners, or tags" aria-label="Search notebooks" />
      <div class="nb-filters" role="group" aria-label="Filter by status">
        <button
          v-for="status in (['all', 'open', 'resolved'] as const)"
          :key="status"
          type="button"
          :class="{ active: statusFilter === status }"
          @click="statusFilter = status"
        >
          {{ status === 'all' ? 'All' : status === 'open' ? 'Open' : 'Resolved' }} <span class="mono">{{ counts[status] }}</span>
        </button>
      </div>
    </div>

    <EmptyState v-if="loadError" tone="error" title="Couldn't load notebooks" description="Refresh the page to try again." />
    <EmptyState v-else-if="!loaded" tone="loading" title="Loading notebooks" />
    <EmptyState
      v-else-if="!notebooks.length"
      icon="▤"
      title="Start your first incident notebook"
      description="Keep the notes, searches, and charts from an incident in one place, each pinned to the time that matters."
    />
    <ul v-else class="nb-list">
      <li v-for="nb in shown" :key="nb.id">
        <router-link :to="`/notebooks/${encodeURIComponent(nb.id)}`" class="nb-list-row">
          <span class="nb-status" :class="`nb-status--${nb.status}`">{{ nb.status === 'open' ? 'Open' : 'Resolved' }}</span>
          <span class="nb-list-name">{{ nb.name }}</span>
          <span class="nb-list-window mono">{{ windowLabel(nb) }}</span>
          <span class="nb-list-owner">{{ nb.owner_name }}{{ nb.visibility === 'private' ? ' · private' : '' }}</span>
        </router-link>
      </li>
      <li v-if="!shown.length" class="nb-muted">No notebooks match.</li>
    </ul>

    <div v-if="showCreate" class="nb-modal-overlay" @click.self="showCreate = false">
      <form class="nb-modal" role="dialog" aria-modal="true" aria-labelledby="nb-create-title" @submit.prevent="create" @keydown.esc="showCreate = false">
        <h2 id="nb-create-title">New notebook</h2>
        <label>Name
          <input v-model="newName" maxlength="255" placeholder="INC-482 checkout 5xx spike" autofocus @input="createError = ''" />
        </label>
        <label>Incident started
          <input v-model="newStart" type="datetime-local" required @input="createError = ''" />
        </label>
        <fieldset class="nb-visibility">
          <legend>Who can see it?</legend>
          <label><input v-model="newVisibility" type="radio" value="tenant" /> Team</label>
          <label><input v-model="newVisibility" type="radio" value="private" /> Only me</label>
        </fieldset>
        <p v-if="createError" class="nb-error" role="alert">{{ createError }}</p>
        <div class="nb-modal-actions">
          <button type="button" class="nb-btn" @click="showCreate = false">Cancel</button>
          <button type="submit" class="nb-btn nb-btn--primary" :disabled="creating">Create notebook</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped src="../styles/views/NotebookView.css"></style>
