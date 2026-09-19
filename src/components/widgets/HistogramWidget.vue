<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { histogramAxisTicks, type HistogramBin } from '../../lib/histogram'

const props = withDefaults(defineProps<{
  bins: HistogramBin[]
  markers?: Array<{ position: number; label: string; value?: string; color?: string }>
  minLabel?: string
  maxLabel?: string
  color?: string
  unit?: string
  axisUnit?: string
}>(), {
  markers: () => [],
  minLabel: '',
  maxLabel: '',
  color: 'var(--purple, #8b5cf6)',
  unit: 'events',
  axisUnit: '',
})

const width = 600
const height = 140
const pad = { top: 12, right: 42, bottom: 20, left: 40 }
const plotWidth = width - pad.left - pad.right
const plotHeight = height - pad.top - pad.bottom
const hoveredIndex = ref<number | null>(null)
const plotEl = ref<HTMLElement | null>(null)
const measuredWidth = ref(width)
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  if (!plotEl.value) return
  measuredWidth.value = plotEl.value.getBoundingClientRect().width
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) measuredWidth.value = entry.contentRect.width
  })
  resizeObserver.observe(plotEl.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const xTicks = computed(() => {
  const numeric = histogramAxisTicks(props.bins, measuredWidth.value * plotWidth / width, props.axisUnit)
  if (numeric.length) return numeric
  if (!props.bins.length) return []
  return [
    { position: 0, label: props.minLabel || props.bins[0]!.key },
    { position: 1, label: props.maxLabel || props.bins[props.bins.length - 1]!.key },
  ]
})
const numericBins = computed(() => props.bins.length > 0 && props.bins.every(bin => Number.isFinite(bin.lower) && Number.isFinite(bin.upper)))

const maxCount = computed(() => Math.max(...props.bins.map(bin => bin.count), 1))
const bars = computed(() => {
  const step = plotWidth / Math.max(props.bins.length, 1)
  const barWidth = numericBins.value ? step : Math.max(1, step - Math.min(5, step * 0.22))
  return props.bins.map((bin, index) => {
    const barHeight = (bin.count / maxCount.value) * plotHeight
    return {
      ...bin,
      x: pad.left + index * step + (step - barWidth) / 2,
      y: pad.top + plotHeight - barHeight,
      width: barWidth,
      height: Math.max(0, barHeight),
    }
  })
})
const yTicks = computed(() => [0, maxCount.value / 2, maxCount.value].map(value => ({
  value,
  y: pad.top + plotHeight - (value / maxCount.value) * plotHeight,
  label: formatCount(value),
})))
const markerLines = computed(() => props.markers.map(marker => ({
  ...marker,
  x: pad.left + Math.max(0, Math.min(1, marker.position)) * plotWidth,
  color: marker.color || 'var(--text-secondary)',
})))
const hovered = computed(() => hoveredIndex.value === null ? null : bars.value[hoveredIndex.value] ?? null)
const tooltipLeft = computed(() => {
  if (!hovered.value) return '50%'
  return `${((hovered.value.x + hovered.value.width / 2) / width) * 100}%`
})

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return Math.round(value).toLocaleString()
}

function onPointerMove(event: PointerEvent) {
  if (!props.bins.length) return
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width
  const position = (x - pad.left) / plotWidth
  hoveredIndex.value = Math.max(0, Math.min(props.bins.length - 1, Math.floor(position * props.bins.length)))
}
</script>

<template>
  <div class="histogram-widget">
    <div ref="plotEl" class="histogram-plot">
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        preserveAspectRatio="none"
        class="histogram-svg"
        @pointermove="onPointerMove"
        @pointerleave="hoveredIndex = null"
      >
        <line
          v-for="tick in yTicks"
          :key="tick.value"
          :x1="pad.left"
          :y1="tick.y"
          :x2="width - pad.right"
          :y2="tick.y"
          class="histogram-grid"
        />
        <line
          v-for="tick in xTicks"
          :key="`grid-x-${tick.position}`"
          :x1="pad.left + tick.position * plotWidth"
          :x2="pad.left + tick.position * plotWidth"
          :y1="pad.top"
          :y2="pad.top + plotHeight"
          class="histogram-grid histogram-grid--vertical"
        />
        <rect
          v-for="(bar, index) in bars"
          :key="`${bar.key}-${index}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="color"
          :opacity="hoveredIndex === null || hoveredIndex === index ? .84 : .38"
          :rx="numericBins ? 0 : 1.5"
        />
        <g v-for="marker in markerLines" :key="marker.label">
          <line
            :x1="marker.x"
            :x2="marker.x"
            :y1="pad.top"
            :y2="pad.top + plotHeight"
            :stroke="marker.color"
            stroke-width="1"
            stroke-dasharray="4 3"
            vector-effect="non-scaling-stroke"
          />
        </g>
      </svg>
      <!-- Match time-series axes without stretching glyphs with the SVG geometry. -->
      <div class="histogram-axis-layer" aria-hidden="true">
        <span
          v-for="tick in yTicks"
          :key="`label-${tick.value}`"
          class="histogram-axis histogram-axis--left"
          :style="{ left: `${((pad.left - 6) / width) * 100}%`, top: `${(tick.y / height) * 100}%` }"
        >{{ tick.label }}</span>
        <span
          v-for="tick in xTicks"
          :key="`label-x-${tick.position}`"
          class="histogram-axis histogram-axis--bottom"
          :class="{ 'histogram-axis--start': tick.position === 0, 'histogram-axis--end': tick.position === 1 }"
          :style="{ left: `${((pad.left + tick.position * plotWidth) / width) * 100}%` }"
        >{{ tick.label }}</span>
      </div>
      <div v-if="hovered" class="histogram-tooltip" :class="{ 'histogram-tooltip--flip': hoveredIndex !== null && hoveredIndex >= bins.length / 2 }" :style="{ left: tooltipLeft }">
        <span class="histogram-tooltip-key">{{ hovered.key }}</span>
        <strong>{{ hovered.count.toLocaleString() }} {{ unit }}</strong>
      </div>
    </div>
    <div v-if="markerLines.length" class="histogram-legend">
      <span v-for="marker in markerLines" :key="`legend-${marker.label}`" class="histogram-legend-item">
        <span class="histogram-legend-line" :style="{ background: marker.color }"></span>
        {{ marker.label }}<b v-if="marker.value">{{ marker.value }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/HistogramWidget.css"></style>
