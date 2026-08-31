<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  bins: Array<{ key: string; count: number }>
  markers?: Array<{ position: number; label: string; value?: string; color?: string }>
  minLabel?: string
  maxLabel?: string
  color?: string
  unit?: string
}>(), {
  markers: () => [],
  minLabel: '',
  maxLabel: '',
  color: 'var(--purple, #8b5cf6)',
  unit: 'events',
})

const width = 600
const height = 140
const pad = { top: 12, right: 18, bottom: 20, left: 40 }
const plotWidth = width - pad.left - pad.right
const plotHeight = height - pad.top - pad.bottom
const hoveredIndex = ref<number | null>(null)

const maxCount = computed(() => Math.max(...props.bins.map(bin => bin.count), 1))
const bars = computed(() => {
  const step = plotWidth / Math.max(props.bins.length, 1)
  const barWidth = Math.max(1, step - Math.min(5, step * 0.22))
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
    <div class="histogram-plot">
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
        <text
          v-for="tick in yTicks"
          :key="`label-${tick.value}`"
          :x="pad.left - 6"
          :y="tick.y + 3"
          class="histogram-axis"
          text-anchor="end"
        >{{ tick.label }}</text>
        <rect
          v-for="(bar, index) in bars"
          :key="`${bar.key}-${index}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="color"
          :opacity="hoveredIndex === null || hoveredIndex === index ? .84 : .38"
          rx="1.5"
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
        <text :x="pad.left" :y="height - 4" class="histogram-axis" text-anchor="start">{{ minLabel || bins[0]?.key }}</text>
        <text :x="width - pad.right" :y="height - 4" class="histogram-axis" text-anchor="end">{{ maxLabel || bins[bins.length - 1]?.key }}</text>
      </svg>
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
