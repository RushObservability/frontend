<script lang="ts">
// Module-scoped counter → a stable, unique id per TimeseriesWidget instance.
let chartIdSeq = 0
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CountBucket, DeployMarker, TimeDomain } from '../../types'
import type { TimeSeriesPanelSeries } from '../panels/types'
import { straightLinePath, straightAreaPath, straightBandPath, fmtAxis, resolveTimeDomain, type Pt } from '../../lib/chart'
import { useChartHover } from '../../composables/useChartHover'
import EmptyState from '../EmptyState.vue'
import { stackTimeSeries } from '../../lib/stackedTimeBars'
import { stackTimeLines } from '../../lib/stackedTimeLines'
import { parseUtcTimestamp } from '../../lib/utcTimestamp'

const props = withDefaults(defineProps<{
  displayMode?: 'lines' | 'stacked-lines' | 'stacked-bars'
  /** Defaults to the existing single-series area treatment when omitted. */
  fill?: boolean | null
  bucketSeconds?: number
  buckets: CountBucket[]
  deploys?: DeployMarker[]
  /** Multi-series mode (PromQL/metrics source). When present, takes precedence over buckets. */
  series?: TimeSeriesPanelSeries[]
  /** Requested query bounds. Data may occupy only part of this window. */
  timeDomain?: TimeDomain
  /** Optional horizontal reference lines (e.g. monitor alert thresholds). */
  thresholds?: Array<{ value: number; color: string; label: string }>
  /** Optional unit suffix for axis labels, the legend last-value, and the tooltip. */
  unit?: string
  /** Label for the single-series legend entry (defaults to "value"). */
  seriesName?: string
  linkedReadout?: boolean
  zoomable?: boolean
}>(), { fill: null })

const emit = defineEmits<{ rangeSelect: [range: TimeDomain] }>()

// Distinct line colors for split/grouped series. The palette is intentionally
// longer than the editor's query palette because a single APM or PromQL query
// can fan out into many lines. Index-based assignment is shared by paths,
// legend, and hover details so every series keeps one visual identity.
const SERIES_COLORS = [
  '#3b82f6', '#e5584f', '#47b881', '#8b5cf6',
  '#d97706', '#db2777', '#0891b2', '#65a30d',
  '#f97316', '#6366f1', '#0f766e', '#be123c',
]
const seriesMode = computed(() => props.series !== undefined)
const hasSamples = computed(() => (
  seriesMode.value
    ? Boolean(props.series?.some(series => series.points.length))
    : props.buckets.length > 0
))

// Append the unit suffix to a formatted number (axis ticks, legend, tooltip).
// A leading "%" sticks to the number; everything else gets a thin space.
const unitSuffix = computed(() => (props.unit ? props.unit.trim() : ''))
function withUnit(formatted: string): string {
  const u = unitSuffix.value
  if (!u) return formatted
  return u === '%' ? `${formatted}%` : `${formatted} ${u}`
}
function fmtAxisU(n: number): string {
  return withUnit(fmtAxis(n))
}

const plotElement = ref<HTMLElement | null>(null)
const svgWidth = ref(600)
const svgHeight = 140
const padTop = 12
const padBottom = 20
const padLeft = 60
const padRight = 58

