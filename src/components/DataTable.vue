<script setup lang="ts">
/**
 * Shared operational table for catalog and integration views.
 *
 * Use cell-{column.key} slots when a value needs domain-specific formatting;
 * the default renderer keeps plain values useful without forcing a schema.
 */
export interface DataTableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  headerClass?: string
  cellClass?: string | ((row: DataTableRow) => string | undefined)
}

type DataTableRow = Record<string, unknown>

const props = withDefaults(defineProps<{
  columns: DataTableColumn[]
  rows: DataTableRow[]
  rowKey?: string | ((row: DataTableRow, index: number) => string | number)
  loading?: boolean
  loadingRows?: number
  emptyLabel?: string
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  clickableRows?: boolean
  expandedRowKey?: string | number | null
  rowClass?: string | ((row: DataTableRow, index: number) => string | undefined)
}>(), {
  rowKey: 'id',
  loading: false,
  loadingRows: 5,
  emptyLabel: 'No data',
  sortKey: '',
  sortDirection: 'desc',
  clickableRows: false,
  expandedRowKey: null,
  rowClass: '',
})

const emit = defineEmits<{
  sort: [key: string]
  rowClick: [row: DataTableRow, index: number]
}>()

function rowId(row: DataTableRow, index: number): string | number {
  if (typeof props.rowKey === 'function') return props.rowKey(row, index)
  const value = row[props.rowKey]
  return typeof value === 'string' || typeof value === 'number' ? value : index
}

function valueFor(row: DataTableRow, column: DataTableColumn): unknown {
  return row[column.key]
}

function cellClassFor(column: DataTableColumn, row?: DataTableRow): string | undefined {
  if (typeof column.cellClass === 'function') return row ? column.cellClass(row) : undefined
  return column.cellClass
}

function defaultValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

function sortIndicator(column: DataTableColumn): string {
  if (!column.sortable || props.sortKey !== column.key) return ''
  return props.sortDirection === 'asc' ? ' ▴' : ' ▾'
}

function ariaSort(column: DataTableColumn): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable) return undefined
  if (props.sortKey !== column.key) return 'none'
  return props.sortDirection === 'asc' ? 'ascending' : 'descending'
}

function isExpanded(row: DataTableRow, index: number): boolean {
  return props.expandedRowKey !== null && rowId(row, index) === props.expandedRowKey
}

function rowClassFor(row: DataTableRow, index: number): string | undefined {
  return typeof props.rowClass === 'function' ? props.rowClass(row, index) : props.rowClass
}
</script>

<template>
  <div class="data-table-wrap card">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="[
              column.headerClass,
              column.align ? `data-table-col-${column.align}` : '',
              { sortable: column.sortable },
            ]"
            :aria-sort="ariaSort(column)"
          >
            <button
              v-if="column.sortable"
              type="button"
              class="data-table-sort-button"
              @click="emit('sort', column.key)"
            >
              <span>{{ column.label }}</span>
              <span class="data-table-sort-indicator" aria-hidden="true">{{ sortIndicator(column) }}</span>
            </button>
            <span v-else>{{ column.label }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="i in loadingRows" :key="`loading-${i}`" class="data-table-loading-row" aria-hidden="true">
            <td v-for="column in columns" :key="column.key" :class="[cellClassFor(column), column.align ? `data-table-col-${column.align}` : '']">
              <span class="data-table-placeholder"></span>
            </td>
          </tr>
        </template>
        <template v-else-if="rows.length">
          <tr
            v-for="(row, index) in rows"
            :key="rowId(row, index)"
            :class="[rowClassFor(row, index), { 'data-table-row-clickable': clickableRows }]"
            :tabindex="clickableRows ? 0 : undefined"
            :aria-expanded="clickableRows && expandedRowKey !== null ? isExpanded(row, index) : undefined"
            @click="clickableRows && emit('rowClick', row, index)"
            @keydown.enter="clickableRows && emit('rowClick', row, index)"
            @keydown.space.prevent="clickableRows && emit('rowClick', row, index)"
          >
            <td v-for="column in columns" :key="column.key" :class="[cellClassFor(column, row), column.align ? `data-table-col-${column.align}` : '']">
              <slot :name="`cell-${column.key}`" :row="row" :value="valueFor(row, column)" :column="column">
                {{ defaultValue(valueFor(row, column)) }}
              </slot>
            </td>
          </tr>
          <tr v-if="isExpanded(row, index)" class="data-table-detail-row">
            <td :colspan="columns.length">
              <slot name="row-detail" :row="row" :index="index" />
            </td>
          </tr>
        </template>
        <tr v-else>
          <td :colspan="columns.length" class="data-table-empty">
            <slot name="empty">{{ emptyLabel }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="../styles/components/DataTable.css"></style>
