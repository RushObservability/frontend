<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CountBucket, ExploreCountKind } from '../../types'
import PanelCard from '../PanelCard.vue'

interface TimelineSelection {
  startIndex: number
  endIndex: number
}

const props = withDefaults(defineProps<{
  buckets: CountBucket[]
  total: number
  totalKind?: ExploreCountKind
  signal: 'logs' | 'spans'
  from: string
  to: string
  loading?: boolean
  customRange?: boolean
  selection?: TimelineSelection | null
}>(), {
  totalKind: 'exact',
  loading: false,
  customRange: false,
  selection: null,
})

const emit = defineEmits<{
  rangeSelect: [selection: TimelineSelection & { compare: boolean }]
  resetRange: []
}>()

const plotEl = ref<HTMLElement | null>(null)
const hoveredIndex = ref<number | null>(null)
const dragStart = ref<number | null>(null)
const dragEnd = ref<number | null>(null)
const dragCompare = ref(false)

const title = computed(() => props.signal === 'logs' ? 'Log volume' : 'Trace volume')
const itemLabel = computed(() => props.signal === 'logs' ? 'logs' : 'spans')
const maxCount = computed(() => Math.max(1, ...props.buckets.map(bucket => bucket.count)))
const errorCount = computed(() => props.buckets.reduce((sum, bucket) => sum + (bucket.error_count || 0), 0))
const errorRate = computed(() => props.total > 0 ? (errorCount.value / props.total) * 100 : 0)
const peakBucket = computed(() => props.buckets.reduce<CountBucket | null>(
  (peak, bucket) => !peak || bucket.count > peak.count ? bucket : peak,
  null,
))

const intervalMs = computed(() => {
  if (props.buckets.length < 2) return 60_000
  const first = parseBucket(props.buckets[0]!.bucket).getTime()
  const second = parseBucket(props.buckets[1]!.bucket).getTime()
  return Math.max(1, second - first)
})

