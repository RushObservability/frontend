<script setup lang="ts" generic="T">
import { ref } from 'vue'
import type { HistoryEntry } from '../composables/useQueryHistory'

defineProps<{
  entries: HistoryEntry<T>[]
}>()

const emit = defineEmits<{
  load: [entry: HistoryEntry<T>]
  remove: [id: string]
  clear: []
}>()

const open = ref(false)

function handleLoad(entry: HistoryEntry<T>) {
  emit('load', entry)
  open.value = false
}

function handleRemove(e: Event, id: string) {
  e.stopPropagation()
  emit('remove', id)
}

function handleClear(e: Event) {
  e.stopPropagation()
  emit('clear')
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
</script>

<template>
  <div class="qh">
    <button class="qh-trigger" @click="open = !open">
      <span>&#128339;</span> History
      <span v-if="entries.length" class="qh-count mono">{{ entries.length }}</span>
    </button>

    <div v-if="open" class="qh-dropdown">
      <!-- Clear all -->
      <div v-if="entries.length" class="qh-clear" @click="handleClear($event)">
        Clear all
      </div>

      <!-- Divider -->
      <div v-if="entries.length" class="qh-divider" />

      <!-- List -->
      <div v-if="entries.length" class="qh-list">
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="qh-item"
          @click="handleLoad(entry)"
        >
          <div class="qh-item-summary">
            <slot name="summary" :entry="entry">
              {{ JSON.stringify(entry.query) }}
            </slot>
          </div>
          <div class="qh-item-time text-muted mono">{{ timeAgo(entry.timestamp) }}</div>
          <button class="qh-item-del" @click="handleRemove($event, entry.id)" title="Delete">&times;</button>
        </div>
      </div>
      <div v-else class="qh-empty text-muted">No history yet</div>
    </div>

    <div v-if="open" class="qh-backdrop" @click="open = false" />
  </div>
</template>

<style scoped src="../styles/components/QueryHistory.css"></style>
