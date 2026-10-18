<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SavedQuery, QueryFilter } from '../types'
import { useSavedQueries } from '../composables/useSavedQueries'

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

const { queries, error, serverMode, canShare, save, setVisibility, remove, isOwner, canModify } = useSavedQueries()
const open = ref(false)
const saveName = ref('')
const shareOnSave = ref(false)
const showSaveForm = ref(false)
const saving = ref(false)
const rejected = ref(false)
const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const shared = computed(() => queries.value.filter(q => q.visibility === 'tenant'))
const mine = computed(() => queries.value.filter(q => q.visibility !== 'tenant'))
const sections = computed(() => serverMode.value
  ? [
      { key: 'shared', title: 'Shared with team', items: shared.value },
      { key: 'mine', title: 'My queries', items: mine.value },
    ].filter(s => s.items.length)
  : [{ key: 'local', title: '', items: queries.value }].filter(s => s.items.length))

async function handleSave() {
  const name = saveName.value.trim()
  if (!name || saving.value) return
  saving.value = true
  rejected.value = false
  const ok = await save({
    name,
    filters: props.currentFilters,
    groupBy: props.currentGroupBy,
    timePreset: props.currentTimePreset,
    search: props.currentSearch || undefined,
    viewMode: props.currentViewMode,
    visibility: shareOnSave.value && canShare.value ? 'tenant' : 'private',
  })
  saving.value = false
  if (!ok) {
    // A failed request sets `error`; a local rejection means the query looked
    // like it contained a credential.
    rejected.value = !error.value
    return
  }
  saveName.value = ''
  shareOnSave.value = false
  showSaveForm.value = false
}

function handleLoad(query: SavedQuery) {
  emit('load', query)
  open.value = false
}

function handleRemove(id: string) {
  void remove(id)
}

function toggleShare(q: SavedQuery) {
  void setVisibility(q.id, q.visibility === 'tenant' ? 'private' : 'tenant')
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
</script>

<template>
  <div class="sq">
    <button class="sq-trigger" :aria-expanded="open" @click="open = !open">
      <span>&#9733;</span> Saved
      <span v-if="queries.length" class="sq-count mono">{{ queries.length }}</span>
    </button>

    <div v-if="open" class="sq-dropdown">
      <!-- Save current -->
      <button v-if="!showSaveForm" type="button" class="sq-save-btn" @click="showSaveForm = true">
        + Save current query
      </button>
      <form v-else class="sq-save-form" @submit.prevent="handleSave">
        <div class="sq-save-row">
          <input
            v-model="saveName"
            class="sq-save-input"
            placeholder="Query name..."
            maxlength="120"
            autofocus
            @keydown.escape="showSaveForm = false"
          />
          <button type="submit" class="sq-save-confirm" :disabled="saving || !saveName.trim()">Save</button>
        </div>
        <label v-if="canShare" class="sq-share-opt">
          <input v-model="shareOnSave" type="checkbox" />
          Share with team
        </label>
      </form>
      <div v-if="error" class="sq-error" role="alert">{{ error }}</div>
      <div v-else-if="rejected" class="sq-error" role="alert">
        This query looks like it contains a credential, so it was not saved.
      </div>

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
            @click="handleLoad(q)"
            @keydown.enter="handleLoad(q)"
          >
            <div class="sq-item-name">{{ q.name }}</div>
            <div class="sq-item-meta text-muted mono">
              {{ q.filters.length }} filter{{ q.filters.length !== 1 ? 's' : '' }}
              <span v-if="q.groupBy"> &middot; {{ q.groupBy }}</span>
              <span v-if="q.visibility === 'tenant' && !isOwner(q) && q.ownerName"> &middot; by {{ q.ownerName }}</span>
              <span v-if="q.visibility !== 'tenant'"> &middot; {{ formatDate(q.createdAt) }}</span>
            </div>
            <div class="sq-item-actions" @click.stop @keydown.enter.stop>
              <span v-if="copiedId === q.id" class="sq-copied" role="status">Copied</span>
              <button
                v-if="q.visibility === 'tenant' || (q.visibility && isOwner(q))"
                type="button"
                class="sq-action"
                title="Copy link"
                aria-label="Copy link to this query"
                @click="copyLink(q)"
              >&#128279;</button>
              <button
                v-if="canShare && q.visibility && isOwner(q)"
                type="button"
                class="sq-action"
                :class="{ 'sq-action-on': q.visibility === 'tenant' }"
                :title="q.visibility === 'tenant' ? 'Stop sharing' : 'Share with team'"
                :aria-label="q.visibility === 'tenant' ? 'Stop sharing with team' : 'Share with team'"
                :aria-pressed="q.visibility === 'tenant'"
                @click="toggleShare(q)"
              >&#128101;</button>
              <button
                v-if="canModify(q)"
                type="button"
                class="sq-action sq-action-del"
                title="Delete"
                :aria-label="`Delete ${q.name}`"
                @click="handleRemove(q.id)"
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
  </div>
</template>

<style scoped src="../styles/components/SavedQueries.css"></style>
