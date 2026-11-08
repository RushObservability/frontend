<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NotebookCellTime } from '../../types'
import { cellTimeLabel, fromLocalInput, toLocalInput, type TimeRange } from '../../lib/notebookTime'

const props = defineProps<{
  time: NotebookCellTime
  /** The range the cell resolves to now, used to seed an absolute range. */
  resolved: TimeRange
  readonly?: boolean
}>()

const emit = defineEmits<{ 'update:time': [time: NotebookCellTime] }>()

const LIVE_OPTIONS = [15, 30, 60, 180, 360, 1440]
const open = ref(false)
const mode = ref<NotebookCellTime['mode']>('inherit')
const absFrom = ref('')
const absTo = ref('')
const relFrom = ref(-15)
const relTo = ref(30)
const liveMinutes = ref(15)
const error = ref('')

const label = computed(() => cellTimeLabel(props.time))

function toggle() {
  if (props.readonly) return
  open.value = !open.value
  if (!open.value) return
  const t = props.time
  mode.value = t.mode
  absFrom.value = toLocalInput(t.mode === 'absolute' ? t.from : props.resolved.from)
  absTo.value = toLocalInput(t.mode === 'absolute' ? t.to : props.resolved.to)
  if (t.mode === 'relative') { relFrom.value = t.offset_from_min; relTo.value = t.offset_to_min }
  if (t.mode === 'live') liveMinutes.value = t.minutes
  error.value = ''
}

function apply() {
  let next: NotebookCellTime
  if (mode.value === 'absolute') {
    const from = fromLocalInput(absFrom.value)
    const to = fromLocalInput(absTo.value)
    if (!from || !to || from >= to) { error.value = 'Pick a start before the end.'; return }
    next = { mode: 'absolute', from, to }
  } else if (mode.value === 'relative') {
    if (!Number.isFinite(relFrom.value) || !Number.isFinite(relTo.value) || relFrom.value >= relTo.value) {
      error.value = 'The first offset must come before the second.'
      return
    }
    next = { mode: 'relative', offset_from_min: Math.round(relFrom.value), offset_to_min: Math.round(relTo.value) }
  } else if (mode.value === 'live') {
    next = { mode: 'live', minutes: liveMinutes.value }
  } else {
    next = { mode: 'inherit' }
  }
  emit('update:time', next)
  open.value = false
}
</script>

<template>
  <div class="time-chip-wrap">
    <button
      type="button"
      class="time-chip mono"
      :class="[`time-chip--${time.mode}`, { readonly }]"
      :aria-expanded="open"
      :title="readonly ? label : 'Change this cell\'s time range'"
      @click="toggle"
    >
      <span aria-hidden="true">{{ time.mode === 'absolute' ? '⌖' : time.mode === 'live' ? '●' : '◷' }}</span>
      {{ label }}
    </button>
    <form v-if="open" class="time-pop" @submit.prevent="apply" @keydown.esc="open = false">
      <fieldset class="time-modes">
        <legend class="sr-only">Time range mode</legend>
        <label><input v-model="mode" type="radio" value="inherit" /> Incident window</label>
        <label><input v-model="mode" type="radio" value="absolute" /> Pinned range</label>
        <label><input v-model="mode" type="radio" value="relative" /> From incident start</label>
        <label><input v-model="mode" type="radio" value="live" /> Live</label>
      </fieldset>
      <div v-if="mode === 'absolute'" class="time-fields">
        <label>From <input v-model="absFrom" type="datetime-local" required @input="error = ''" /></label>
        <label>To <input v-model="absTo" type="datetime-local" required @input="error = ''" /></label>
      </div>
      <div v-else-if="mode === 'relative'" class="time-fields">
        <label>From <input v-model.number="relFrom" type="number" step="1" @input="error = ''" /> min</label>
        <label>To <input v-model.number="relTo" type="number" step="1" @input="error = ''" /> min</label>
        <p class="time-hint">Minutes from the incident start. Use a negative number to look before it.</p>
      </div>
      <div v-else-if="mode === 'live'" class="time-fields">
        <label>Last
          <select v-model.number="liveMinutes">
            <option v-for="m in LIVE_OPTIONS" :key="m" :value="m">{{ m >= 60 ? `${m / 60}h` : `${m}m` }}</option>
          </select>
        </label>
      </div>
      <p v-else class="time-hint">Follows the notebook's incident window.</p>
      <p v-if="error" class="time-error" role="alert">{{ error }}</p>
      <div class="time-actions">
        <button type="button" class="nb-btn" @click="open = false">Cancel</button>
        <button type="submit" class="nb-btn nb-btn--primary">Apply</button>
      </div>
    </form>
  </div>
</template>

<style scoped src="../../styles/views/NotebookView.css"></style>
