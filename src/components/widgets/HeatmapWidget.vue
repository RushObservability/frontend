<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TimeDomain } from '../../types'
import { buildHeatmap } from '../../lib/heatmap'

const props = withDefaults(defineProps<{
  series?: Array<{ name: string; points: [number, number][] }>
  timeDomain?: TimeDomain
  unit?: string
}>(), { series: () => [], unit: '' })

const visibleSeries = computed(() => props.series.slice(0, 24))
const heatmap = computed(() => buildHeatmap(visibleSeries.value, props.timeDomain))
const root = ref<HTMLElement | null>(null)
interface ActiveCell { row: number; column: number; left: number; top: number; below: boolean }
const hoveredCell = ref<ActiveCell | null>(null)
const focusedCell = ref<ActiveCell | null>(null)
const activeCell = computed(() => hoveredCell.value ?? focusedCell.value)
const formatTime = (timestamp: number) => new Date(timestamp * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const formatClock = (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const formatValue = (value: number) => `${Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${props.unit ? ` ${props.unit}` : ''}`
const cellTime = (index: number) => heatmap.value.domain.from + index * (heatmap.value.domain.to - heatmap.value.domain.from) / heatmap.value.columns
const cellColor = (value: number | null) => {
  if (value === null) return 'transparent'
  const { min, max } = heatmap.value
  const strength = max === min ? 0.7 : 0.14 + 0.78 * ((value - min) / (max - min))
  return `color-mix(in srgb, var(--blue, #3b82f6) ${Math.round(strength * 100)}%, var(--bg-surface))`
}

const activeInfo = computed(() => {
  const cell = activeCell.value
  const row = cell && heatmap.value.rows[cell.row]
  if (!cell || !row) return null
  const value = row.cells[cell.column] ?? null
  return {
    name: row.name,
    value,
    time: `${formatTime(cellTime(cell.column))}–${formatClock(cellTime(cell.column + 1))}`,
  }
})

function locateCell(event: Event, row: number, column: number): ActiveCell | null {
  const host = root.value
  const target = event.currentTarget as HTMLElement
  if (!host) return null
  const cell = target.getBoundingClientRect()
  const bounds = host.getBoundingClientRect()
  const tooltipWidth = Math.min(224, Math.max(0, bounds.width - 16))
  return {
    row,
    column,
    left: Math.max(8, Math.min(cell.left - bounds.left + cell.width / 2 - tooltipWidth / 2, bounds.width - tooltipWidth - 8)),
    top: cell.top - bounds.top >= 88 ? cell.top - bounds.top - 8 : cell.bottom - bounds.top + 8,
    below: cell.top - bounds.top < 88,
  }
}

function onCellKeydown(event: KeyboardEvent, row: number, column: number) {
  const next = {
    ArrowLeft: [row, column - 1],
    ArrowRight: [row, column + 1],
    ArrowUp: [row - 1, column],
    ArrowDown: [row + 1, column],
  }[event.key]
  if (!next) return
  event.preventDefault()
  const [nextRow, nextColumn] = next
  if (nextRow! < 0 || nextRow! >= heatmap.value.rows.length || nextColumn! < 0 || nextColumn! >= heatmap.value.columns) return
  root.value?.querySelector<HTMLElement>(`.heatmap-cell[data-row="${nextRow}"][data-column="${nextColumn}"]`)?.focus()
}
</script>

<template>
  <div ref="root" class="heatmap-widget" :style="{ '--heatmap-columns': heatmap.columns }">
    <div class="heatmap-scroll" role="grid" aria-label="Heatmap values">
      <div v-for="(row, rowIndex) in heatmap.rows" :key="`${row.name}:${rowIndex}`" class="heatmap-row" :class="{ 'heatmap-row--active': activeCell?.row === rowIndex }" role="row">
        <span class="heatmap-name" role="rowheader" :aria-label="row.name">{{ row.name }}</span>
        <div class="heatmap-cells" role="presentation">
          <span
            v-for="(value, index) in row.cells"
            :key="index"
            class="heatmap-cell"
            :class="{ 'heatmap-cell--missing': value === null, 'heatmap-cell--active': activeCell?.row === rowIndex && activeCell?.column === index }"
            :style="{ background: cellColor(value) }"
            :data-row="rowIndex"
            :data-column="index"
            role="gridcell"
            :tabindex="focusedCell?.row === rowIndex && focusedCell?.column === index || !focusedCell && rowIndex === 0 && index === 0 ? 0 : -1"
            :aria-label="`${row.name}, ${formatTime(cellTime(index))}: ${value === null ? 'no data' : formatValue(value)}`"
            @pointerenter="hoveredCell = locateCell($event, rowIndex, index)"
            @pointerleave="hoveredCell = null"
            @focus="focusedCell = locateCell($event, rowIndex, index)"
            @blur="focusedCell = null"
            @keydown="onCellKeydown($event, rowIndex, index)"
          />
        </div>
      </div>
    </div>
    <Transition name="heatmap-tip">
      <div
        v-if="activeInfo && activeCell"
        class="heatmap-tooltip"
        :class="{ 'heatmap-tooltip--below': activeCell.below }"
        :style="{ left: `${activeCell.left}px`, top: `${activeCell.top}px` }"
        role="tooltip"
      >
        <div class="heatmap-tooltip-heading"><i :style="{ background: cellColor(activeInfo.value) }"></i><strong>{{ activeInfo.name }}</strong></div>
        <div class="heatmap-tooltip-time">{{ activeInfo.time }}</div>
        <div class="heatmap-tooltip-value">{{ activeInfo.value === null ? 'No data' : formatValue(activeInfo.value) }}</div>
      </div>
    </Transition>
    <div class="heatmap-axis"><span>{{ formatTime(heatmap.domain.from) }}</span><span>{{ formatTime((heatmap.domain.from + heatmap.domain.to) / 2) }}</span><span>{{ formatTime(heatmap.domain.to) }}</span></div>
    <div class="heatmap-legend"><span>No data</span><i class="heatmap-legend-empty"></i><span>{{ formatValue(heatmap.min) }}</span><span class="heatmap-legend-scale"><i v-for="step in 5" :key="step" :style="{ background: cellColor(heatmap.min + (heatmap.max - heatmap.min) * (step - 1) / 4) }"></i></span><span>{{ formatValue(heatmap.max) }}</span></div>
    <span v-if="series.length > visibleSeries.length" class="heatmap-overflow">Showing first {{ visibleSeries.length }} of {{ series.length }} series</span>
  </div>
</template>

<style scoped src="../../styles/widgets/HeatmapWidget.css"></style>
