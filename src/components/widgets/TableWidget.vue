<script setup lang="ts">
import { computed } from 'vue'
import VirtualTable from '../VirtualTable.vue'

const props = defineProps<{
  rows: Record<string, unknown>[]
}>()

const columns = computed(() => {
  if (props.rows.length === 0) return []
  const priority = ['timestamp', 'service_name', 'http_method', 'http_path', 'http_status_code', 'duration_ns', 'status']
  const allKeys = Object.keys(props.rows[0]!)
  const ordered = priority.filter(k => allKeys.includes(k))
  return ordered.length > 0 ? ordered : allKeys.slice(0, 6)
})

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') {
    if (String(value).length > 13) {
      // nanosecond timestamp
      return new Date(value / 1_000_000).toISOString().slice(11, 23)
    }
    return value.toLocaleString()
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60)
  return String(value)
}

function shortCol(col: string): string {
  return col.replace('http_', '').replace('_ns', '')
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(columns.value.length, 1)}, minmax(90px, 1fr))`,
}))

function rowAt(index: number): Record<string, unknown> {
  return props.rows[index]!
}

function rowKeyAt(index: number): string {
  const row = props.rows[index]
  return String(row?.id ?? row?.trace_id ?? row?.span_id ?? row?.timestamp ?? index)
}
</script>

<template>
  <div class="table-widget">
    <template v-if="rows.length > 0">
      <div class="tw-row tw-head" :style="gridStyle" role="row">
        <div v-for="col in columns" :key="col" class="mono" role="columnheader">{{ shortCol(col) }}</div>
      </div>
      <VirtualTable
        :count="rows.length"
        :item-key="rowKeyAt"
        :row-height="29"
        aria-label="Dashboard table data"
      >
        <template #default="{ index }">
          <div class="tw-row" :style="gridStyle" role="row">
            <div v-for="col in columns" :key="col" class="mono tw-cell" role="cell">{{ formatCell(rowAt(index)[col]) }}</div>
          </div>
        </template>
      </VirtualTable>
    </template>
    <div v-else class="empty-state">
      <div class="empty-state-icon">--</div>
      <div>No data</div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/TableWidget.css"></style>
