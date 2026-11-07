<script setup lang="ts">
import PanelCard from '../PanelCard.vue'
import LogPatternsWidget from '../widgets/LogPatternsWidget.vue'
import StateTimelineWidget from '../widgets/StateTimelineWidget.vue'
import ScatterWidget from '../widgets/ScatterWidget.vue'
import type { WidgetData, WidgetType } from '../../types'
import { timelineStates } from '../../lib/dashboardPanels'
defineProps<{ title: string; type: WidgetType; data?: WidgetData; config?: Record<string, unknown>; description?: string; caption?: string; sourceLabel?: string; rangeLabel?: string; loading?: boolean; error?: string | null }>()
</script>
<template>
  <PanelCard :title="title" :description="description" :caption="caption" :source-label="sourceLabel" :range-label="rangeLabel" :loading="loading" :error="error"
    :variant="type === 'log-patterns' ? 'table' : 'chart'"
    :empty="!loading && !error && (type === 'log-patterns' ? !data?.patterns?.length : type === 'scatter' ? !data?.scatter_points?.length : !data?.series?.length)"
    empty-title="No panel data" empty-message="Try a wider time range, check the fields, or adjust this panel's filters.">
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <LogPatternsWidget v-if="type === 'log-patterns'" :patterns="data?.patterns || []" :total="data?.pattern_total || 0" :time-domain="data?.time_domain" />
    <StateTimelineWidget v-else-if="type === 'state-timeline' && data?.time_domain" :series="data?.series || []" :time-domain="data.time_domain" :step-secs="data.step_secs" :states="timelineStates(config?.states)" />
    <ScatterWidget v-else-if="type === 'scatter'" :points="data?.scatter_points || []" :x-label="String(config?.x_label || data?.x_field || 'X')" :y-label="String(config?.y_label || data?.y_field || 'Y')" :x-unit="String(config?.x_unit || '')" :y-unit="String(config?.unit || '')" :source="data?.source" :truncated="data?.truncated" :time-domain="data?.time_domain" />
  </PanelCard>
</template>