const plotWidth = computed(() => svgWidth.value - padLeft - padRight)
const plotHeight = svgHeight - padTop - padBottom

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  if (!plotElement.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0) svgWidth.value = Math.max(140, entry.contentRect.width)
  })
  resizeObserver.observe(plotElement.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const maxCount = computed(() =>
  props.buckets.reduce((max, b) => Math.max(max, b.count), 1)
)

const bucketSamples = computed(() => props.buckets.flatMap((bucket) => {
  const time = parseUtcTimestamp(bucket.bucket) / 1000
  return Number.isFinite(time) ? [[time, bucket.count] as [number, number]] : []
}))

const bucketBounds = computed(() => {
  const points = bucketSamples.value
  return resolveTimeDomain(
    points.length ? points[0]![0] : Infinity,
    points.length ? points[points.length - 1]![0] : -Infinity,
    props.timeDomain,
  )
})

const seriesPoints = computed<Pt[]>(() => {
  const { from, to } = bucketBounds.value
  const span = to - from
  return bucketSamples.value.map(([time, count]) => [
    padLeft + ((time - from) / span) * plotWidth.value,
    padTop + plotHeight - (count / maxCount.value) * plotHeight,
  ] as Pt)
})

const linePath = computed(() => straightLinePath(seriesPoints.value))
const areaPath = computed(() => straightAreaPath(seriesPoints.value, padTop + plotHeight))

const yTicks = computed(() => {
  const max = maxCount.value
  const ticks = [0, Math.round(max / 2), max]
  return ticks.map(v => ({
    value: v,
    y: padTop + plotHeight - (v / max) * plotHeight,
    label: fmtAxisU(v),
  }))
})

const xLabels = computed(() => {
  const { from, to } = bucketBounds.value
  return timeAxisLabels(from, to)
})

// ── Multi-series (metrics) geometry ──
const stackedMode = computed(() => props.displayMode === 'stacked-bars')
const stackedLinesMode = computed(() => props.displayMode === 'stacked-lines' && seriesMode.value)
const showFill = computed(() => !stackedMode.value && (props.fill ?? (stackedLinesMode.value || !seriesMode.value)))
const stacks = computed(() => stackedMode.value
  ? stackTimeSeries((props.series || []).map(series => series.barOverlay ? { ...series, points: [] } : series))
  : [])
const stackedLineLayers = computed(() => stackedLinesMode.value ? stackTimeLines(props.series || []) : [])
const barInterval = computed(() => {
  if (props.bucketSeconds && props.bucketSeconds > 0) return props.bucketSeconds
  const times = [...new Set(stacks.value.map(bar => bar.time))].sort((a, b) => a - b)
  return times.length > 1 ? Math.min(...times.slice(1).map((t, i) => t - times[i]!)) : 60
})
const seriesBounds = computed(() => {
  let minT = Infinity, maxT = -Infinity, maxLeft = 0, maxRight = 0
  for (const s of props.series || []) {
    for (const [t, v] of s.points) {
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      if (t < minT) minT = t
      if (t > maxT) maxT = t
      if (s.axis === 'right') maxRight = Math.max(maxRight, v)
      else maxLeft = Math.max(maxLeft, v)
    }
  }
  if (stackedMode.value) {
    for (const bar of stacks.value) {
      if (bar.axis === 'right') maxRight = Math.max(maxRight, bar.top)
      else maxLeft = Math.max(maxLeft, bar.top)
    }
    maxT += barInterval.value
  }
  if (stackedLinesMode.value) {
    maxLeft = 0
    maxRight = 0
    for (const layer of stackedLineLayers.value) {
      for (const segment of layer.segments) {
        for (const point of segment) {
          if (layer.axis === 'right') maxRight = Math.max(maxRight, point.top)
          else maxLeft = Math.max(maxLeft, point.top)
        }
      }
    }
  }
  // Extend the range so threshold lines stay on-chart even above the data peak.
  for (const th of props.thresholds || []) if (th.value > maxLeft) maxLeft = th.value
  const domain = resolveTimeDomain(minT, maxT, props.timeDomain)
  return {
    minT: domain.from,
    maxT: domain.to,
    maxLeft: maxLeft || 1,
    maxRight: maxRight || 1,
    hasRight: (props.series || []).some(series => series.axis === 'right'),
  }
})

// Threshold reference lines (mapped to the active Y scale).
const thresholdLines = computed(() => {
  const ths = props.thresholds || []
  if (!ths.length) return []
  const maxV = seriesMode.value ? seriesBounds.value.maxLeft : maxCount.value
  return ths.map(th => ({
    y: padTop + plotHeight - (th.value / maxV) * plotHeight,
    color: th.color,
    label: th.label,
  }))
})

const seriesPaths = computed(() => {
  if (!seriesMode.value) return []
  const { minT, maxT, maxLeft, maxRight } = seriesBounds.value
  const span = maxT - minT || 1
  if (stackedLinesMode.value) {
    return stackedLineLayers.value.flatMap(layer => {
      const series = props.series![layer.seriesIndex]!
      const axisMax = layer.axis === 'right' ? maxRight : maxLeft
      return layer.segments.map(segment => {
        const top: Pt[] = segment.map(point => [
          padLeft + ((point.time - minT) / span) * plotWidth.value,
          padTop + plotHeight - (point.top / axisMax) * plotHeight,
        ])
        const bottom: Pt[] = segment.map(point => [
          padLeft + ((point.time - minT) / span) * plotWidth.value,
          padTop + plotHeight - (point.bottom / axisMax) * plotHeight,
        ])
        return {
          d: straightLinePath(top),
          point: top.length === 1 ? top[0] : undefined,
          area: straightBandPath(top, bottom),
          color: series.color || SERIES_COLORS[layer.seriesIndex % SERIES_COLORS.length]!,
          name: series.name,
          axis: layer.axis,
          lineStyle: series.lineStyle || 'solid',
          opacity: series.opacity ?? 1,
        }
      })
    })
  }
  return (props.series || []).flatMap((s, i) => {
    if (stackedMode.value && !s.barOverlay) return []
    const axisMax = s.axis === 'right' ? maxRight : maxLeft
    const segments: Pt[][] = []
    let segment: Pt[] | undefined
    let previousTime = -Infinity
    for (const [time, value] of s.points) {
      if (!Number.isFinite(time) || !Number.isFinite(value)) {
        segment = undefined
        continue
      }
      if (!segment || (props.bucketSeconds && time - previousTime > props.bucketSeconds * 1.01)) {
        segment = []
        segments.push(segment)
      }
      segment.push([
        padLeft + ((time - minT) / span) * plotWidth.value,
        padTop + plotHeight - (value / axisMax) * plotHeight,
      ])
      previousTime = time
    }
    return segments.map(points => ({
      d: straightLinePath(points),
      area: straightAreaPath(points, padTop + plotHeight),
      point: points.length === 1 ? points[0] : undefined,
      color: s.color || SERIES_COLORS[i % SERIES_COLORS.length]!,
      name: s.name,
      axis: s.axis || 'left',
      lineStyle: s.lineStyle || 'solid',
      opacity: s.opacity ?? 1,
    }))
  })
})

const stackedBars = computed(() => {
  const { minT, maxT, maxLeft, maxRight } = seriesBounds.value
  const span = maxT - minT || 1
  return stacks.value.flatMap(bar => {
    const start = Math.max(minT, bar.time)
    const end = Math.min(maxT, bar.time + barInterval.value)
    if (end <= start || bar.value === 0) return []
    const width = (end - start) / span * plotWidth.value
    const gap = Math.min(1.5, width * .15)
    const max = bar.axis === 'right' ? maxRight : maxLeft
    const series = props.series![bar.seriesIndex]!
    return [{
      ...bar,
      x: padLeft + (start - minT) / span * plotWidth.value + gap / 2,
      y: padTop + plotHeight - bar.top / max * plotHeight,
      width: width - gap,
      height: bar.value / max * plotHeight,
      color: series.color || SERIES_COLORS[bar.seriesIndex % SERIES_COLORS.length]!,
      name: series.name,
    }]
  })
})

const seriesYTicks = computed(() => {
  const max = seriesBounds.value.maxLeft
  return [0, max / 2, max].map(v => ({
    value: v,
    y: padTop + plotHeight - (v / max) * plotHeight,
    label: fmtAxisU(v),
  }))
})

const seriesRightYTicks = computed(() => {
  if (!seriesBounds.value.hasRight) return []
  const max = seriesBounds.value.maxRight
  return [0, max / 2, max].map(v => ({
    value: v,
    y: padTop + plotHeight - (v / max) * plotHeight,
    label: withUnit(fmtAxis(v)),
  }))
})

const seriesXLabels = computed(() => {
  const { minT, maxT } = seriesBounds.value
  return timeAxisLabels(minT, maxT)
})

function timeAxisLabels(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const span = to - from
  const intervals = plotWidth.value >= 560 ? 4 : plotWidth.value >= 200 ? 2 : 1
  return Array.from({ length: intervals + 1 }, (_, index) => ({
    x: padLeft + (index / intervals) * plotWidth.value,
    label: formatTimeTick(from + (index / intervals) * span, span, span / intervals < 60),
  }))
}

function formatTimeTick(epochSeconds: number, spanSeconds: number, includeSeconds: boolean): string {
  const date = new Date(epochSeconds * 1000)
  if (spanSeconds >= 2 * 86_400) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  if (spanSeconds >= 86_400) {
    const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `${day} ${formatClock(date, false)}`
  }
  return formatClock(date, includeSeconds)
}

function formatClock(date: Date, includeSeconds: boolean): string {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return includeSeconds ? `${time}:${String(date.getSeconds()).padStart(2, '0')}` : time
}

const visibleYTicks = computed(() => seriesMode.value ? seriesYTicks.value : yTicks.value)
const visibleXTicks = computed(() => seriesMode.value ? seriesXLabels.value : xLabels.value)

const deployLines = computed(() => {
  if (!props.deploys || props.deploys.length === 0) return []
  const firstTime = seriesMode.value
    ? seriesBounds.value.minT * 1000
    : bucketBounds.value.from * 1000
  const lastTime = seriesMode.value
    ? seriesBounds.value.maxT * 1000
    : bucketBounds.value.to * 1000
  const range = lastTime - firstTime
  if (!Number.isFinite(range) || range <= 0) return []
  return props.deploys
    .map(d => {
      const t = new Date(d.deployed_at).getTime()
      const ratio = (t - firstTime) / range
      if (ratio < 0 || ratio > 1) return null
      return {
        x: padLeft + ratio * plotWidth.value,
        label: d.version || d.service_name,
      }
    })
    .filter(Boolean) as Array<{ x: number; label: string }>
})

// ═══ Shared crosshair + tooltip ═══════════════════════════════════════════
// A page-shared hover time (epoch seconds) keeps a vertical line aligned to the
// same timestamp on every chart; each chart reads off its own value there.
const hover = useChartHover()
// Stable per-instance id so only the chart under the cursor shows its tooltip
// (the crosshair still draws on every chart at the shared time).
const chartId = `ts-${++chartIdSeq}`

interface HSeries { name: string; color: string; pts: [number, number][]; legendValue?: number }
// Unified [time, value] model so hover works the same in both render modes.
const hoverModel = computed<{ minT: number; maxT: number; series: HSeries[] }>(() => {
  if (seriesMode.value) {
    const series: HSeries[] = (props.series || []).map((s, i) => ({
      name: s.name,
      color: s.color || SERIES_COLORS[i % SERIES_COLORS.length]!,
      pts: s.points,
      legendValue: s.legendValue,
    }))
    const { minT, maxT } = seriesBounds.value
    return { minT, maxT, series }
  }
  const pts: [number, number][] = []
  for (const b of props.buckets) {
    const t = parseUtcTimestamp(b.bucket) / 1000
    if (!isNaN(t)) pts.push([t, b.count])
  }
  const domain = resolveTimeDomain(
    pts.length ? pts[0]![0] : Infinity,
    pts.length ? pts[pts.length - 1]![0] : -Infinity,
    props.timeDomain,
  )
  return {
    minT: domain.from,
    maxT: domain.to,
    series: pts.length ? [{ name: props.seriesName || 'value', color: 'var(--amber)', pts }] : [],
  }
})

// ── Always-on compact legend (single- and multi-series) ──
// Each entry: ● name  lastValue<unit>, using the same colors as the lines.
const legendItems = computed(() => {
  return hoverModel.value.series.map((s) => {
    const last = s.legendValue ?? (s.pts.length ? s.pts[s.pts.length - 1]![1] : null)
    return {
      name: s.name,
      color: s.color,
      last: last == null ? '' : fmtAxisU(last),
    }
  })
})

// Plot box as fractions of the full SVG (the SVG fills .ts-plot 1:1).
const plotLeftFrac = computed(() => padLeft / svgWidth.value)
const plotSpanFrac = computed(() => plotWidth.value / svgWidth.value)
const plotTopPct = (padTop / svgHeight) * 100
const plotHeightPct = (plotHeight / svgHeight) * 100

// Where the shared hover time falls within this chart's domain (0..1), or null
// when out of range / no hover — so charts that don't cover that time hide it.
const hoverP = computed(() => {
  const t = hover.time.value
  const { minT, maxT } = hoverModel.value
  if (t == null || !isFinite(minT) || maxT <= minT) return null
  const p = (t - minT) / (maxT - minT)
  if (p < -0.02 || p > 1.02) return null
  return Math.max(0, Math.min(1, p))
})

const crosshairLeftPct = computed(() =>
  hoverP.value == null ? null : (plotLeftFrac.value + hoverP.value * plotSpanFrac.value) * 100
)

const samples = computed(() => hoverModel.value.series.map(series =>
  new Map(series.pts.filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value))),
))
const sampleTimes = computed(() => {
  const { minT, maxT } = hoverModel.value
  return [...new Set(samples.value.flatMap(series => [...series.keys()]))]
    .filter(time => time >= minT && time <= maxT)
    .sort((a, b) => a - b)
})

