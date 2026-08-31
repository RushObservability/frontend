<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from './EmptyState.vue'

const props = defineProps<{
  mode: 'spans' | 'logs'
  loading: boolean
  error?: string | null
  hasResults: boolean
}>()

const title = computed(() => {
  if (props.loading) return props.mode === 'logs' ? 'Searching logs' : 'Searching traces'
  if (props.error) return 'Search failed'
  return props.mode === 'logs' ? 'No log events in this range' : 'No traces match this search'
})

const description = computed(() => {
  if (props.loading) return 'Rush is querying the selected time range.'
  if (props.error) return props.error
  return props.mode === 'logs'
    ? 'Try a wider time range, remove a filter, or search for a different term.'
    : 'Try a wider time range or remove one of the active filters.'
})
</script>

<template>
  <EmptyState
    v-if="!hasResults || loading || error"
    :title="title"
    :description="description"
    :icon="loading ? '◌' : error ? '!' : '◇'"
    :tone="loading ? 'loading' : error ? 'error' : 'neutral'"
  >
    <template v-if="!loading && !error && $slots.action" #action><slot name="action" /></template>
  </EmptyState>
</template>

