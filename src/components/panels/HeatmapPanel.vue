<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import HeatmapWidget from '../widgets/HeatmapWidget.vue'
import type { HeatmapPanelProps } from './types'

withDefaults(defineProps<HeatmapPanelProps>(), {
  series: () => [],
  unit: '',
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  loading: false,
  error: null,
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
    :empty="!loading && !error && !series.some(item => item.points.some(([, value]) => Number.isFinite(value)))"
    empty-title="No heatmap data"
    empty-message="Choose a query with time buckets, then split by a group or add more queries."
    variant="chart"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <HeatmapWidget :series="series" :time-domain="timeDomain" :unit="unit" />
  </PanelCard>
</template>
