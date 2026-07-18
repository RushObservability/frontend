<script lang="ts">
// Module-scoped counter → a stable, unique id per TimeseriesWidget instance.
let chartIdSeq = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { CountBucket, DeployMarker } from '../../types'
import { straightLinePath, straightAreaPath, fmtAxis, type Pt } from '../../lib/chart'
import { useChartHover } from '../../composables/useChartHover'

const props = defineProps<{
  buckets: CountBucket[]
  deploys?: DeployMarker[]
  /** Multi-series mode (PromQL/metrics source). When present, takes precedence over buckets. */
  series?: Array<{ name: string; points: [number, number][]; color?: string; ref_id?: string; axis?: 'left' | 'right' }>
  /** Optional horizontal reference lines (e.g. monitor alert thresholds). */
  thresholds?: Array<{ value: number; color: string; label: string }>
  /** Optional unit suffix for axis labels, the legend last-value, and the tooltip. */
  unit?: string
  /** Label for the single-series legend entry (defaults to "value"). */
  seriesName?: string
}>()

// Distinct line colors for split/grouped series. The palette is intentionally
// longer than the editor's query palette because a single APM or PromQL query
// can fan out into many lines. Index-based assignment is shared by paths,
// legend, and hover details so every series keeps one visual identity.
const SERIES_COLORS = [
  '#3b82f6', '#e5584f', '#47b881', '#8b5cf6',
  '#d97706', '#db2777', '#0891b2', '#65a30d',
  '#f97316', '#6366f1', '#0f766e', '#be123c',
]
const seriesMode = computed(() => !!(props.series && props.series.length))

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

const svgWidth = 600
const svgHeight = 140
const padTop = 12
const padBottom = 20
const padLeft = 40
const padRight = 42

const plotWidth = svgWidth - padLeft - padRight
const plotHeight = svgHeight - padTop - padBottom

const maxCount = computed(() =>
  props.buckets.reduce((max, b) => Math.max(max, b.count), 1)
)

