<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SavedQuery, QueryFilter } from '../types'
import { useSavedQueries, type SavedQueryDraft } from '../composables/useSavedQueries'
import { useTenant } from '../composables/useTenant'
import SaveQueryDrawer, { type SaveQueryForm } from './SaveQueryDrawer.vue'

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
const open = ref(false)
const drawerOpen = ref(false)
const editing = ref<SavedQuery | null>(null)
const saving = ref(false)
const drawerError = ref('')
const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const current = computed<SavedQueryDraft>(() => ({
  name: '',
  filters: props.currentFilters,
  groupBy: props.currentGroupBy,
  timePreset: props.currentTimePreset,
  search: props.currentSearch || undefined,
  viewMode: props.currentViewMode,
}))

const sections = computed(() => {
  if (!serverMode.value) return [{ key: 'local', title: '', items: queries.value }].filter(s => s.items.length)
  return [
    { key: 'tenant', title: 'Everyone in tenant', items: queries.value.filter(q => q.visibility === 'tenant') },
    { key: 'group', title: 'Shared with groups', items: queries.value.filter(q => q.visibility === 'group') },
    { key: 'mine', title: 'Only me', items: queries.value.filter(q => q.visibility === 'private') },
  ].filter(s => s.items.length)
})

function openDrawer(query: SavedQuery | null) {
  editing.value = query
  drawerError.value = ''
  drawerOpen.value = true
  open.value = false
}

async function handleSubmit(form: SaveQueryForm) {
  saving.value = true
  drawerError.value = ''
  const changes = { name: form.name, description: form.description, visibility: form.visibility, groupId: form.groupId }
  const ok = editing.value
    ? await update(editing.value.id, changes)
    : await save({ ...current.value, ...changes })
  saving.value = false
  if (!ok) {
    // A failed request sets `error`; otherwise the query was refused locally
    // because it looked like it contained a credential.
    drawerError.value = error.value || 'This query looks like it contains a credential, so it was not saved.'
    return
  }
  drawerOpen.value = false
}

function handleLoad(query: SavedQuery) {
  emit('load', query)
  open.value = false
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

function audience(q: SavedQuery): string {
  if (q.visibility === 'group') return groupName(q.groupId)
  return ''
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="sq">
    <button class="sq-trigger" :aria-expanded="open" @click="open = !open">
      <span>&#9733;</span> Saved
      <span v-if="queries.length" class="sq-count mono">{{ queries.length }}</span>
    </button>

    <div v-if="open" class="sq-dropdown">
      <button type="button" class="sq-save-btn" @click="openDrawer(null)">
        + Save current query
      </button>
      <div v-if="error && !drawerOpen" class="sq-error" role="alert">{{ error }}</div>

      <template v-for="section in sections" :key="section.key">
        <div class="sq-divider" />
        <div v-if="section.title" class="sq-section text-muted">{{ section.title }}</div>
        <div class="sq-list">
          <div
            v-for="q in section.items"
            :key="q.id"
            class="sq-item"
            role="button"
            tabindex="0"
            :title="q.description || undefined"
            @click="handleLoad(q)"
            @keydown.enter="handleLoad(q)"
          >
            <div class="sq-item-name">
              {{ q.name }}
              <span v-if="audience(q)" class="sq-badge">{{ audience(q) }}</span>
            </div>
            <div v-if="q.description" class="sq-item-desc text-muted">{{ q.description }}</div>
            <div class="sq-item-meta text-muted mono">
              {{ q.filters.length }} filter{{ q.filters.length !== 1 ? 's' : '' }}
              <span v-if="q.groupBy"> &middot; {{ q.groupBy }}</span>
              <span v-if="q.visibility && q.visibility !== 'private' && !isOwner(q) && q.ownerName"> &middot; by {{ q.ownerName }}</span>
              <span v-if="!q.visibility || q.visibility === 'private'"> &middot; {{ formatDate(q.createdAt) }}</span>
            </div>
            <div class="sq-item-actions" @click.stop @keydown.enter.stop>
              <span v-if="copiedId === q.id" class="sq-copied" role="status">Copied</span>
              <button
                v-if="q.visibility"
                type="button"
                class="sq-action"
                title="Copy link"
                aria-label="Copy link to this query"
                @click="copyLink(q)"
              >&#128279;</button>
              <button
                v-if="canModify(q)"
                type="button"
                class="sq-action"
                title="Edit title, description and sharing"
                :aria-label="`Edit ${q.name}`"
                @click="openDrawer(q)"
              >&#9998;</button>
              <button
                v-if="canModify(q)"
                type="button"
                class="sq-action sq-action-del"
                title="Delete"
                :aria-label="`Delete ${q.name}`"
                @click="remove(q.id)"
              >&times;</button>
            </div>
          </div>
        </div>
      </template>
      <template v-if="!queries.length">
        <div class="sq-divider" />
        <div class="sq-empty text-muted">No saved queries</div>
      </template>
    </div>

    <div v-if="open" class="sq-backdrop" @click="open = false" />

    <SaveQueryDrawer
      :open="drawerOpen"
      :editing="editing"
      :current="current"
      :tenant="activeTenant"
      :groups="groups"
      :server-mode="serverMode"
      :can-share="canShare"
      :can-change-visibility="!editing || isOwner(editing)"
      :saving="saving"
      :error="drawerError"
      @close="drawerOpen = false"
      @submit="handleSubmit"
    />
  </div>
</template>

<style scoped src="../styles/components/SavedQueries.css"></style>
