<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { SavedQuery, QueryFilter } from '../types'
import { useSavedQueries, type SavedQueryDraft } from '../composables/useSavedQueries'
import { useTenant } from '../composables/useTenant'
import DetailDrawer from './DetailDrawer.vue'
import SaveQueryForm, { type SaveQueryForm as SaveQueryFormValue } from './SaveQueryForm.vue'

const props = defineProps<{
  currentFilters: QueryFilter[]
  currentGroupBy: string
  currentTimePreset: number
  currentSearch?: string
  currentViewMode?: 'spans' | 'logs'
}>()

const emit = defineEmits<{
  load: [query: SavedQuery]
}>()

const { queries, groups, error, serverMode, canShare, save, update, remove, groupName, isOwner, canModify } = useSavedQueries()
const { activeTenant } = useTenant()

// One drawer with two views: the saved query list, and the save/edit form.
const drawerOpen = ref(false)
const view = ref<'list' | 'form'>('list')
// Whether the form was reached from the list, so Back and Save return there.
const formFromList = ref(false)
const editing = ref<SavedQuery | null>(null)
const formKey = ref(0)
const saving = ref(false)
const formError = ref('')
const filterText = ref('')
const confirmingDelete = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const justSaved = ref(false)
const listEl = ref<HTMLElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null

const current = computed<SavedQueryDraft>(() => ({
  name: '',
  filters: props.currentFilters,
  groupBy: props.currentGroupBy,
  timePreset: props.currentTimePreset,
  search: props.currentSearch || undefined,
  viewMode: props.currentViewMode,
}))

const drawerLabel = computed(() => view.value === 'list' ? 'Saved queries' : editing.value ? 'Edit saved query' : 'Save query')

const filtered = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return queries.value
  return queries.value.filter(q =>
    q.name.toLowerCase().includes(needle)
    || (q.description ?? '').toLowerCase().includes(needle)
    || (q.ownerName ?? '').toLowerCase().includes(needle))
})

const sections = computed(() => {
  if (!serverMode.value) return [{ key: 'local', title: 'Saved in this browser', items: filtered.value }].filter(s => s.items.length)
  return [
    { key: 'tenant', title: `Everyone in ${activeTenant.value}`, items: filtered.value.filter(q => q.visibility === 'tenant') },
    { key: 'group', title: 'Shared with my groups', items: filtered.value.filter(q => q.visibility === 'group') },
    { key: 'mine', title: 'Only me', items: filtered.value.filter(q => q.visibility === 'private') },
  ].filter(s => s.items.length)
})

function showForm(query: SavedQuery | null, fromList: boolean) {
  editing.value = query
  formError.value = ''
  formFromList.value = fromList
  formKey.value++
  view.value = 'form'
  drawerOpen.value = true
}

/** Open straight on the save form for the query on screen. */
function openSave() {
  showForm(null, false)
}

/** Open on the saved query list. */
function openList() {
  confirmingDelete.value = null
  view.value = 'list'
  drawerOpen.value = true
}

function backToList() {
  view.value = 'list'
  nextTick(() => listEl.value?.focus())
}

function closeDrawer() {
  if (saving.value) return
  drawerOpen.value = false
}

async function handleSubmit(form: SaveQueryFormValue) {
  saving.value = true
  formError.value = ''
  const changes = { name: form.name, description: form.description, visibility: form.visibility, groupId: form.groupId }
  const ok = editing.value
    ? await update(editing.value.id, changes)
    : await save({ ...current.value, ...changes })
  saving.value = false
  if (!ok) {
    // A failed request sets `error`; otherwise the query was refused locally
    // because it looked like it contained a credential.
    formError.value = error.value || 'This query looks like it contains a credential, so it was not saved.'
    return
  }
  if (formFromList.value) {
    backToList()
  } else {
    drawerOpen.value = false
    justSaved.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { justSaved.value = false }, 1800)
  }
}

function handleLoad(query: SavedQuery) {
  emit('load', query)
  drawerOpen.value = false
}

async function confirmDelete(id: string) {
  confirmingDelete.value = null
  await remove(id)
}

async function copyLink(q: SavedQuery) {
  const url = `${window.location.origin}/?saved=${encodeURIComponent(q.id)}`
  try {
    await navigator.clipboard.writeText(url)
    copiedId.value = q.id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedId.value = null }, 1600)
  } catch { /* clipboard unavailable */ }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

defineExpose({ openSave, openList })
</script>

