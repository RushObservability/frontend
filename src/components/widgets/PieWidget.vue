<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildPie, formatPieValue, pieSlicePath, type PieData, type PieStyle, type PieCalculation, type PieSort } from '../../lib/pie'
import EmptyState from '../EmptyState.vue'

const props = withDefaults(defineProps<{
  data: PieData
  pieStyle?: PieStyle
  calculation?: PieCalculation
  sort?: PieSort
  legendPosition?: 'right' | 'bottom'
  unit?: string
}>(), { pieStyle: 'donut', calculation: 'last', sort: 'descending', legendPosition: 'right', unit: '' })
const distribution = computed(() => buildPie(props.data, props.calculation, props.sort))
const hovered = ref<string | null>(null)
const pinned = ref<string | null>(null)
const active = computed(() => distribution.value.slices.find(slice => slice.id === (hovered.value ?? pinned.value)))
const segments = computed(() => {
  let angle = -Math.PI / 2
  return distribution.value.slices.map(slice => {
    const end = angle + slice.percent / 100 * Math.PI * 2
    const path = pieSlicePath(angle, end, props.pieStyle === 'pie' ? 0 : 59)
    angle = end
    return { ...slice, path }
  })
})
const sliceCount = computed(() => `${segments.value.length} ${segments.value.length === 1 ? 'slice' : 'slices'}`)
const value = (n: number) => formatPieValue(n, props.unit)
const percent = (n: number) => `${n < 0.1 ? '<0.1' : n.toFixed(1)}%`
function toggle(id: string) { pinned.value = pinned.value === id ? null : id }
</script>

<template>
  <div class="pie-widget" :class="[`pie-widget--${legendPosition}`, { 'pie-widget--empty': !segments.length }]" @keydown.esc="pinned = null; hovered = null">
    <EmptyState v-if="!segments.length" title="No positive values" message="Pie charts need positive values to compare. Try another query or time range." />
    <template v-else>
      <div class="pie-plot">
        <svg class="pie-svg" viewBox="0 0 200 200" role="img" :aria-label="`${pieStyle === 'donut' ? 'Donut' : 'Pie'} chart: ${sliceCount}, total ${value(distribution.total)}`" @pointerleave="hovered = null">
          <path v-for="slice in segments" :key="slice.id" class="pie-slice"
            :d="slice.path" :fill="slice.color" :class="{ 'pie-slice--muted': active && active.id !== slice.id, 'pie-slice--active': active?.id === slice.id }"
            @pointerenter="hovered = slice.id" @click="toggle(slice.id)">
            <title>{{ slice.name }}: {{ value(slice.value) }} · {{ percent(slice.percent) }}</title>
          </path>
        </svg>
        <div v-if="pieStyle === 'donut'" class="pie-center" :title="active?.name || 'Total'">
          <span class="pie-center-label">{{ active?.name || 'Total' }}</span>
          <strong>{{ formatPieValue(active?.value ?? distribution.total) }}</strong>
          <span class="pie-center-unit">{{ active ? percent(active.percent) : (unit || sliceCount) }}</span>
        </div>
      </div>
      <div class="pie-legend" aria-label="Chart legend">
        <div class="pie-legend-heading"><span>Series</span><span>Value</span><span>Share</span></div>
        <div class="pie-legend-rows">
          <button v-for="slice in segments" :key="slice.id" class="pie-legend-row" type="button"
            :class="{ 'pie-legend-row--active': active?.id === slice.id }"
            :aria-label="`Highlight ${slice.name}: ${value(slice.value)}, ${percent(slice.percent)}`"
            :aria-pressed="pinned === slice.id" :title="slice.name"
            @pointerenter="hovered = slice.id" @pointerleave="hovered = null"
            @focus="hovered = slice.id" @blur="hovered = null" @click="toggle(slice.id)">
            <span class="pie-legend-name"><i :style="{ background: slice.color }"></i><span>{{ slice.name }}</span></span>
            <span class="pie-legend-value">{{ value(slice.value) }}</span>
            <span class="pie-legend-percent">{{ percent(slice.percent) }}</span>
          </button>
        </div>
        <div class="pie-legend-total"><span>Total</span><strong>{{ value(distribution.total) }}</strong><span>100%</span></div>
      </div>
    </template>
    <p v-if="distribution.omitted" class="pie-note">{{ distribution.omitted }} negative or non-finite {{ distribution.omitted === 1 ? 'value omitted' : 'values omitted' }}.</p>
  </div>
</template>

<style scoped src="../../styles/widgets/PieWidget.css"></style>
