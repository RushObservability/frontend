<script setup lang="ts">
import { ref } from 'vue'
import type { SavedQuery, QueryFilter } from '../types'
import { useSavedQueries } from '../composables/useSavedQueries'

const props = defineProps<{
  currentFilters: QueryFilter[]
  currentGroupBy: string
  currentTimePreset: number
}>()

const emit = defineEmits<{
  load: [query: SavedQuery]
}>()

const { queries, save, remove } = useSavedQueries()
const open = ref(false)
const saveName = ref('')
const showSaveForm = ref(false)

function handleSave() {
  const name = saveName.value.trim()
  if (!name) return
  save({
    name,
    filters: props.currentFilters,
    groupBy: props.currentGroupBy,
    timePreset: props.currentTimePreset,
  })
  saveName.value = ''
  showSaveForm.value = false
}

function handleLoad(query: SavedQuery) {
  emit('load', query)
  open.value = false
}

function handleRemove(e: Event, id: string) {
  e.stopPropagation()
  remove(id)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="sq">
    <button class="sq-trigger" @click="open = !open">
      <span>&#9733;</span> Saved
      <span v-if="queries.length" class="sq-count mono">{{ queries.length }}</span>
    </button>

    <div v-if="open" class="sq-dropdown">
      <!-- Save current -->
      <div v-if="!showSaveForm" class="sq-save-btn" @click="showSaveForm = true">
        + Save current query
      </div>
      <div v-else class="sq-save-form">
        <input
          v-model="saveName"
          class="sq-save-input"
          placeholder="Query name..."
          autofocus
          @keydown.enter="handleSave"
          @keydown.escape="showSaveForm = false"
        />
        <button class="sq-save-confirm" @click="handleSave">Save</button>
      </div>

      <!-- Divider -->
      <div v-if="queries.length" class="sq-divider" />

      <!-- List -->
      <div v-if="queries.length" class="sq-list">
        <div
          v-for="q in queries"
          :key="q.id"
          class="sq-item"
          @click="handleLoad(q)"
        >
          <div class="sq-item-name">{{ q.name }}</div>
          <div class="sq-item-meta text-muted mono">
            {{ q.filters.length }} filter{{ q.filters.length !== 1 ? 's' : '' }}
            <span v-if="q.groupBy"> &middot; {{ q.groupBy }}</span>
          </div>
          <div class="sq-item-date text-muted mono">{{ formatDate(q.createdAt) }}</div>
          <button class="sq-item-del" @click="handleRemove($event, q.id)" title="Delete">&times;</button>
        </div>
      </div>
      <div v-else class="sq-empty text-muted">No saved queries</div>
    </div>

    <div v-if="open" class="sq-backdrop" @click="open = false" />
  </div>
</template>

<style scoped src="../styles/components/SavedQueries.css"></style>