const seriesPoints = computed<Pt[]>(() => {
  const n = props.buckets.length
  return props.buckets.map((b, i) => [
    padLeft + (i / Math.max(n - 1, 1)) * plotWidth,
    padTop + plotHeight - (b.count / maxCount.value) * plotHeight,
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
  if (props.buckets.length < 2) return []
  const indices = [0, Math.floor(props.buckets.length / 2), props.buckets.length - 1]
  return indices.map(i => {
    const b = props.buckets[i]!
    const x = padLeft + (i / Math.max(props.buckets.length - 1, 1)) * plotWidth
    // Bucket is "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM:SS" — the time lives at
    // offset 11 either way. (The old fallback sliced 0..5 → "2026-".)
    const label = b.bucket.length >= 16 ? b.bucket.slice(11, 16) : b.bucket
    return { x, label }
  })
})

// ── Multi-series (metrics) geometry ──
const seriesBounds = computed(() => {
  let minT = Infinity, maxT = -Infinity, maxLeft = 0, maxRight = 0
  for (const s of props.series || []) {
    for (const [t, v] of s.points) {
      if (t < minT) minT = t
      if (t > maxT) maxT = t
      if (s.axis === 'right') maxRight = Math.max(maxRight, v)
      else maxLeft = Math.max(maxLeft, v)
    }
  }
  // Extend the range so threshold lines stay on-chart even above the data peak.
  for (const th of props.thresholds || []) if (th.value > maxLeft) maxLeft = th.value
  return {
    minT,
    maxT: maxT > minT ? maxT : minT + 1,
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
  return (props.series || []).map((s, i) => {
    const axisMax = s.axis === 'right' ? maxRight : maxLeft
    const pts: Pt[] = s.points.map(([t, v]) => [
      padLeft + ((t - minT) / span) * plotWidth,
      padTop + plotHeight - (v / axisMax) * plotHeight,
    ] as Pt)
    return { d: straightLinePath(pts), color: s.color || SERIES_COLORS[i % SERIES_COLORS.length]!, name: s.name, axis: s.axis || 'left' }
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
  if (!isFinite(minT)) return []
  return [0, 0.5, 1].map(r => {
    const d = new Date((minT + (maxT - minT) * r) * 1000)
    return {
      x: padLeft + r * plotWidth,
      label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    }
  })
})

const deployLines = computed(() => {
  if (!props.deploys || props.deploys.length === 0 || props.buckets.length < 2) return []
  const firstTime = new Date(props.buckets[0]!.bucket).getTime()
  const lastTime = new Date(props.buckets[props.buckets.length - 1]!.bucket).getTime()
  const range = lastTime - firstTime
  if (range <= 0) return []
  return props.deploys
    .map(d => {
      const t = new Date(d.deployed_at).getTime()
      const ratio = (t - firstTime) / range
      if (ratio < 0 || ratio > 1) return null
      return {
        x: padLeft + ratio * plotWidth,
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

interface HSeries { name: string; color: string; pts: [number, number][] }
// Unified [time, value] model so hover works the same in both render modes.
const hoverModel = computed<{ minT: number; maxT: number; series: HSeries[] }>(() => {
  if (seriesMode.value) {
    const series: HSeries[] = (props.series || []).map((s, i) => ({
      name: s.name,
      color: s.color || SERIES_COLORS[i % SERIES_COLORS.length]!,
      pts: s.points,
    }))
    const { minT, maxT } = seriesBounds.value
    return { minT, maxT, series }
  }
  const pts: [number, number][] = []
  for (const b of props.buckets) {
    const t = new Date(b.bucket).getTime() / 1000
    if (!isNaN(t)) pts.push([t, b.count])
  }
  const minT = pts.length ? pts[0]![0] : 0
  const maxT = pts.length ? pts[pts.length - 1]![0] : minT + 1
  return {
    minT,
    maxT: maxT > minT ? maxT : minT + 1,
    series: pts.length ? [{ name: props.seriesName || 'value', color: 'var(--amber)', pts }] : [],
  }
})

// ── Always-on compact legend (single- and multi-series) ──
// Each entry: ● name  lastValue<unit>, using the same colors as the lines.
const legendItems = computed(() => {
  return hoverModel.value.series.slice(0, 6).map((s) => {
    const last = s.pts.length ? s.pts[s.pts.length - 1]![1] : null
    return {
      name: s.name,
      color: s.color,
      last: last == null ? '' : fmtAxisU(last),
    }
  })
})

// Plot box as fractions of the full SVG (the SVG fills .ts-plot 1:1).
const plotLeftFrac = padLeft / svgWidth
const plotSpanFrac = (svgWidth - padRight - padLeft) / svgWidth
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
  hoverP.value == null ? null : (plotLeftFrac + hoverP.value * plotSpanFrac) * 100
)

const tooltip = computed(() => {
  const t = hover.time.value
  const p = hoverP.value
  // Only the chart the cursor is actually over renders a tooltip.
  if (t == null || p == null || hover.activeId.value !== chartId) return null
  const rows = hoverModel.value.series
    .map((s) => {
      if (!s.pts.length) return null
      let best = s.pts[0]!, bestD = Math.abs(s.pts[0]![0] - t)
      for (const pt of s.pts) {
        const d = Math.abs(pt[0] - t)
        if (d < bestD) { bestD = d; best = pt }
      }
      return { name: s.name, color: s.color, value: fmtAxisU(best[1]), t: best[0] }
    })
    .filter(Boolean) as Array<{ name: string; color: string; value: string; t: number }>
  if (!rows.length) return null
  const headT = rows[0]!.t
  const d = new Date(headT * 1000)
  const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  // Flip to the left of the crosshair once past the midpoint, so the tooltip
  // always opens toward the side with more room and stays within view.
  return { rows: rows.slice(0, 8), label, leftPct: crosshairLeftPct.value!, flip: p > 0.5 }
})

function onHover(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0) return
  const { minT, maxT } = hoverModel.value
  if (!isFinite(minT) || maxT <= minT) return
  const rx = (e.clientX - rect.left) / rect.width
  let p = (rx - plotLeftFrac) / plotSpanFrac
  p = Math.max(0, Math.min(1, p))
  hover.set(minT + p * (maxT - minT), chartId)
}
function onLeave() { hover.set(null) }
</script>

<template>
  <div class="ts-widget">
    <div class="ts-plot">
      <!-- ── Multi-series (metrics/PromQL) mode ── -->
      <svg v-if="seriesMode" :viewBox="`0 0 ${svgWidth} ${svgHeight}`" preserveAspectRatio="none" class="ch-svg ch-animate ts-svg" @pointermove="onHover" @pointerleave="onLeave">
        <line v-for="tick in seriesYTicks" :key="'sy' + tick.value" :x1="padLeft" :y1="tick.y" :x2="svgWidth - padRight" :y2="tick.y" :class="['ch-grid', { 'ch-grid--baseline': tick.value === 0 }]" />
        <text v-for="tick in seriesYTicks" :key="'syl' + tick.value" :x="padLeft - 6" :y="tick.y + 3" class="ch-axis" text-anchor="end">{{ tick.label }}</text>
        <text v-for="tick in seriesRightYTicks" :key="'syr' + tick.value" :x="svgWidth - padRight + 6" :y="tick.y + 3" class="ch-axis ts-axis-right" text-anchor="start">{{ tick.label }}</text>
        <line v-for="xl in seriesXLabels" :key="'sv' + xl.x" :x1="xl.x" :y1="padTop" :x2="xl.x" :y2="padTop + plotHeight" class="ch-grid" />
        <text v-for="xl in seriesXLabels" :key="'sx' + xl.x" :x="xl.x" :y="svgHeight - 4" class="ch-axis" text-anchor="middle">{{ xl.label }}</text>
        <path v-for="(sp, i) in seriesPaths" :key="'sp' + i" :d="sp.d" class="ch-line ts-line" :style="{ color: sp.color }" />
        <!-- Threshold reference lines -->
        <g v-for="(th, i) in thresholdLines" :key="'th' + i">
          <line :x1="padLeft" :y1="th.y" :x2="svgWidth - padRight" :y2="th.y" :stroke="th.color" stroke-width="1" stroke-dasharray="5,4" vector-effect="non-scaling-stroke" />
          <text :x="padLeft + 4" :y="th.y - 3" :fill="th.color" class="ch-threshold-label">{{ th.label }}</text>
        </g>
      </svg>

      <!-- ── Single-series (spans count) mode ── -->
      <svg v-if="!seriesMode" :viewBox="`0 0 ${svgWidth} ${svgHeight}`" preserveAspectRatio="none" class="ch-svg ch-animate ts-svg" @pointermove="onHover" @pointerleave="onLeave">
        <!-- Y grid lines -->
        <line
          v-for="tick in yTicks"
          :key="tick.value"
          :x1="padLeft" :y1="tick.y"
          :x2="svgWidth - padRight" :y2="tick.y"
          :class="['ch-grid', { 'ch-grid--baseline': tick.value === 0 }]"
        />
        <!-- Y labels -->
        <text
          v-for="tick in yTicks"
          :key="'l' + tick.value"
          :x="padLeft - 6" :y="tick.y + 3"
          class="ch-axis"
          text-anchor="end"
        >{{ tick.label }}</text>
        <!-- Vertical grid lines (Grafana-style full grid) -->
        <line
          v-for="xl in xLabels"
          :key="'v' + xl.label"
          :x1="xl.x" :y1="padTop"
          :x2="xl.x" :y2="padTop + plotHeight"
          class="ch-grid"
        />
        <!-- X labels -->
        <text
          v-for="xl in xLabels"
          :key="xl.label"
          :x="xl.x" :y="svgHeight - 4"
          class="ch-axis"
          text-anchor="middle"
        >{{ xl.label }}</text>
        <!-- Area fill + smooth line -->
        <path v-if="areaPath" :d="areaPath" class="ch-area" style="color: var(--amber)" />
        <path v-if="linePath" :d="linePath" class="ch-line ts-line" style="color: var(--amber)" />
        <!-- Threshold reference lines -->
        <g v-for="(th, i) in thresholdLines" :key="'th' + i">
          <line :x1="padLeft" :y1="th.y" :x2="svgWidth - padRight" :y2="th.y" :stroke="th.color" stroke-width="1" stroke-dasharray="5,4" vector-effect="non-scaling-stroke" />
          <text :x="padLeft + 4" :y="th.y - 3" :fill="th.color" class="ch-threshold-label">{{ th.label }}</text>
        </g>
        <!-- Deploy markers -->
        <g v-for="(dl, i) in deployLines" :key="'d' + i">
          <line
            :x1="dl.x" :y1="padTop"
            :x2="dl.x" :y2="padTop + plotHeight"
            class="deploy-line"
          />
          <text
            :x="dl.x + 3" :y="padTop + 10"
            class="deploy-label"
          >{{ dl.label }}</text>
        </g>
      </svg>

      <!-- Shared crosshair (vertical line at the hovered time) -->
      <div
        v-if="crosshairLeftPct != null"
        class="ts-crosshair"
        :style="{ left: crosshairLeftPct + '%', top: plotTopPct + '%', height: plotHeightPct + '%' }"
      ></div>

      <!-- Hover tooltip (this chart's value(s) at the hovered time) -->
      <div
        v-if="tooltip"
        class="ts-tooltip"
        :class="{ 'ts-tooltip--flip': tooltip.flip }"
        :style="{ left: tooltip.leftPct + '%', top: plotTopPct + '%' }"
      >
        <div class="ts-tt-time mono">{{ tooltip.label }}</div>
        <div v-for="(r, i) in tooltip.rows" :key="i" class="ts-tt-row">
          <span class="ts-tt-dot" :style="{ background: r.color }"></span>
          <span class="ts-tt-name">{{ r.name }}</span>
          <span class="ts-tt-val mono">{{ r.value }}</span>
        </div>
      </div>

      <div v-if="seriesMode && seriesPaths.length === 0" class="empty-state"><div class="empty-state-icon">--</div><div>No data</div></div>
      <div v-if="!seriesMode && buckets.length === 0" class="empty-state">
        <div class="empty-state-icon">--</div>
        <div>No data</div>
      </div>
    </div>

    <div v-if="legendItems.length" class="ts-legend">
      <span v-for="(lg, i) in legendItems" :key="'lg' + i" class="ts-legend-item">
        <span class="ts-legend-dot" :style="{ background: lg.color }"></span>
        <span class="ts-legend-name">{{ lg.name }}</span>
        <span v-if="lg.last" class="ts-legend-val mono">{{ lg.last }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/TimeseriesWidget.css"></style>