const readout = computed(() => {
  const time = hover.time.value
  if (time == null || hoverP.value == null || !(props.linkedReadout || hover.activeId.value === chartId)) return null
  const date = new Date(time * 1000)
  const { minT, maxT } = hoverModel.value
  const clock = formatClock(date, true)
  const label = maxT - minT >= 86_400
    ? `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`
    : clock
  return { label, values: samples.value.map(series => series.get(time)) }
})

const markers = computed(() => {
  if (!readout.value || stackedMode.value || stackedLinesMode.value) return []
  const { maxLeft, maxRight } = seriesBounds.value
  return readout.value.values.flatMap((value, i) => {
    if (value == null) return []
    const max = !seriesMode.value ? maxCount.value : props.series?.[i]?.axis === 'right' ? maxRight : maxLeft
    return [{
      color: hoverModel.value.series[i]!.color,
      top: (padTop + plotHeight * (1 - value / max)) / svgHeight * 100,
    }]
  })
})

const drag = ref<{ pointerId: number; start: number; end: number; clientX: number } | null>(null)

function pointerRatio(event: PointerEvent): number {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = ((event.clientX - rect.left) / (rect.width || 1) - plotLeftFrac.value) / plotSpanFrac.value
  return Math.max(0, Math.min(1, ratio))
}

