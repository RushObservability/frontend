<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import CounterWidget from '../widgets/CounterWidget.vue'
import type { StatPanelProps } from './types'

withDefaults(defineProps<StatPanelProps>(), {
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  label: 'Current value',
  unit: '',
  tone: 'default',
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
    variant="stat"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <CounterWidget :value="value" :label="label" :unit="unit" :tone="tone" :precision="precision" />
    <slot name="details" />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
