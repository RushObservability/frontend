<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { DeployMarker, WidgetData, WidgetType } from '../../types'
import type { TimeSeriesPanelProps } from '../panels/types'
import BarPanel from '../panels/BarPanel.vue'
import StatPanel from '../panels/StatPanel.vue'
import TablePanel from '../panels/TablePanel.vue'
import TimeSeriesPanel from '../panels/TimeSeriesPanel.vue'
import HeatmapPanel from '../panels/HeatmapPanel.vue'
import HistogramPanel from '../panels/HistogramPanel.vue'
import PiePanel from '../panels/PiePanel.vue'
import AnalysisPanel from '../panels/AnalysisPanel.vue'
import type { PieStyle, PieCalculation, PieSort } from '../../lib/pie'
import { buildHistogram } from '../../lib/histogram'
import QueryDiagnosis from '../QueryDiagnosis.vue'
import { hasWidgetSamples } from '../../lib/queryDiagnostics'

const props = withDefaults(defineProps<{
  title: string
  type: WidgetType
  displayConfig?: Record<string, unknown>
  description?: string
  caption?: string
  sourceLabel?: string
  rangeLabel?: string
  unit?: string
  histogramBucketCount?: number
  pieStyle?: PieStyle
  pieCalculation?: PieCalculation
  pieSort?: PieSort
  pieLegendPosition?: 'right' | 'bottom'
  displayMode?: TimeSeriesPanelProps['displayMode']
  fill?: boolean | null
  data?: WidgetData
  deploys?: DeployMarker[]
  loading?: boolean
  error?: string | null
  editMode?: boolean
  /** Show "Add to notebook" outside edit mode. */
  notebookable?: boolean
}>(), { fill: null })

defineEmits<{
  edit: []
  duplicate: []
  remove: []
  dragstart: [e: PointerEvent]
  resizestart: [e: PointerEvent]
  'add-to-notebook': []
}>()

const panelComponent = computed<Component>(() => {
  if (['log-patterns', 'state-timeline', 'scatter'].includes(props.type)) return AnalysisPanel
  if (props.type === 'counter') return StatPanel
  if (props.type === 'bar') return BarPanel
  if (props.type === 'table') return TablePanel
  if (props.type === 'heatmap') return HeatmapPanel
  if (props.type === 'histogram') return HistogramPanel
  if (props.type === 'pie') return PiePanel
  return TimeSeriesPanel
})

const panelProps = computed<Record<string, unknown>>(() => {
  const base = {
    title: props.title,
    description: props.description || '',
    caption: props.caption || '',
    sourceLabel: props.sourceLabel || '',
    rangeLabel: props.rangeLabel || '',
    loading: props.loading || false,
    error: props.error || null,
  }

  if (['log-patterns', 'state-timeline', 'scatter'].includes(props.type)) return { ...base, type: props.type, data: props.data, config: props.displayConfig }
  if (props.type === 'counter') {
    return {
      ...base,
      value: props.data?.count || 0,
      label: 'Current value',
      unit: props.unit || '',
    }
  }
  if (props.type === 'bar') return { ...base, groups: props.data?.groups || [] }
  if (props.type === 'pie') return { ...base, data: props.data || {}, pieStyle: props.pieStyle, calculation: props.pieCalculation, sort: props.pieSort, legendPosition: props.pieLegendPosition, unit: props.unit || '' }
  if (props.type === 'table') return { ...base, rows: props.data?.rows || [] }
  if (props.type === 'heatmap') return { ...base, series: props.data?.series || [], timeDomain: props.data?.time_domain, unit: props.unit || '' }
  if (props.type === 'histogram') {
    const distribution = buildHistogram(props.data?.series || [], props.histogramBucketCount)
    return {
      ...base,
      bins: distribution.bins.map(bin => ({ ...bin, key: `${bin.key}${props.unit ? ` ${props.unit}` : ''}` })),
      sampleCount: distribution.sampleCount,
      axisUnit: props.unit || '',
      minLabel: `${distribution.minLabel}${props.unit ? ` ${props.unit}` : ''}`,
      maxLabel: `${distribution.maxLabel}${props.unit ? ` ${props.unit}` : ''}`,
      color: 'var(--blue, #3b82f6)',
      unit: 'samples',
      emptyMessage: 'No numeric samples were returned for this query and time range.',
    }
  }
  return {
    ...base,
    buckets: props.data?.buckets || [],
    series: props.data?.series,
    timeDomain: props.data?.time_domain,
    deploys: props.deploys || [],
    unit: props.unit || '',
    displayMode: props.displayMode,
    fill: props.fill,
  }
})
</script>

<template>
  <div class="widget-wrap" :class="{ 'widget-edit-mode': editMode }">
    <component :is="panelComponent" v-bind="panelProps">
      <template v-if="editMode" #actions>
        <div class="widget-actions">
          <span v-if="type" class="widget-type">{{ type }}</span>
          <div
            class="drag-handle"
            title="Drag to reposition"
            aria-label="Drag panel to reposition"
            @pointerdown.prevent="$emit('dragstart', $event)"
          >⠿</div>
          <button class="widget-btn" title="Edit panel" @click="$emit('edit')"><span class="widget-btn-glyph">✎</span><span class="widget-btn-label">Edit</span></button>
          <button class="widget-btn" title="Duplicate panel" @click="$emit('duplicate')"><span class="widget-btn-glyph">＋</span><span class="widget-btn-label">Clone</span></button>
          <button class="widget-btn widget-btn-danger" title="Remove panel" @click="$emit('remove')"><span class="widget-btn-glyph">×</span><span class="widget-btn-label">Remove</span></button>
        </div>
      </template>
      <template v-else-if="notebookable" #actions>
        <button class="widget-btn widget-notebook-btn" title="Add this panel to an incident notebook" @click="$emit('add-to-notebook')"><span class="widget-btn-glyph" aria-hidden="true">▤</span><span class="widget-btn-label">Add to notebook</span></button>
      </template>
    </component>
    <div v-if="!loading && !error && !hasWidgetSamples(data) && data?.diagnostic_requests?.length" class="widget-diagnostics">
      <QueryDiagnosis v-for="(request, index) in data.diagnostic_requests.slice(0, 3)" :key="index" :request="request" />
    </div>
    <div
      v-if="editMode"
      class="resize-handle"
      title="Drag to resize"
      @pointerdown.prevent="$emit('resizestart', $event)"
    >&#9698;</div>
  </div>
</template>

<style scoped src="../../styles/widgets/WidgetWrapper.css"></style>
<style scoped>
.widget-diagnostics { padding: 0 16px 12px; }
/* Only on hover or focus where there is hover; touch screens always show it. */
@media (hover: hover) {
  .widget-wrap:not(:hover):not(:focus-within) .widget-notebook-btn { opacity: 0; }
}
</style>