function timeAt(ratio: number) {
  const { minT, maxT } = hoverModel.value
  return minT + ratio * (maxT - minT)
}

function onHover(event: PointerEvent) {
  const ratio = pointerRatio(event)
  if (drag.value) {
    if (event.pointerId === drag.value.pointerId) drag.value.end = ratio
    return
  }
  const time = timeAt(ratio)
  const times = sampleTimes.value
  const first = times[0]
  const last = times[times.length - 1]
  if (first == null || last == null) return
  let low = 0
  let high = times.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (times[mid]! < time) low = mid + 1
    else high = mid
  }
  const next = times[low]!
  const previous = times[low - 1]
  if (stackedMode.value) {
    const bucket = next <= time ? next : previous
    hover.set(bucket != null && time < bucket + barInterval.value ? bucket : time, chartId)
    return
  }
  const nearest = previous != null && time - previous < next - time ? previous : next
  const canSnap = props.bucketSeconds
    ? Math.abs(time - nearest) <= props.bucketSeconds / 2
    : time >= first && time <= last
  hover.set(canSnap ? nearest : time, chartId)
}

function onLeave() {
  if (hover.activeId.value === chartId) hover.set(null)
}
onBeforeUnmount(onLeave)

function onInspectKey(event: KeyboardEvent) {
  const times = sampleTimes.value
  if (!times.length) return
  const current = hover.time.value
  const first = times[0]!
  const last = times[times.length - 1]!
  switch (event.key) {
    case 'Home': hover.set(first, chartId); break
    case 'End': hover.set(last, chartId); break
    case 'ArrowLeft': hover.set(current == null ? last : [...times].reverse().find(time => time < current) ?? first, chartId); break
    case 'ArrowRight': hover.set(current == null ? first : times.find(time => time > current) ?? last, chartId); break
    case 'Escape':
      if (hover.activeId.value !== chartId) return
      onLeave()
      break
    default: return
  }
  event.preventDefault()
  event.stopPropagation()
}

