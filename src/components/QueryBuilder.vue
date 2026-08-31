<script setup lang="ts">
import { ref, watch } from 'vue'
import type { QueryFilter } from '../types'
import { useApi } from '../composables/useApi'

const model = defineModel<QueryFilter[]>('filters', { default: () => [] })

const emit = defineEmits<{
  submit: []
}>()

const api = useApi()

const DIRECT_FIELDS = [
  'service_name',
  'http_method',
  'http_path',
  'http_status_code',
  'status',
  'environment',
  'host_name',
  'service_version',
  'duration_ns',
]

const OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN']

// Autocomplete state per filter row
const suggestions = ref<Record<string, string[]>>({})
const activeSuggest = ref<string | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function addRow() {
  model.value = [
    ...model.value,
    { id: crypto.randomUUID(), field: 'service_name', op: '=', value: '' },
  ]
}

function removeRow(id: string) {
  model.value = model.value.filter(f => f.id !== id)
  delete suggestions.value[id]
}

function updateFilter(id: string, key: keyof QueryFilter, val: string) {
  model.value = model.value.map(f =>
    f.id === id ? { ...f, [key]: val } : f
  )
}

function onValueInput(filter: QueryFilter) {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    if (filter.value.length < 1) {
      suggestions.value[filter.id] = []
      return
    }
    try {
      const results = await api.suggestValues(filter.field, filter.value)
      suggestions.value[filter.id] = results.slice(0, 8)
      activeSuggest.value = filter.id
    } catch {
      suggestions.value[filter.id] = []
    }
  }, 300)
}

function pickSuggestion(filterId: string, val: string) {
  updateFilter(filterId, 'value', val)
  suggestions.value[filterId] = []
  activeSuggest.value = null
}

function closeSuggestions() {
  activeSuggest.value = null
}

function delayedCloseSuggest(filterId: string) {
  setTimeout(() => { if (activeSuggest.value === filterId) activeSuggest.value = null }, 150)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeSuggestions()
  if (e.key === 'Enter') emit('submit')
}

// Initialize with one empty row if empty
watch(model, (v) => {
  if (!v.length) addRow()
}, { immediate: true })
</script>

<template>
  <div class="qb" @keydown="handleKeydown">
    <div
      v-for="filter in model"
      :key="filter.id"
      class="qb-row fade-in"
    >
      <!-- Field select -->
      <div class="qb-field-wrap">
        <select
          class="qb-select mono"
          :value="filter.field"
          @change="updateFilter(filter.id, 'field', ($event.target as HTMLSelectElement).value)"
        >
          <optgroup label="Direct Fields">
            <option v-for="f in DIRECT_FIELDS" :key="f" :value="f">{{ f }}</option>
          </optgroup>
        </select>
        <!-- Allow typing custom attribute field -->
        <input
          class="qb-field-custom mono"
          :value="filter.field"
          placeholder="attributes.user.plan"
          @input="updateFilter(filter.id, 'field', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- Op select -->
      <select
        class="qb-select qb-op mono"
        :value="filter.op"
        @change="updateFilter(filter.id, 'op', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="op in OPERATORS" :key="op" :value="op">{{ op }}</option>
      </select>

      <!-- Value input with autocomplete -->
      <div class="qb-value-wrap">
        <input
          class="qb-value mono"
          :value="filter.value"
          placeholder="value"
          @input="updateFilter(filter.id, 'value', ($event.target as HTMLInputElement).value); onValueInput({ ...filter, value: ($event.target as HTMLInputElement).value })"
          @focus="onValueInput(filter)"
          @blur="delayedCloseSuggest(filter.id)"
        />
        <div
          v-if="activeSuggest === filter.id && suggestions[filter.id]?.length"
          class="qb-suggest"
        >
          <button
            v-for="s in suggestions[filter.id]"
            :key="s"
            class="qb-suggest-item mono"
            @mousedown.prevent="pickSuggestion(filter.id, s)"
          >{{ s }}</button>
        </div>
      </div>

      <!-- Remove -->
      <button class="qb-remove" @click="removeRow(filter.id)" title="Remove filter">&times;</button>
    </div>

    <button class="qb-add" @click="addRow">+ Add Filter</button>
  </div>
</template>

<style scoped src="../styles/components/QueryBuilder.css"></style>