const intervalLabel = computed(() => {
  const minutes = Math.round(intervalMs.value / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m bin`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h bin`
})

const formattedTotal = computed(() => {
  const value = props.total.toLocaleString()
  if (props.totalKind === 'capped') return `${value}+`
  if (props.totalKind === 'estimated') return `~${value}`
  return value
})

const rangeLabel = computed(() => {
  const from = new Date(props.from)
  const to = new Date(props.to)
  const durationMs = to.getTime() - from.getTime()
  if (!Number.isFinite(durationMs)) return ''
  if (durationMs < 60 * 60 * 1000) return `${Math.round(durationMs / 60_000)}m`
  if (durationMs < 24 * 60 * 60 * 1000) return `${Math.round(durationMs / 3_600_000)}h`
  return `${Math.round(durationMs / 86_400_000)}d`
})

const yTicks = computed(() => [
  { value: maxCount.value, position: 0 },
  { value: Math.round(maxCount.value / 2), position: 50 },
  { value: 0, position: 100 },
])

const isMultiDay = computed(() => {
  const duration = new Date(props.to).getTime() - new Date(props.from).getTime()
  return duration >= 24 * 60 * 60 * 1000
})

const xTicks = computed(() => {
  const count = props.buckets.length
  if (!count) return []
  const tickCount = Math.min(5, count)
  const seen = new Set<number>()
  return Array.from({ length: tickCount }, (_, position) => {
    const index = Math.round((position / Math.max(tickCount - 1, 1)) * (count - 1))
    if (seen.has(index)) return null
    seen.add(index)
    return {
      index,
      position: (index / Math.max(count - 1, 1)) * 100,
      label: formatBucketTime(props.buckets[index]!.bucket, isMultiDay.value),
    }
  }).filter((tick): tick is NonNullable<typeof tick> => Boolean(tick))
})

const hoveredBucket = computed(() => {
  if (hoveredIndex.value === null) return null
  const bucket = props.buckets[hoveredIndex.value]
  if (!bucket) return null
  const errors = bucket.error_count || 0
  return {
    time: formatBucketTime(bucket.bucket, isMultiDay.value),
    total: bucket.count,
    ok: Math.max(0, bucket.count - errors),
    errors,
    errorRate: bucket.count > 0 ? (errors / bucket.count) * 100 : 0,
  }
})

const activeSelection = computed(() => {
  const start = dragStart.value ?? props.selection?.startIndex
  const end = dragEnd.value ?? props.selection?.endIndex
  if (start === undefined || end === undefined || start === null || end === null || !props.buckets.length) return null
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  const total = props.buckets.length
  return {
    left: (low / total) * 100,
    width: ((high - low + 1) / total) * 100,
    compare: dragStart.value !== null ? dragCompare.value : true,
    from: formatBucketTime(props.buckets[low]!.bucket, isMultiDay.value),
    to: formatBucketTime(props.buckets[high]!.bucket, isMultiDay.value),
  }
})

const chartLabel = computed(() => {
  const errorText = errorCount.value ? `, ${errorCount.value.toLocaleString()} errors` : ', no errors'
  return `${title.value}: ${formattedTotal.value} ${itemLabel.value}${errorText}. Use left and right arrow keys to inspect time buckets.`
})

function parseBucket(bucket: string): Date {
  const hasTimezone = bucket.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(bucket)
  return new Date(hasTimezone ? bucket : `${bucket.replace(' ', 'T')}Z`)
}

function formatBucketTime(bucket: string, includeDate: boolean): string {
  const date = parseBucket(bucket)
  if (!Number.isFinite(date.getTime())) return bucket
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (!includeDate) return time
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day}, ${time}`
}

function compactNumber(value: number): string {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function errorPercent(value: number): string {
  if (value === 0) return '0%'
  if (value < 0.1) return '<0.1%'
  return `${value.toFixed(value < 10 ? 1 : 0)}%`
}

function bucketIndex(event: PointerEvent | MouseEvent): number {
  const plot = plotEl.value
  if (!plot || !props.buckets.length) return 0
  const rect = plot.getBoundingClientRect()
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width - 1))
  return Math.max(0, Math.min(props.buckets.length - 1, Math.floor((x / rect.width) * props.buckets.length)))
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !props.buckets.length) return
  const index = bucketIndex(event)
  dragStart.value = index
  dragEnd.value = index
  dragCompare.value = event.shiftKey
  hoveredIndex.value = index
  plotEl.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const index = bucketIndex(event)
  hoveredIndex.value = index
  if (dragStart.value !== null) dragEnd.value = index
}

function onPointerUp(event: PointerEvent) {
  if (dragStart.value === null || dragEnd.value === null) return
  const startIndex = Math.min(dragStart.value, dragEnd.value)
  const endIndex = Math.max(dragStart.value, dragEnd.value)
  const compare = dragCompare.value
  plotEl.value?.releasePointerCapture(event.pointerId)
  dragStart.value = null
  dragEnd.value = null
  if (startIndex === endIndex) return
  emit('rangeSelect', { startIndex, endIndex, compare })
}

function onPointerCancel(event: PointerEvent) {
  if (plotEl.value?.hasPointerCapture(event.pointerId)) plotEl.value.releasePointerCapture(event.pointerId)
  dragStart.value = null
  dragEnd.value = null
}

function moveKeyboardHover(direction: number) {
  if (!props.buckets.length) return
  const current = hoveredIndex.value ?? (direction > 0 ? -1 : props.buckets.length)
  hoveredIndex.value = Math.max(0, Math.min(props.buckets.length - 1, current + direction))
}

function okHeight(bucket: CountBucket): number {
  if (!bucket.count) return 0
  return Math.max(0, ((bucket.count - (bucket.error_count || 0)) / bucket.count) * 100)
}

function errorHeight(bucket: CountBucket): number {
  if (!bucket.count) return 0
  return Math.max(0, ((bucket.error_count || 0) / bucket.count) * 100)
}
</script>

<template>
  <PanelCard
    class="signal-timeline"
    :title="title"
    :description="`The number of matching ${itemLabel} in each time bucket, with errors called out in red.`"
    :range-label="rangeLabel"
    :loading="loading"
    :empty="!loading && buckets.length === 0"
    empty-title="No activity in this range"
    :empty-message="`Try a wider time range or remove a ${signal === 'logs' ? 'log' : 'trace'} filter.`"
    caption="Drag to zoom. Hold Shift while dragging to compare a window."
    :source-label="signal === 'logs' ? 'Logs' : 'Spans'"
  >
    <template #actions>
      <button v-if="customRange" type="button" class="timeline-reset" @click="emit('resetRange')">
        Reset zoom
      </button>
    </template>

    <template #summary>
      <div class="timeline-summary">
        <div class="timeline-total">
          <strong class="mono">{{ formattedTotal }}</strong>
          <span>{{ itemLabel }}</span>
        </div>
        <div class="timeline-stat">
          <span>Peak</span>
          <strong class="mono">{{ compactNumber(peakBucket?.count || 0) }}</strong>
          <small>{{ intervalLabel }}</small>
        </div>
        <div class="timeline-stat" :class="{ 'timeline-stat--error': errorCount > 0 }">
          <span>Error rate</span>
          <strong class="mono">{{ errorPercent(errorRate) }}</strong>
          <small>{{ errorCount.toLocaleString() }} errors</small>
        </div>
        <div class="timeline-legend" aria-label="Chart legend">
          <span><i class="timeline-key timeline-key--normal" />Normal</span>
          <span><i class="timeline-key timeline-key--error" />Error / 5xx</span>
        </div>
      </div>
    </template>

    <div class="timeline-chart" :aria-label="chartLabel" role="group">
      <div class="timeline-y-axis" aria-hidden="true">
        <span v-for="tick in yTicks" :key="tick.position" :style="{ top: `${tick.position}%` }" class="mono">
          {{ compactNumber(tick.value) }}
        </span>
      </div>

      <div class="timeline-plot-shell">
        <div class="timeline-grid" aria-hidden="true">
          <span v-for="tick in yTicks" :key="tick.position" :style="{ top: `${tick.position}%` }" />
        </div>
        <div
          ref="plotEl"
          class="timeline-bars"
          tabindex="0"
          @pointerdown.prevent="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @pointerleave="dragStart === null && (hoveredIndex = null)"
          @keydown.left.prevent="moveKeyboardHover(-1)"
          @keydown.right.prevent="moveKeyboardHover(1)"
          @keydown.home.prevent="hoveredIndex = 0"
          @keydown.end.prevent="hoveredIndex = buckets.length - 1"
        >
          <div
            v-for="(bucket, index) in buckets"
            :key="bucket.bucket"
            class="timeline-column"
            :class="{ 'timeline-column--active': hoveredIndex === index }"
          >
            <div
              v-if="bucket.count"
              class="timeline-stack"
              :style="{ height: `${Math.max(1.5, (bucket.count / maxCount) * 100)}%` }"
            >
              <span
                v-if="bucket.error_count"
                class="timeline-bar timeline-bar--error"
                :style="{ flexBasis: `${errorHeight(bucket)}%` }"
              />
              <span class="timeline-bar timeline-bar--normal" :style="{ flexBasis: `${okHeight(bucket)}%` }" />
            </div>
          </div>

          <div
            v-if="activeSelection"
            class="timeline-selection"
            :class="{ 'timeline-selection--compare': activeSelection.compare }"
            :style="{ left: `${activeSelection.left}%`, width: `${activeSelection.width}%` }"
          >
            <span class="timeline-selection-label timeline-selection-label--start mono">{{ activeSelection.from }}</span>
            <span class="timeline-selection-label timeline-selection-label--end mono">{{ activeSelection.to }}</span>
          </div>

          <div
            v-if="hoveredIndex !== null && dragStart === null"
            class="timeline-crosshair"
            :style="{ left: `${((hoveredIndex + 0.5) / buckets.length) * 100}%` }"
            aria-hidden="true"
          />

          <div
            v-if="hoveredBucket && hoveredIndex !== null && dragStart === null"
            class="timeline-tooltip"
            :class="{
              'timeline-tooltip--start': hoveredIndex < buckets.length * 0.2,
              'timeline-tooltip--end': hoveredIndex > buckets.length * 0.8,
            }"
            :style="{ left: `${((hoveredIndex + 0.5) / buckets.length) * 100}%` }"
          >
            <div class="timeline-tooltip-time mono">{{ hoveredBucket.time }}</div>
            <div><span>Total</span><strong class="mono">{{ hoveredBucket.total.toLocaleString() }}</strong></div>
            <div><span><i class="timeline-key timeline-key--normal" />Normal</span><strong class="mono">{{ hoveredBucket.ok.toLocaleString() }}</strong></div>
            <div><span><i class="timeline-key timeline-key--error" />Errors</span><strong class="mono timeline-tooltip-error">{{ hoveredBucket.errors.toLocaleString() }}</strong></div>
            <div class="timeline-tooltip-rate"><span>Error rate</span><strong class="mono">{{ errorPercent(hoveredBucket.errorRate) }}</strong></div>
          </div>
        </div>

        <div class="timeline-x-axis" aria-hidden="true">
          <span
            v-for="tick in xTicks"
            :key="tick.index"
            :class="{ 'is-first': tick.index === 0, 'is-last': tick.index === buckets.length - 1 }"
            :style="{ left: `${tick.position}%` }"
            class="mono"
          >{{ tick.label }}</span>
        </div>
      </div>
    </div>
  </PanelCard>
</template>

<style scoped>
.signal-timeline {
  margin-bottom: var(--sp-4);
  box-shadow: 0 1px 2px rgba(16, 24, 40, .025);
}

.signal-timeline :deep(.panel-summary) {
  padding: 11px 16px 10px;
  background: color-mix(in srgb, var(--bg-surface) 97%, var(--amber) 3%);
  border-bottom: 1px solid var(--border-subtle);
}

.signal-timeline :deep(.panel-body) { padding: 12px 16px 8px; }

.timeline-reset {
  min-height: 26px;
  padding: 3px 8px;
  color: var(--amber);
  background: var(--amber-dim);
  border: 1px solid color-mix(in srgb, var(--amber) 35%, var(--border-subtle));
  border-radius: var(--r-sm);
  font: 650 10px var(--font-ui);
  cursor: pointer;
}

.timeline-reset:hover { border-color: var(--amber); }
.timeline-reset:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.timeline-summary {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 22px;
}

.timeline-total {
  display: flex;
  min-width: 130px;
  align-items: baseline;
  gap: 7px;
}

.timeline-total strong {
  color: var(--text-primary);
  font-size: var(--panel-chart-total-size);
  font-weight: 650;
  letter-spacing: -.045em;
  line-height: 1;
}

.timeline-total span,
.timeline-stat > span {
  color: var(--text-muted);
  font-size: var(--panel-chart-label-size);
  font-weight: 650;
  letter-spacing: .055em;
  text-transform: uppercase;
}

.timeline-stat {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 7px;
  row-gap: 1px;
  padding-left: 18px;
  border-left: 1px solid var(--border-subtle);
}

.timeline-stat > span { grid-column: 1 / -1; }
.timeline-stat strong { color: var(--text-primary); font-size: var(--panel-chart-value-size); font-weight: 680; }
.timeline-stat small { color: var(--text-muted); font-size: var(--panel-chart-caption-size); }
.timeline-stat--error strong { color: var(--error); }

.timeline-legend {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 14px;
  color: var(--text-secondary);
  font-size: var(--panel-chart-label-size);
  font-weight: 550;
  white-space: nowrap;
}

.timeline-legend > span,
.timeline-tooltip span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.timeline-key {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 2px;
}

.timeline-key--normal { background: var(--histogram-bar-hover, #3b82f6); }
.timeline-key--error {
  background: repeating-linear-gradient(135deg, var(--error) 0 2px, color-mix(in srgb, var(--error) 55%, white) 2px 4px);
}

.timeline-chart {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  height: 150px;
  min-width: 0;
  user-select: none;
}

.timeline-y-axis {
  position: relative;
  height: 116px;
  color: var(--text-muted);
  font-size: var(--panel-chart-axis-size);
  font-variant-numeric: tabular-nums;
}

.timeline-y-axis span {
  position: absolute;
  right: 9px;
  transform: translateY(-50%);
}

.timeline-y-axis span:first-child { transform: none; }
.timeline-y-axis span:last-child { transform: translateY(-100%); }

.timeline-plot-shell { position: relative; min-width: 0; }

.timeline-bars {
  position: relative;
  display: grid;
  height: 116px;
  min-width: 0;
  grid-auto-flow: column;
  grid-auto-columns: minmax(1px, 1fr);
  align-items: end;
  gap: 1px;
  cursor: crosshair;
  touch-action: none;
  outline: none;
}

.timeline-bars:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--amber) 60%, transparent);
  outline-offset: 3px;
}

.timeline-grid {
  position: absolute;
  right: 0;
  left: 0;
  height: 116px;
  pointer-events: none;
}

.timeline-grid span {
  position: absolute;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--border-subtle);
}

.timeline-grid span:first-child { background: color-mix(in srgb, var(--border-default) 70%, transparent); }

.timeline-column {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100%;
  min-width: 0;
  align-items: flex-end;
}

.timeline-stack {
  display: flex;
  width: 100%;
  min-height: 2px;
  flex-direction: column;
  overflow: hidden;
  border-radius: 2px 2px 0 0;
  transition: filter 90ms ease, opacity 90ms ease;
}

.timeline-bar { display: block; width: 100%; min-height: 0; }
.timeline-bar--normal { background: var(--histogram-bar, #7fb3f5); }
.timeline-bar--error {
  z-index: 1;
  min-height: 2px;
  background: repeating-linear-gradient(135deg, var(--error) 0 2px, color-mix(in srgb, var(--error) 58%, white) 2px 4px);
}

.timeline-column--active .timeline-stack {
  filter: saturate(1.3) contrast(1.08);
  opacity: 1;
}

.timeline-column--active::after {
  position: absolute;
  right: -1px;
  bottom: -4px;
  left: -1px;
  height: 3px;
  background: var(--amber);
  border-radius: 2px;
  content: '';
}

.timeline-crosshair {
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--text-primary) 38%, transparent);
  pointer-events: none;
}

.timeline-selection {
  position: absolute;
  z-index: 4;
  top: -1px;
  bottom: -1px;
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 68%, transparent);
  pointer-events: none;
}

.timeline-selection--compare {
  background: color-mix(in srgb, var(--purple, #8b5cf6) 11%, transparent);
  border-color: color-mix(in srgb, var(--purple, #8b5cf6) 68%, transparent);
}

.timeline-selection-label {
  position: absolute;
  top: 5px;
  padding: 2px 5px;
  color: var(--text-primary);
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: 3px;
  box-shadow: 0 2px 6px rgba(16, 24, 40, .08);
  font-size: var(--panel-chart-axis-size);
  white-space: nowrap;
}

.timeline-selection-label--start { left: 4px; }
.timeline-selection-label--end { right: 4px; }

.timeline-tooltip {
  position: absolute;
  z-index: 8;
  top: 8px;
  width: 164px;
  padding: 9px 10px;
  transform: translateX(-50%);
  color: var(--text-secondary);
  background: var(--bg-overlay);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  box-shadow: 0 10px 28px rgba(16, 24, 40, .16);
  font-size: 10px;
  pointer-events: none;
}

.timeline-tooltip--start { transform: translateX(4px); }
.timeline-tooltip--end { transform: translateX(calc(-100% - 4px)); }

.timeline-tooltip-time {
  padding-bottom: 6px;
  margin-bottom: 5px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 10px;
  font-weight: 650;
}

.timeline-tooltip > div:not(.timeline-tooltip-time) {
  display: flex;
  min-height: 19px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.timeline-tooltip strong { color: var(--text-primary); font-size: 10px; }
.timeline-tooltip .timeline-tooltip-error { color: var(--error); }
.timeline-tooltip-rate { padding-top: 4px; margin-top: 3px; border-top: 1px solid var(--border-subtle); }

.timeline-x-axis {
  position: relative;
  height: 26px;
  color: var(--text-muted);
  border-top: 1px solid var(--border-default);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.timeline-x-axis span {
  position: absolute;
  top: 7px;
  transform: translateX(-50%);
  white-space: nowrap;
}

.timeline-x-axis span::before {
  position: absolute;
  top: -8px;
  left: 50%;
  width: 1px;
  height: 4px;
  background: var(--border-default);
  content: '';
}

.timeline-x-axis .is-first { transform: none; }
.timeline-x-axis .is-first::before { left: 0; }
.timeline-x-axis .is-last { transform: translateX(-100%); }
.timeline-x-axis .is-last::before { left: 100%; }

@container (max-width: 650px) {
  .timeline-summary { gap: 12px; }
  .timeline-stat { padding-left: 12px; }
  .timeline-legend { display: none; }
}

@container (max-width: 430px) {
  .timeline-summary { align-items: flex-start; flex-wrap: wrap; }
  .timeline-total { min-width: 100%; }
  .timeline-stat:first-of-type { padding-left: 0; border-left: 0; }
  .timeline-chart { grid-template-columns: 34px minmax(0, 1fr); }
  .timeline-y-axis span { right: 6px; }
  .timeline-grid { left: 50px; }
  .timeline-x-axis span:nth-child(even) { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .timeline-stack { transition: none; }
}
</style>
