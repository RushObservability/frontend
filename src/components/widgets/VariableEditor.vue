<script setup lang="ts">
import { ref } from 'vue'
import type { DashboardVariable, DashboardVariableType } from '../../types'

const props = defineProps<{ variables: DashboardVariable[] }>()
const emit = defineEmits<{ save: [vars: DashboardVariable[]]; cancel: [] }>()

// Editable rows; `optionsText` is the comma-separated UI mirror of `options`.
interface Row extends DashboardVariable { _id: string; optionsText: string }
const rows = ref<Row[]>(
  (props.variables || []).map(v => ({
    ...v, _id: crypto.randomUUID(), optionsText: (v.options || []).join(', '),
  })),
)

function addRow() {
  rows.value.push({ _id: crypto.randomUUID(), name: '', type: 'query', field: 'service_name', include_all: true, optionsText: '' })
}
function removeRow(id: string) { rows.value = rows.value.filter(r => r._id !== id) }

const TYPES: { value: DashboardVariableType; label: string }[] = [
  { value: 'query', label: 'Query (field values)' },
  { value: 'static', label: 'Static list' },
  { value: 'textbox', label: 'Text box' },
]

function save() {
  const out: DashboardVariable[] = rows.value
    .filter(r => r.name.trim())
    .map(r => ({
      name: r.name.trim().replace(/[^\w]/g, '_'),
      label: r.label?.trim() || undefined,
      type: r.type,
      field: r.type === 'query' ? (r.field || 'service_name') : undefined,
      options: r.type === 'static' ? r.optionsText.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      default: r.default?.trim() || undefined,
      include_all: r.type !== 'textbox' ? !!r.include_all : undefined,
    }))
  emit('save', out)
}
</script>

<template>
  <div class="ve-backdrop" @click.self="emit('cancel')">
    <div class="ve-modal card">
      <div class="ve-header">
        <div class="ve-title">Dashboard variables</div>
        <button class="ve-close" @click="emit('cancel')">&times;</button>
      </div>

      <div class="ve-body">
        <p class="ve-hint text-muted">
          Variables become dropdowns at the top of the dashboard. Reference one in any widget
          query as <code>$name</code> (e.g. a filter value <code>$service</code>, or
          <code>$service</code> inside PromQL).
        </p>

        <div v-if="rows.length === 0" class="ve-empty text-muted">No variables yet.</div>

        <div v-for="r in rows" :key="r._id" class="ve-row card">
          <div class="ve-row-grid">
            <div class="ve-field">
              <label class="ve-label">Name</label>
              <input v-model="r.name" class="ve-input mono" placeholder="service" />
            </div>
            <div class="ve-field">
              <label class="ve-label">Label</label>
              <input v-model="r.label" class="ve-input" placeholder="(optional)" />
            </div>
            <div class="ve-field">
              <label class="ve-label">Type</label>
              <select v-model="r.type" class="ve-input">
                <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
            <button class="ve-remove" title="Remove" @click="removeRow(r._id)">&times;</button>
          </div>
          <div class="ve-row-grid2">
            <div v-if="r.type === 'query'" class="ve-field">
              <label class="ve-label">Field</label>
              <input v-model="r.field" class="ve-input mono" placeholder="service_name" />
            </div>
            <div v-if="r.type === 'static'" class="ve-field ve-grow">
              <label class="ve-label">Options (comma-separated)</label>
              <input v-model="r.optionsText" class="ve-input mono" placeholder="us-east, us-west, eu" />
            </div>
            <div class="ve-field">
              <label class="ve-label">Default</label>
              <input v-model="r.default" class="ve-input mono" placeholder="(first value)" />
            </div>
            <label v-if="r.type !== 'textbox'" class="ve-check">
              <input type="checkbox" v-model="r.include_all" /> Include “All”
            </label>
          </div>
        </div>

        <button class="ve-add" @click="addRow">+ Add variable</button>
      </div>

      <div class="ve-footer">
        <button class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-primary" @click="save">Save variables</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/VariableEditor.css"></style>