function startZoom(event: PointerEvent) {
  if (!props.zoomable || !event.isPrimary || event.button !== 0 || !hasSamples.value) return
  const start = pointerRatio(event)
  drag.value = { pointerId: event.pointerId, start, end: start, clientX: event.clientX }
  onLeave()
  const plot = event.currentTarget as HTMLElement
  plot.setPointerCapture(event.pointerId)
}

function finishZoom(event: PointerEvent) {
  const selection = drag.value
  if (!selection || event.pointerId !== selection.pointerId) return
  drag.value = null
  const end = pointerRatio(event)
  const from = timeAt(Math.min(selection.start, end))
  const to = timeAt(Math.max(selection.start, end))
  if (Math.abs(event.clientX - selection.clientX) >= 8 && to > from) {
    emit('rangeSelect', { from, to })
  } else onHover(event)
}

function cancelZoom(event: PointerEvent) {
  if (drag.value?.pointerId === event.pointerId) drag.value = null
}
</script>

<template>
  <div class="ts-widget" @pointerleave="onLeave">
    <div
      ref="plotElement"
      class="ts-plot"
      :tabindex="hasSamples ? 0 : undefined"
      :role="hasSamples ? 'group' : undefined"
      :aria-label="hasSamples ? 'Chart. Use arrow keys to inspect samples.' : undefined"
      @pointermove="onHover"
      @pointerdown="startZoom"
      @pointerup="finishZoom"
      @pointercancel="cancelZoom"
      @lostpointercapture="cancelZoom"
      @keydown="onInspectKey"
      @blur="onLeave"
    >
      <!-- ── Multi-series (metrics/PromQL) mode ── -->
      <svg v-if="seriesMode" :viewBox="`0 0 ${svgWidth} ${svgHeight}`" preserveAspectRatio="none" class="ch-svg ch-animate ts-svg" aria-hidden="true">
        <line v-for="tick in seriesYTicks" :key="'sy' + tick.value" :x1="padLeft" :y1="tick.y" :x2="svgWidth - padRight" :y2="tick.y" :class="['ch-grid', { 'ch-grid--baseline': tick.value === 0 }]" />
        <line v-for="xl in seriesXLabels" :key="'sv' + xl.x" :x1="xl.x" :y1="padTop" :x2="xl.x" :y2="padTop + plotHeight" class="ch-grid" />
        <rect
          v-for="bar in stackedBars"
          :key="`${bar.seriesIndex}:${bar.time}`"
          :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height"
          :fill="bar.color"
          class="ts-stacked-bar"
        ><title>{{ bar.name }}: {{ fmtAxisU(bar.value) }}</title></rect>
        <path
          v-for="(sp, i) in showFill ? seriesPaths : []"
          :key="'area' + i"
          :d="sp.area"
          :class="['ch-area', { 'ts-stacked-area': stackedLinesMode }]"
          :style="{ color: sp.color, opacity: sp.opacity }"
        />
        <path
          v-for="(sp, i) in seriesPaths"
          :key="'sp' + i"
          :d="sp.d"
          class="ch-line ts-line"
          :stroke-dasharray="sp.lineStyle === 'dashed' ? '4 3' : undefined"
          :style="{ color: sp.color, opacity: sp.opacity }"
        />
        <template v-for="(sp, i) in seriesPaths" :key="'point' + i">
          <path v-if="sp.point" :d="`M${sp.point[0]},${sp.point[1]}h0`"
            :stroke="sp.color" :opacity="sp.opacity"
            stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </template>
        <!-- Threshold reference lines -->
        <g v-for="(th, i) in thresholdLines" :key="'th' + i">
          <line :x1="padLeft" :y1="th.y" :x2="svgWidth - padRight" :y2="th.y" :stroke="th.color" stroke-width="1" stroke-dasharray="5,4" vector-effect="non-scaling-stroke" />
        </g>
        <g v-for="(dl, i) in deployLines" :key="'sd' + i">
          <line
            :x1="dl.x" :y1="padTop"
            :x2="dl.x" :y2="padTop + plotHeight"
            class="deploy-line"
          />
        </g>
      </svg>

      <!-- ── Single-series (spans count) mode ── -->
      <svg v-if="!seriesMode" :viewBox="`0 0 ${svgWidth} ${svgHeight}`" preserveAspectRatio="none" class="ch-svg ch-animate ts-svg" aria-hidden="true">
        <!-- Y grid lines -->
        <line
          v-for="tick in yTicks"
          :key="tick.value"
          :x1="padLeft" :y1="tick.y"
          :x2="svgWidth - padRight" :y2="tick.y"
          :class="['ch-grid', { 'ch-grid--baseline': tick.value === 0 }]"
        />
        <!-- Vertical grid lines (Grafana-style full grid) -->
        <line
          v-for="xl in xLabels"
          :key="'v' + xl.label"
          :x1="xl.x" :y1="padTop"
          :x2="xl.x" :y2="padTop + plotHeight"
          class="ch-grid"
        />
        <!-- Area fill + line -->
        <path v-if="showFill && areaPath" :d="areaPath" class="ch-area" style="color: var(--amber)" />
        <path v-if="linePath" :d="linePath" class="ch-line ts-line" style="color: var(--amber)" />
        <path v-if="seriesPoints.length === 1" :d="linePath + 'h0'" stroke="var(--amber)"
          stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        <!-- Threshold reference lines -->
        <g v-for="(th, i) in thresholdLines" :key="'th' + i">
          <line :x1="padLeft" :y1="th.y" :x2="svgWidth - padRight" :y2="th.y" :stroke="th.color" stroke-width="1" stroke-dasharray="5,4" vector-effect="non-scaling-stroke" />
        </g>
        <!-- Deploy markers -->
        <g v-for="(dl, i) in deployLines" :key="'d' + i">
          <line
            :x1="dl.x" :y1="padTop"
            :x2="dl.x" :y2="padTop + plotHeight"
            class="deploy-line"
          />
        </g>
      </svg>

      <!-- Keep text outside the stretched SVG so glyphs retain their natural proportions. -->
      <div class="ts-axis-layer" aria-hidden="true">
        <span
          v-for="tick in visibleYTicks"
          :key="`yl-${tick.value}`"
          class="ts-axis-label ts-axis-label--left"
          :style="{
            left: `${((padLeft - 6) / svgWidth) * 100}%`,
            top: `${(tick.y / svgHeight) * 100}%`,
          }"
        >{{ tick.label }}</span>
        <span
          v-for="tick in seriesRightYTicks"
          :key="`yr-${tick.value}`"
          class="ts-axis-label ts-axis-label--right"
          :style="{
            left: `${((svgWidth - padRight + 6) / svgWidth) * 100}%`,
            top: `${(tick.y / svgHeight) * 100}%`,
          }"
        >{{ tick.label }}</span>
        <span
          v-for="tick in visibleXTicks"
          :key="`x-${tick.x}`"
          class="ts-axis-label ts-axis-label--bottom"
          :style="{ left: `${(tick.x / svgWidth) * 100}%` }"
        >{{ tick.label }}</span>
        <span
          v-for="(threshold, index) in thresholdLines"
          :key="`threshold-${index}`"
          class="ts-reference-label ts-threshold-label"
          :style="{
            color: threshold.color,
            left: `${(padLeft / svgWidth) * 100}%`,
            top: `${(threshold.y / svgHeight) * 100}%`,
          }"
        >{{ threshold.label }}</span>
        <span
          v-for="(deploy, index) in deployLines"
          :key="`deploy-${index}`"
          class="ts-reference-label ts-deploy-label"
          :style="{
            left: `${(deploy.x / svgWidth) * 100}%`,
            top: `${(padTop / svgHeight) * 100}%`,
          }"
        >{{ deploy.label }}</span>
      </div>

      <!-- Shared crosshair (vertical line at the hovered time) -->
      <div
        v-if="crosshairLeftPct != null"
        class="ts-crosshair"
        :style="{ left: crosshairLeftPct + '%', top: plotTopPct + '%', height: plotHeightPct + '%' }"
      ></div>

      <template v-if="crosshairLeftPct != null">
        <span v-for="(marker, index) in markers" :key="index" class="ts-marker"
          :style="{ left: crosshairLeftPct + '%', top: marker.top + '%', background: marker.color }" />
      </template>
      <div v-if="drag" class="ts-selection" :style="{
        left: (plotLeftFrac + Math.min(drag.start, drag.end) * plotSpanFrac) * 100 + '%',
        width: Math.abs(drag.end - drag.start) * plotSpanFrac * 100 + '%',
        top: plotTopPct + '%', height: plotHeightPct + '%',
      }" aria-hidden="true" />

      <span v-if="!hasSamples && thresholdLines.length" class="ts-no-samples mono">No samples</span>
      <EmptyState
        v-else-if="!hasSamples"
        title="No samples in this range"
        description="Try a wider time range or review the panel query."
        icon="—"
        compact
      />
    </div>

    <div v-if="legendItems.length" class="ts-legend" :class="{ 'ts-legend--inspecting': readout }"
      tabindex="0" aria-label="Chart values" @blur="onLeave">
      <time v-if="readout" class="ts-readout-time">{{ readout.label }}</time>
      <span v-for="(lg, i) in legendItems" :key="'lg' + i" class="ts-legend-item">
        <span class="ts-legend-dot" :style="{ background: lg.color }"></span>
        <span class="ts-legend-name" :title="lg.name">{{ lg.name }}</span>
        <span v-if="readout" class="ts-legend-val mono">{{ readout.values[i] == null ? '—' : fmtAxisU(readout.values[i]!) }}</span>
        <span v-else-if="lg.last" class="ts-legend-val mono">{{ lg.last }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/TimeseriesWidget.css"></style>