<template>
  <div class="sq">
    <button type="button" class="sq-button" :class="{ 'sq-button-done': justSaved }" title="Save the current query (s)" @click="openSave">
      <span aria-hidden="true">{{ justSaved ? '✓' : '☆' }}</span>{{ justSaved ? 'Saved' : 'Save' }}
    </button>
    <button type="button" class="sq-button" :aria-expanded="drawerOpen && view === 'list'" @click="openList">
      <span aria-hidden="true">&#9733;</span>Saved
      <span v-if="queries.length" class="sq-count mono">{{ queries.length }}</span>
    </button>

    <DetailDrawer :open="drawerOpen" :label="drawerLabel" size="medium" @close="closeDrawer">
      <div class="sq-drawer">
        <header class="sq-heading">
          <div class="sq-heading-title">
            <button
              v-if="view === 'form' && formFromList"
              type="button"
              class="sq-icon-btn"
              aria-label="Back to saved queries"
              :disabled="saving"
              @click="backToList"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <h2>{{ drawerLabel }}</h2>
          </div>
          <button type="button" class="sq-icon-btn" aria-label="Close" :disabled="saving" @click="closeDrawer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <SaveQueryForm
          v-if="view === 'form'"
          :key="formKey"
          :editing="editing"
          :current="current"
          :tenant="activeTenant"
          :groups="groups"
          :server-mode="serverMode"
          :can-share="canShare"
          :can-change-visibility="!editing || isOwner(editing)"
          :saving="saving"
          :error="formError"
          @cancel="formFromList ? backToList() : closeDrawer()"
          @submit="handleSubmit"
        />

        <div v-else ref="listEl" class="sq-list-view" tabindex="-1">
          <div class="sq-list-toolbar">
            <input
              v-model="filterText"
              type="search"
              class="sq-filter"
              placeholder="Filter by name, description or owner"
              aria-label="Filter saved queries"
            >
            <button type="button" class="sq-btn sq-btn-primary" @click="showForm(null, true)">Save current query</button>
          </div>
          <p v-if="error" class="sq-error" role="alert">{{ error }}</p>

          <div v-if="!queries.length" class="sq-empty">
            <p>No saved queries yet.</p>
            <p class="text-muted">Save the query you're looking at so you and your team can come back to it.</p>
          </div>
          <p v-else-if="!sections.length" class="sq-empty text-muted">No saved queries match “{{ filterText }}”.</p>

          <section v-for="section in sections" :key="section.key" class="sq-section">
            <h3>{{ section.title }} <span class="text-muted">{{ section.items.length }}</span></h3>
            <ul>
              <li v-for="q in section.items" :key="q.id" class="sq-item">
                <button type="button" class="sq-item-main" :aria-label="`Run ${q.name}`" @click="handleLoad(q)">
                  <span class="sq-item-name">
                    <span
                      v-if="q.viewMode"
                      class="sq-kind"
                      :class="q.viewMode === 'logs' ? 'sq-kind-logs' : 'sq-kind-apm'"
                    >{{ q.viewMode === 'logs' ? 'Logs' : 'APM' }}</span>
                    {{ q.name }}
                    <span v-if="q.visibility === 'group'" class="sq-badge">{{ groupName(q.groupId) }}</span>
                  </span>
                  <span v-if="q.description" class="sq-item-desc">{{ q.description }}</span>
                  <span class="sq-item-meta mono">
                    {{ q.filters.length }} filter{{ q.filters.length !== 1 ? 's' : '' }}<template v-if="q.search"> &middot; search</template><template v-if="q.groupBy"> &middot; by {{ q.groupBy }}</template>
                    <template v-if="q.visibility && q.visibility !== 'private' && !isOwner(q) && q.ownerName"> &middot; {{ q.ownerName }}</template>
                    &middot; {{ formatDate(q.createdAt) }}
                  </span>
                </button>
                <div v-if="confirmingDelete === q.id" class="sq-confirm" role="alert">
                  Delete?
                  <button type="button" class="sq-btn" @click="confirmingDelete = null">Cancel</button>
                  <button type="button" class="sq-btn sq-danger" @click="confirmDelete(q.id)">Delete</button>
                </div>
                <div v-else class="sq-item-actions">
                  <span v-if="copiedId === q.id" class="sq-copied" role="status">Copied</span>
                  <button v-if="q.visibility" type="button" class="sq-icon-btn" title="Copy link" :aria-label="`Copy link to ${q.name}`" @click="copyLink(q)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
                  </button>
                  <button v-if="canModify(q)" type="button" class="sq-icon-btn" title="Edit title, description and sharing" :aria-label="`Edit ${q.name}`" @click="showForm(q, true)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <button v-if="canModify(q)" type="button" class="sq-icon-btn sq-icon-danger" title="Delete" :aria-label="`Delete ${q.name}`" @click="confirmingDelete = q.id">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </DetailDrawer>
  </div>
</template>

<style scoped src="../styles/components/SavedQueries.css"></style>
