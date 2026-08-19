<script setup lang="ts">
import { computed } from 'vue'
import VirtualTable from '../VirtualTable.vue'

const props = defineProps<{
  rows: Record<string, unknown>[]
}>()

const columns = computed(() => {
  if (props.rows.length === 0) return []
  const priority = ['timestamp', 'service_name', 'error_message', 'message', 'http_method', 'http_path', 'http_status_code', 'duration_ns', 'status', 'count']
  const allKeys = Object.keys(props.rows[0]!)
  const ordered = priority.filter(k => allKeys.includes(k))
  return ordered.length > 0 ? ordered : allKeys.slice(0, 6)
})

function formatDurationNs(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}s`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}ms`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}µs`
  return `${value}ns`
}

function formatCell(value: unknown, column: string): string {
  if (value === null || value === undefined) return '-'
  if (column === 'duration_ns' && typeof value === 'number') return formatDurationNs(value)
  if (column === 'status' && typeof value === 'string') return value.replace(/^STATUS_CODE_/, '')
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
  const labels: Record<string, string> = {
    service_name: 'service',
    error_message: 'error message',
    http_method: 'method',
    http_path: 'path',
    http_status_code: 'code',
    duration_ns: 'duration',
    status: 'state',
  }
  return labels[col] || col.replace(/_/g, ' ')
}

function columnTrack(column: string): string {
  if (column === 'timestamp') return '96px'
  if (column === 'service_name') return 'minmax(82px, .85fr)'
  if (column === 'http_method') return '64px'
  if (column === 'http_path') return 'minmax(150px, 1.8fr)'
  if (column === 'http_status_code') return '60px'
  if (column === 'duration_ns') return '76px'
  if (column === 'status') return 'minmax(68px, .75fr)'
  if (column === 'count') return '72px'
  if (column === 'error_message' || column === 'message') return 'minmax(210px, 2.4fr)'
  return 'minmax(100px, 1fr)'
}

function columnClass(column: string): string {
  return `tw-col-${column.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

const gridStyle = computed(() => ({
  gridTemplateColumns: columns.value.map(columnTrack).join(' ') || 'minmax(100px, 1fr)',
}))

const traceColumns = ['timestamp', 'service_name', 'http_method', 'http_path', 'http_status_code', 'duration_ns', 'status']
const isTraceTable = computed(() => columns.value.length === traceColumns.length && traceColumns.every((column, index) => columns.value[index] === column))

function rowAt(index: number): Record<string, unknown> {
  return props.rows[index]!
}

function rowKeyAt(index: number): string {
  const row = props.rows[index]
  return String(row?.id ?? row?.trace_id ?? row?.span_id ?? row?.timestamp ?? index)
}
</script>

<template>
  <div class="table-widget" :class="{ 'table-widget--trace': isTraceTable }">
    <template v-if="rows.length > 0">
      <div class="tw-row tw-head" :style="gridStyle" role="row">
        <div v-for="col in columns" :key="col" class="mono" :class="columnClass(col)" role="columnheader">{{ shortCol(col) }}</div>
      </div>
      <VirtualTable
        :count="rows.length"
        :item-key="rowKeyAt"
        :row-height="29"
        aria-label="Dashboard table data"
      >
        <template #default="{ index }">
          <div class="tw-row" :style="gridStyle" role="row">
            <div
              v-for="col in columns"
              :key="col"
              class="mono tw-cell"
              :class="columnClass(col)"
              :title="formatCell(rowAt(index)[col], col)"
              role="cell"
            >{{ formatCell(rowAt(index)[col], col) }}</div>
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
