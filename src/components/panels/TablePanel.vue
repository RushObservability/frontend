<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import TableWidget from '../widgets/TableWidget.vue'
import type { TablePanelProps } from './types'

withDefaults(defineProps<TablePanelProps>(), {
  rows: () => [],
  columns: () => [],
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  loading: false,
  error: null,
  emptyTitle: 'No matching rows',
  emptyMessage: "Try a wider time range or adjust this panel's filters.",
})
</script>

<template>
  <PanelCard
    :title="title"
    :description="description"
    :caption="caption"
    :source-label="sourceLabel"
    :range-label="rangeLabel"
    :loading="loading"
    :error="error"
    :empty="!loading && !error && rows.length === 0"
    :empty-title="emptyTitle"
    :empty-message="emptyMessage"
    variant="table"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <slot v-if="$slots.default" />
    <TableWidget v-else :rows="rows" :columns="columns" />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
