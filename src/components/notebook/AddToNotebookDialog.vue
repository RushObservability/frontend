<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'
import { formatRange } from '../../lib/notebookTime'
import type { Notebook, NotebookCellDraft } from '../../types'

const props = defineProps<{ draft: NotebookCellDraft | null }>()
const emit = defineEmits<{ close: [] }>()

const NEW = '__new__'
const TYPE_LABELS = { note: 'note', logs: 'log search', spans: 'trace search', panel: 'panel', promql: 'PromQL' } as const

const api = useApi()
const notebooks = ref<Notebook[]>([])
const loading = ref(false)
const target = ref(NEW)
const newName = ref('')
const error = ref('')
const saving = ref(false)
const added = ref<Notebook | null>(null)

const summary = computed(() => props.draft
  ? `Adds a ${TYPE_LABELS[props.draft.cell_type]} cell pinned to ${formatRange(props.draft)}.`
  : '')

watch(() => props.draft, async draft => {
  if (!draft) return
  added.value = null
  error.value = ''
  newName.value = ''
  loading.value = true
  try {
    notebooks.value = (await api.listNotebooks()).notebooks.filter(nb => nb.status === 'open')
  } catch {
    notebooks.value = []
    error.value = 'Couldn\'t load your notebooks. You can still start a new one.'
  } finally {
    loading.value = false
  }
  target.value = notebooks.value[0]?.id ?? NEW
}, { immediate: true })

async function add() {
  const draft = props.draft
  if (!draft) return
  error.value = ''
  let notebook = notebooks.value.find(nb => nb.id === target.value)
  if (!notebook && !newName.value.trim()) { error.value = 'Name the incident.'; return }
  saving.value = true
  try {
    if (!notebook) {
      // A view that ends now is looking at an incident that is still going on.
      const ongoing = Date.now() - Date.parse(draft.to) < 2 * 60_000
      notebook = await api.createNotebook({ name: newName.value.trim(), incident_start: draft.from, incident_end: ongoing ? '' : draft.to })
      // Keep it selected, so a retry after a failed cell write doesn't create a second notebook.
      notebooks.value.unshift(notebook)
      target.value = notebook.id
    }
    await api.createNotebookCell(notebook.id, {
      cell_type: draft.cell_type,
      title: draft.title,
      query_config: draft.query_config,
      display_config: draft.display_config ?? {},
      time: { mode: 'absolute', from: draft.from, to: draft.to },
    })
    added.value = notebook
  } catch {
    error.value = 'Couldn\'t add it to the notebook. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
  <div v-if="draft" class="nb-modal-overlay" @click.self="emit('close')">
    <form class="nb-modal" role="dialog" aria-modal="true" aria-labelledby="nb-add-title" @submit.prevent="add" @keydown.esc="emit('close')">
      <h2 id="nb-add-title">Add to notebook</h2>
      <template v-if="added">
        <p role="status">Added to <strong>{{ added.name }}</strong>.</p>
        <div class="nb-modal-actions">
          <button type="button" class="nb-btn" @click="emit('close')">Close</button>
          <router-link :to="`/notebooks/${encodeURIComponent(added.id)}`" class="nb-btn nb-btn--primary">Open notebook</router-link>
        </div>
      </template>
      <template v-else>
        <p class="nb-muted">{{ summary }}</p>
        <label>Notebook
          <select v-model="target" :disabled="loading" @change="error = ''">
            <option v-for="nb in notebooks" :key="nb.id" :value="nb.id">{{ nb.name }}</option>
            <option :value="NEW">New notebook…</option>
          </select>
        </label>
        <label v-if="target === NEW">Name
          <input v-model="newName" maxlength="255" placeholder="INC-482 checkout 5xx spike" @input="error = ''" />
        </label>
        <p v-if="target === NEW" class="nb-muted">The incident window starts at this view's start time.</p>
        <p v-if="error" class="nb-error" role="alert">{{ error }}</p>
        <div class="nb-modal-actions">
          <button type="button" class="nb-btn" @click="emit('close')">Cancel</button>
          <button type="submit" class="nb-btn nb-btn--primary" :disabled="saving || loading">{{ saving ? 'Adding…' : 'Add' }}</button>
        </div>
      </template>
    </form>
  </div>
  </Teleport>
</template>

<style scoped src="../../styles/views/NotebookView.css"></style>
