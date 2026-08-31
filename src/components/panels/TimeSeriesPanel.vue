<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import TimeseriesWidget from '../widgets/TimeseriesWidget.vue'
import type { TimeSeriesPanelProps } from './types'

const props = withDefaults(defineProps<TimeSeriesPanelProps>(), {
  buckets: () => [],
  series: undefined,
  deploys: () => [],
  thresholds: () => [],
  unit: '',
  seriesName: 'value',
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  loading: false,
  error: null,
  emptyTitle: 'No time-series data',
  emptyMessage: "Try a wider time range or adjust this panel's query.",
})

const hasData = () => Boolean(props.series?.some(series => series.points.length) || props.buckets.length)
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
    :empty="!loading && !error && !hasData()"
    :empty-title="emptyTitle"
    :empty-message="emptyMessage"
    variant="chart"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template v-if="$slots.summary" #summary><slot name="summary" /></template>
    <slot v-if="$slots.default" />
    <TimeseriesWidget
      v-else
      :buckets="buckets"
      :series="series"
      :deploys="deploys"
      :thresholds="thresholds"
      :unit="unit"
      :series-name="seriesName"
    />
    <slot name="details" />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
