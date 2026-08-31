<script setup lang="ts">
import { computed } from 'vue'
import VirtualTable from '../VirtualTable.vue'
import EmptyState from '../EmptyState.vue'
import type { TableWidgetColumn, TableWidgetFormat } from './table'

const props = withDefaults(defineProps<{
  rows: Record<string, unknown>[]
  columns?: TableWidgetColumn[]
}>(), {
  columns: () => [],
})

const columnDefinitions = computed<TableWidgetColumn[]>(() => {
  if (props.columns.length > 0) return props.columns
  if (props.rows.length === 0) return []
  const priority = ['timestamp', 'service_name', 'error_message', 'message', 'http_method', 'http_path', 'http_status_code', 'duration_ns', 'status', 'count']
  const allKeys = Object.keys(props.rows[0]!)
  const ordered = priority.filter(k => allKeys.includes(k))
  const keys = ordered.length > 0 ? ordered : allKeys.slice(0, 6)
  return keys.map((key) => ({ key, label: shortCol(key) }))
})

function formatDurationNs(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}s`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}ms`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}µs`
  return `${value}ns`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = value
  let unit = -1
  do { size /= 1024; unit++ } while (size >= 1024 && unit < units.length - 1)
  return `${size.toLocaleString(undefined, { maximumFractionDigits: size >= 10 ? 1 : 2 })} ${units[unit]}`
}

function formatMilliseconds(value: number): string {
  if (value >= 1000) return `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`
  if (value > 0 && value < 0.01) return '<0.01 ms'
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`
}

function formatSeconds(value: number): string {
  if (value >= 3600) return `${(value / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
  if (value >= 60) return `${(value / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} min`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`
}

function formatNumber(value: number, format: TableWidgetFormat): string {
  if (format === 'bytes') return formatBytes(value)
  if (format === 'duration-ms') return formatMilliseconds(value)
  if (format === 'duration-s') return formatSeconds(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatCell(value: unknown, column: TableWidgetColumn): string {
  if (value === null || value === undefined) return '-'
  if (column.key === 'duration_ns' && typeof value === 'number') return formatDurationNs(value)
  if (column.key === 'status' && typeof value === 'string') return value.replace(/^STATUS_CODE_/, '')
  if (column.format === 'boolean') return value === true || value === 'true' ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (column.key === 'timestamp') {
      // nanosecond timestamp
      return new Date(value / 1_000_000).toISOString().slice(11, 23)
    }
    return formatNumber(value, column.format || 'auto')
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

function columnTrack(column: TableWidgetColumn): string {
  if (column.width) return column.width
  const key = column.key
  if (key === 'timestamp') return '96px'
  if (key === 'service_name') return 'minmax(82px, .85fr)'
  if (key === 'http_method') return '64px'
  if (key === 'http_path') return 'minmax(150px, 1.8fr)'
  if (key === 'http_status_code') return '60px'
  if (key === 'duration_ns') return '76px'
  if (key === 'status') return 'minmax(68px, .75fr)'
  if (key === 'count') return '72px'
  if (key === 'error_message' || key === 'message') return 'minmax(210px, 2.4fr)'
  return 'minmax(100px, 1fr)'
}

function columnClass(column: TableWidgetColumn): string[] {
  return [
    `tw-col-${column.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    `tw-align-${column.align || 'left'}`,
  ]
}

const gridStyle = computed(() => ({
  gridTemplateColumns: columnDefinitions.value.map(columnTrack).join(' ') || 'minmax(100px, 1fr)',
}))

const traceColumns = ['timestamp', 'service_name', 'http_method', 'http_path', 'http_status_code', 'duration_ns', 'status']
const isTraceTable = computed(() => {
  const keys = columnDefinitions.value.map((column) => column.key)
  return keys.length === traceColumns.length && traceColumns.every((column, index) => keys[index] === column)
})

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
      <VirtualTable
        :count="rows.length"
        :item-key="rowKeyAt"
        :row-height="29"
        aria-label="Dashboard table data"
      >
        <template #header>
          <div class="tw-row tw-head" :style="gridStyle" role="row">
            <div
              v-for="column in columnDefinitions"
              :key="column.key"
              :class="columnClass(column)"
              :title="column.description"
              role="columnheader"
            >{{ column.label }}</div>
          </div>
        </template>
        <template #default="{ index }">
          <div class="tw-row" :class="`tw-row--${String(rowAt(index).severity || '').toLowerCase()}`" :style="gridStyle" role="row">
            <div
              v-for="column in columnDefinitions"
              :key="column.key"
              class="tw-cell"
              :class="[columnClass(column), { 'tw-cell-mono': column.monospace }]"
              :title="formatCell(rowAt(index)[column.key], column)"
              role="cell"
            >{{ formatCell(rowAt(index)[column.key], column) }}</div>
          </div>
        </template>
      </VirtualTable>
    </template>
    <EmptyState
      v-else
      title="No rows in this range"
      description="Try a wider time range or review the panel query."
      icon="—"
      compact
    />
  </div>
</template>

<style scoped src="../../styles/widgets/TableWidget.css"></style>
