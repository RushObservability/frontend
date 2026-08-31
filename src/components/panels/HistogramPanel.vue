<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import HistogramWidget from '../widgets/HistogramWidget.vue'
import type { HistogramPanelProps } from './types'

withDefaults(defineProps<HistogramPanelProps>(), {
  bins: () => [],
  markers: () => [],
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  minLabel: '',
  maxLabel: '',
  color: 'var(--purple, #8b5cf6)',
  unit: 'events',
  loading: false,
  error: null,
  emptyTitle: 'No distribution data',
  emptyMessage: "Try a wider time range or adjust this panel's query.",
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
    :empty="!loading && !error && bins.length === 0"
    :empty-title="emptyTitle"
    :empty-message="emptyMessage"
    variant="bar"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template v-if="$slots.summary" #summary><slot name="summary" /></template>
    <HistogramWidget
      :bins="bins"
      :markers="markers"
      :min-label="minLabel"
      :max-label="maxLabel"
      :color="color"
      :unit="unit"
    />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
