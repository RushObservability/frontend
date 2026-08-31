<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import BarWidget from '../widgets/BarWidget.vue'
import type { BarPanelProps } from './types'

withDefaults(defineProps<BarPanelProps>(), {
  groups: () => [],
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  loading: false,
  error: null,
  emptyTitle: 'No grouped data',
  emptyMessage: 'Try a wider time range or choose another grouping.',
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
    :empty="!loading && !error && groups.length === 0"
    :empty-title="emptyTitle"
    :empty-message="emptyMessage"
    variant="bar"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template v-if="$slots.summary" #summary><slot name="summary" /></template>
    <BarWidget :groups="groups" />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
