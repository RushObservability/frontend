<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { DeployMarker, WidgetData, WidgetType } from '../../types'
import BarPanel from '../panels/BarPanel.vue'
import StatPanel from '../panels/StatPanel.vue'
import TablePanel from '../panels/TablePanel.vue'
import TimeSeriesPanel from '../panels/TimeSeriesPanel.vue'

const props = defineProps<{
  title: string
  type: WidgetType
  description?: string
  caption?: string
  sourceLabel?: string
  rangeLabel?: string
  unit?: string
  data?: WidgetData
  deploys?: DeployMarker[]
  loading?: boolean
  error?: string | null
  editMode?: boolean
}>()

defineEmits<{
  edit: []
  duplicate: []
  remove: []
  dragstart: [e: PointerEvent]
  resizestart: [e: PointerEvent]
}>()

const panelComponent = computed<Component>(() => {
  if (props.type === 'counter') return StatPanel
  if (props.type === 'bar') return BarPanel
  if (props.type === 'table') return TablePanel
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

  if (props.type === 'counter') {
    return {
      ...base,
      value: props.data?.count || 0,
      label: 'Current value',
      unit: props.unit || '',
    }
  }
  if (props.type === 'bar') return { ...base, groups: props.data?.groups || [] }
  if (props.type === 'table') return { ...base, rows: props.data?.rows || [] }
  return {
    ...base,
    buckets: props.data?.buckets || [],
    series: props.data?.series,
    deploys: props.deploys || [],
    unit: props.unit || '',
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
    </component>
    <div
      v-if="editMode"
      class="resize-handle"
      title="Drag to resize"
      @pointerdown.prevent="$emit('resizestart', $event)"
    >&#9698;</div>
  </div>
</template>

<style scoped src="../../styles/widgets/WidgetWrapper.css"></style>
