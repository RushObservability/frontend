<script setup lang="ts">
import { computed } from 'vue'

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
</script>

<template>
  <div class="table-widget">
    <table v-if="rows.length > 0">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col" class="mono">{{ shortCol(col) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="i">
          <td v-for="col in columns" :key="col" class="mono">{{ formatCell(row[col]) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty-state">
      <div class="empty-state-icon">--</div>
      <div>No data</div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/TableWidget.css"></style>
