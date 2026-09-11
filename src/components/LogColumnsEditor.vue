<script setup lang="ts">
import { DEFAULT_LOG_COLUMNS, type LogViewColumn } from '../lib/logViews'
const props = defineProps<{ modelValue: LogViewColumn[] }>()
const emit = defineEmits<{ 'update:modelValue': [columns: LogViewColumn[]] }>()
function update(index: number, key: 'field' | 'label', event: Event) {
  const columns = props.modelValue.map(column => ({ ...column }))
  columns[index]![key] = (event.target as HTMLInputElement).value
  emit('update:modelValue', columns)
}
function move(index: number, delta: number) {
  const columns = [...props.modelValue]
  const [column] = columns.splice(index, 1)
  columns.splice(index + delta, 0, column!)
  emit('update:modelValue', columns)
}
</script>

<template>
  <div class="log-columns-editor">
    <p class="field-help">Choose fields and their display order. Use <code>log.airline</code> for log attributes, <code>resource.cluster</code> for resource attributes, or <code>body.airline</code> for JSON messages.</p>
    <div class="column-labels" aria-hidden="true"><span>Field</span><span>Column heading</span><span>Order</span></div>
    <div v-for="(column, index) in modelValue" :key="index" class="column-editor-row">
      <input :value="column.field" :aria-label="`Column ${index + 1} field`" placeholder="log.airline" maxlength="128" @input="update(index, 'field', $event)">
      <input :value="column.label" :aria-label="`Column ${index + 1} heading`" placeholder="Airline" maxlength="80" @input="update(index, 'label', $event)">
      <div class="column-actions">
        <button type="button" :disabled="index === 0" :aria-label="`Move ${column.label || 'column'} up`" @click="move(index, -1)">↑</button>
        <button type="button" :disabled="index === modelValue.length - 1" :aria-label="`Move ${column.label || 'column'} down`" @click="move(index, 1)">↓</button>
        <button type="button" :aria-label="`Remove ${column.label || 'column'}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">Remove</button>
      </div>
    </div>
    <div class="column-actions">
      <button type="button" :disabled="modelValue.length >= 20" @click="emit('update:modelValue', [...modelValue, { field: '', label: '' }])">Add column</button>
      <button type="button" @click="emit('update:modelValue', DEFAULT_LOG_COLUMNS.map(column => ({ ...column })))">Default columns</button>
    </div>
  </div>
</template>

<style scoped>
.log-columns-editor { display: grid; gap: 8px; }
.field-help { margin: 0 0 8px; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.column-labels, .column-editor-row { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(120px, 1fr) 140px; gap: 10px; align-items: center; }
.column-labels { color: var(--text-muted); font-size: 11px; }
input { min-width: 0; width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 4px; background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: 12px; }
.column-actions { display: flex; gap: 6px; }
button { padding: 6px 8px; background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--text-secondary); cursor: pointer; font-size: 12px; }
button:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
button:disabled { opacity: .4; cursor: default; }
@media (max-width: 600px) { .column-labels { display: none; } .column-editor-row { grid-template-columns: 1fr 1fr; padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle); } .column-actions { grid-column: 1 / -1; } }
</style>
