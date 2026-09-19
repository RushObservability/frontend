<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import PieWidget from '../widgets/PieWidget.vue'
import type { PiePanelProps } from './types'
withDefaults(defineProps<PiePanelProps>(), { data: () => ({}), pieStyle: 'donut', calculation: 'last', sort: 'descending', legendPosition: 'right', unit: '' })
</script>

<template>
  <PanelCard :title="title" :description="description" :caption="caption" :source-label="sourceLabel" :range-label="rangeLabel" :loading="loading" :error="error" variant="bar">
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <PieWidget :data="data" :pie-style="pieStyle" :calculation="calculation" :sort="sort" :legend-position="legendPosition" :unit="unit" />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </PanelCard>
</template>
