<script setup lang="ts">
/**
 * Trace span waterfall, shared by the Explore detail panel and the standalone
 * trace page so both render an identical timeline.
 *
 * Selection is optional and controlled: pass `activeSpanId` to mark the span the
 * host considers current, and listen to `select` to react. Branch collapse and
 * the inline detail row are local, since neither host needs to drive them.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SpanNode, TraceResponse } from '../types'
import {
  buildVirtualOffsets,
  nextVirtualIndex,
  virtualScrollTarget,
  virtualWindow,
  type VirtualNavigationKey,
} from '../lib/virtualWindow'
import {
  WATERFALL_TICKS,
  clipTraceWindow,
  buildWaterfallRows,
  displayableSpanAttrs,
  durationClass,
  flattenSpans,
  formatSpanDuration,
  isSpanError,
  parseTraceTimestamp,
  serviceColor,
  spanOperation,
  spanStatusClass,
  spanTraceWindow,
  type TraceWindow,
} from '../lib/traceWaterfall'

const props = withDefaults(defineProps<{
  trace: TraceResponse
  /** Span the host treats as current; highlighted but not expanded. */
  activeSpanId?: string | null
  /** Heading text, or empty to render the timeline without a header. */
  title?: string
  subtitle?: string
  compact?: boolean
}>(), {
  title: 'Trace timeline',
  subtitle: '',
  compact: false,
})

const emit = defineEmits<{ select: [spanId: string] }>()

const collapsed = ref<Set<string>>(new Set())
const expandedSpanId = ref<string | null>(null)
const localSpanId = ref<string | null>(null)
const focusedWindow = ref<TraceWindow | null>(null)

// Rows are windowed so a 20k-span trace renders a screenful, not 20k rows.
// Every row is ROW_HEIGHT tall (pinned in CSS); only the open detail panel varies.
const ROW_HEIGHT = 26
const HEAD_HEIGHT = 24
const OVERSCAN = 8
const grid = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(760)
const detailHeight = ref(0)
const focusIndex = ref(0)
let resizeObserver: ResizeObserver | null = null
let observedDetail: HTMLElement | null = null
let frame: number | null = null

// A new trace starts fully expanded and with no open detail row.
watch(() => props.trace?.trace_id, () => {
  collapsed.value = new Set()
  expandedSpanId.value = null
  localSpanId.value = null
  focusedWindow.value = null
  focusIndex.value = 0
  scrollTop.value = 0
  if (grid.value) grid.value.scrollTop = 0
})

const orderedSpans = computed(() => flattenSpans(props.trace?.spans ?? []))
const rows = computed(() => buildWaterfallRows(props.trace?.spans ?? [], collapsed.value))
const errorCount = computed(() => orderedSpans.value.filter(isSpanError).length)
const hasBranches = computed(() => orderedSpans.value.some(span => span.children?.length))
const selectedSpanId = computed(() => props.activeSpanId === undefined ? localSpanId.value : props.activeSpanId)
const selectedSpan = computed(() => orderedSpans.value.find(span => span.span_id === selectedSpanId.value))
const spanWindows = computed(() => {
  const origin = orderedSpans.value[0]
  const originUs = origin ? parseTraceTimestamp(origin.timestamp) : 0
  return new Map(orderedSpans.value.map(span => [span.span_id, spanTraceWindow(span, originUs)]))
})
const durationNs = computed(() => {
  let duration = Math.max(0, props.trace.duration_ns)
  for (const span of spanWindows.value.values()) duration = Math.max(duration, span.to)
  return duration
})
const viewport = computed(() => focusedWindow.value ?? { from: 0, to: durationNs.value })
const viewportDuration = computed(() => Math.max(1, viewport.value.to - viewport.value.from))
const selectedWindow = computed(() => spanWindows.value.get(selectedSpanId.value ?? ''))
const canFocus = computed(() => {
  const span = selectedWindow.value
  return span != null && span.to > span.from && span.to - span.from < durationNs.value
})
const visibleRows = computed(() => {
  const visible = rows.value.flatMap(row => {
    const span = spanWindows.value.get(row.span.span_id)!
    const bar = clipTraceWindow(span, viewport.value)
    if (!bar) return []
    return [{
      ...row,
      left: (bar.from - viewport.value.from) / viewportDuration.value * 100,
      width: (bar.to - bar.from) / viewportDuration.value * 100,
    }]
  })
  return props.compact ? visible.slice(0, 20) : visible
})
const rowOffsets = computed(() => {
  const rows = visibleRows.value
  const open = expandedSpanId.value
  const heights = new Map(open ? [[open, ROW_HEIGHT + detailHeight.value]] : [])
  return buildVirtualOffsets(rows.length, ROW_HEIGHT, index => rows[index]!.span.span_id, heights)
})
const rowRange = computed(() => virtualWindow(rowOffsets.value, scrollTop.value, viewportHeight.value, ROW_HEIGHT, OVERSCAN))
const renderedRows = computed(() => {
  const { start, end } = rowRange.value
  return visibleRows.value.slice(start, end).map((row, offset) => ({ ...row, index: start + offset }))
})
const topPadding = computed(() => rowOffsets.value[rowRange.value.start] ?? 0)
const bottomPadding = computed(() => {
  const offsets = rowOffsets.value
  return Math.max(0, offsets[offsets.length - 1]! - offsets[rowRange.value.end]!)
})
// Roving tab stop: one rendered row stays tabbable even when the focused one scrolled away.
const tabStopIndex = computed(() => {
  const { start, end } = rowRange.value
  return Math.min(Math.max(focusIndex.value, start), Math.max(start, end - 1))
})
const hiddenCount = computed(() => orderedSpans.value.length - visibleRows.value.length)
const hiddenErrors = computed(() => errorCount.value - visibleRows.value.filter(row => isSpanError(row.span)).length)

function overviewX(ns: number) {
  return ns / Math.max(1, durationNs.value) * 1000
}

// One overview lane per service, with errors drawn above the service marks.
const overviewLanes = computed(() => {
  const services = new Map<string, { service: string; path: string; errors: string }>()
  for (const span of orderedSpans.value) {
    const service = span.service_name
    const lane = services.get(service) ?? { service, path: '', errors: '' }
    const { from, to } = spanWindows.value.get(span.span_id)!
    const start = Math.min(999.75, overviewX(from))
    const end = Math.max(start + .25, overviewX(to))
    const segment = `M${start.toFixed(2)},0H${end.toFixed(2)}`
    if (isSpanError(span)) lane.errors += segment
    else lane.path += segment
    services.set(service, lane)
  }
  return [...services.values()]
})

function toggleSpanFocus() {
  if (focusedWindow.value) focusedWindow.value = null
  else if (canFocus.value && selectedWindow.value) focusedWindow.value = selectedWindow.value
}

function colorFor(service: string): string {
  return serviceColor(service, props.trace?.services)
}

function toggleBranch(spanId: string) {
  const next = new Set(collapsed.value)
  if (next.has(spanId)) next.delete(spanId)
  else next.add(spanId)
  collapsed.value = next
}

function toggleAllBranches() {
  if (collapsed.value.size) {
    collapsed.value = new Set()
    return
  }
  collapsed.value = new Set(
    orderedSpans.value.filter(span => span.children?.length).map(span => span.span_id),
  )
}

function selectSpan(spanId: string) {
  expandedSpanId.value = expandedSpanId.value === spanId ? null : spanId
  if (props.activeSpanId === undefined) localSpanId.value = localSpanId.value === spanId ? null : spanId
  emit('select', spanId)
}

function attrsFor(span: SpanNode): Record<string, unknown> {
  return displayableSpanAttrs(span)
}

function measureGrid() {
  if (grid.value) viewportHeight.value = Math.max(0, grid.value.clientHeight - HEAD_HEIGHT)
}

function onGridScroll() {
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    scrollTop.value = grid.value?.scrollTop ?? 0
  })
}

function observeDetail(element: unknown) {
  const next = element instanceof HTMLElement ? element : null
  if (next === observedDetail) return
  if (observedDetail) resizeObserver?.unobserve(observedDetail)
  observedDetail = next
  if (next) resizeObserver?.observe(next)
}

function onRowKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const target = nextVirtualIndex(event.key as VirtualNavigationKey, index, visibleRows.value.length)
  focusIndex.value = target
  const node = grid.value
  if (node) {
    const next = virtualScrollTarget(rowOffsets.value, target, node.scrollTop, viewportHeight.value)
    if (next !== node.scrollTop) node.scrollTop = next
    scrollTop.value = node.scrollTop
  }
  void nextTick(() => grid.value?.querySelector<HTMLElement>(`[data-row-index="${target}"]`)?.focus())
}

onMounted(() => {
  measureGrid()
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === grid.value) measureGrid()
      else detailHeight.value = Math.ceil(entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height)
    }
  })
  if (grid.value) resizeObserver.observe(grid.value)
  if (observedDetail) resizeObserver.observe(observedDetail)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (frame !== null) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="tw" :class="{ 'tw--compact': compact }">
    <div class="tw-header">
      <div v-if="title">
        <span class="tw-title">{{ title }}</span>
        <span v-if="subtitle" class="tw-subtitle">{{ subtitle }}</span>
      </div>
      <div class="tw-header-actions">
        <button class="tw-collapse-all" type="button" :disabled="!focusedWindow && !canFocus" @click.stop="toggleSpanFocus">
          {{ focusedWindow ? 'Full trace' : 'Focus selected span' }}
        </button>
        <span v-if="errorCount" class="tw-error-count mono">
          {{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}
        </span>
        <button class="tw-collapse-all" type="button" :disabled="!hasBranches" @click.stop="toggleAllBranches">
          {{ collapsed.size ? 'Expand all' : 'Collapse all' }}
        </button>
      </div>
    </div>

    <div class="tw-legend" aria-label="Services in this trace">
      <span v-for="service in trace.services" :key="service">
        <i :style="{ backgroundColor: colorFor(service) }"></i>{{ service }}
      </span>
      <span class="tw-total mono">{{ trace.span_count }} spans · {{ formatSpanDuration(durationNs) }}</span>
    </div>

    <div v-if="orderedSpans.length" class="tw-overview">
      <div class="tw-overview-label">
        <span>Whole trace</span>
        <span v-if="focusedWindow" class="mono">{{ formatSpanDuration(viewport.from) }}–{{ formatSpanDuration(viewport.to) }}</span>
      </div>
      <svg role="img" aria-label="Whole trace overview" :viewBox="`0 0 1000 ${overviewLanes.length * 5 + 4}`" preserveAspectRatio="none">
        <g v-for="(lane, index) in overviewLanes" :key="lane.service" :transform="`translate(0,${4 + index * 5})`">
          <path :d="lane.path" :stroke="colorFor(lane.service)" />
          <path :d="lane.errors" stroke="var(--error)" />
        </g>
        <rect v-if="focusedWindow" :x="overviewX(focusedWindow.from)" y="1"
          :width="overviewX(focusedWindow.to - focusedWindow.from)" :height="overviewLanes.length * 5 + 2"
          class="tw-overview-range" />
      </svg>
    </div>

    <div
      ref="grid"
      class="tw-grid"
      role="treegrid"
      aria-label="Trace span waterfall"
      :aria-rowcount="visibleRows.length + 1"
      @scroll="onGridScroll"
    >
      <div class="tw-head-row" role="row" aria-rowindex="1">
        <div class="tw-col-span" role="columnheader">Span</div>
        <div class="tw-col-bar" role="columnheader">
          <span
            v-for="tick in WATERFALL_TICKS"
            :key="tick"
            class="tw-tick mono"
            :class="{ 'is-first': tick === 0, 'is-last': tick === 100 }"
            :style="{ left: tick + '%' }"
          >{{ formatSpanDuration(Math.round(viewport.from + (viewport.to - viewport.from) * tick / 100)) }}</span>
        </div>
        <div class="tw-col-dur" role="columnheader">Duration</div>
      </div>

      <div aria-hidden="true" role="presentation" :style="{ height: topPadding + 'px' }"></div>
      <template v-for="row in renderedRows" :key="'tw-' + row.span.span_id">
        <div
          class="tw-row"
          :class="{
            'tw-row-open': row.span.span_id === expandedSpanId,
            'tw-row-error': isSpanError(row.span),
            'tw-row-current': row.span.span_id === selectedSpanId,
          }"
          role="row"
          :tabindex="row.index === tabStopIndex ? 0 : -1"
          :data-row-index="row.index"
          :aria-rowindex="row.index + 2"
          :aria-level="row.depth + 1"
          :aria-selected="row.span.span_id === selectedSpanId"
          @focus="focusIndex = row.index"
          @keydown="onRowKeydown($event, row.index)"
          @click.stop="selectSpan(row.span.span_id)"
          @keydown.enter.prevent="selectSpan(row.span.span_id)"
          @keydown.space.prevent="selectSpan(row.span.span_id)"
        >
          <div class="tw-col-span" role="gridcell" :style="{ paddingLeft: (10 + Math.min(row.depth, 6) * 14) + 'px' }">
            <span v-if="row.depth" class="tw-connector" :style="{ width: (Math.min(row.depth, 6) * 14 - 5) + 'px' }" aria-hidden="true"></span>
            <button
              v-if="row.childCount"
              class="tw-branch-toggle"
              type="button"
              :aria-label="`${collapsed.has(row.span.span_id) ? 'Expand' : 'Collapse'} ${spanOperation(row.span)}`"
              :aria-expanded="!collapsed.has(row.span.span_id)"
              @click.stop="toggleBranch(row.span.span_id)"
            >
              <svg :class="{ collapsed: collapsed.has(row.span.span_id) }" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>
            </button>
            <span v-else class="tw-leaf" aria-hidden="true"></span>
            <span class="tw-dot" :style="{ backgroundColor: colorFor(row.span.service_name) }" aria-hidden="true"></span>
            <span class="tw-label">
              <span class="tw-op mono">{{ spanOperation(row.span) }}</span>
              <span class="tw-svc" :style="{ color: colorFor(row.span.service_name) }">{{ row.span.service_name }}</span>
            </span>
            <span
              v-if="row.span.events?.length"
              class="tw-events mono"
              :title="`${row.span.events.length} span event${row.span.events.length === 1 ? '' : 's'}`"
            >{{ row.span.events.length }}</span>
          </div>

          <div class="tw-col-bar" role="gridcell">
            <div class="tw-track">
              <span
                v-for="tick in WATERFALL_TICKS.slice(1, -1)"
                :key="tick"
                class="tw-gridline"
                :style="{ left: tick + '%' }"
                aria-hidden="true"
              ></span>
              <div
                class="tw-bar"
                :style="{
                  width: row.width + '%',
                  left: row.left + '%',
                  backgroundColor: isSpanError(row.span) ? 'var(--error)' : colorFor(row.span.service_name),
                }"
              />
            </div>
          </div>

          <div class="tw-col-dur" role="gridcell">
            <span class="tw-duration mono" :class="durationClass(row.span.duration_ns)">{{ formatSpanDuration(row.span.duration_ns) }}</span>
            <span
              v-if="row.span.http_status_code"
              class="tw-status mono"
              :class="spanStatusClass(row.span.status, row.span.http_status_code)"
            >{{ row.span.http_status_code }}</span>
            <span v-else-if="isSpanError(row.span)" class="tw-status status-error mono">ERR</span>
          </div>
        </div>

        <div v-if="expandedSpanId === row.span.span_id" :ref="observeDetail" class="tw-detail" @click.stop>
          <div class="tw-detail-meta">
            <span><b>span</b> <span class="mono">{{ row.span.span_id }}</span></span>
            <span><b>parent</b> <span class="mono">{{ row.span.parent_span_id || '—' }}</span></span>
            <span><b>started</b> <span class="mono">{{ row.span.timestamp }}</span></span>
            <span><b>duration</b> <span class="mono" :class="durationClass(row.span.duration_ns)">{{ formatSpanDuration(row.span.duration_ns) }}</span></span>
            <span v-if="row.span.http_status_code"><b>status</b> <span class="mono" :class="spanStatusClass(row.span.status, row.span.http_status_code)">{{ row.span.http_status_code }}</span></span>
          </div>
          <div v-if="Object.keys(attrsFor(row.span)).length" class="tw-detail-attrs">
            <div class="tw-detail-title">Attributes</div>
            <div v-for="(value, key) in attrsFor(row.span)" :key="key" class="tw-attr">
              <span class="tw-attr-k mono">{{ key }}</span>
              <span class="tw-attr-v mono">{{ typeof value === 'object' ? JSON.stringify(value) : value }}</span>
            </div>
          </div>
        </div>
      </template>
      <div aria-hidden="true" role="presentation" :style="{ height: bottomPadding + 'px' }"></div>
    </div>
    <div v-if="selectedSpan || hiddenCount" class="tw-readout">
      <span v-if="selectedSpan">Selected span <strong>{{ spanOperation(selectedSpan) }}</strong>
        {{ selectedSpan.service_name }} · <span class="mono">{{ formatSpanDuration(selectedSpan.duration_ns) }}</span>
      </span>
      <span v-if="hiddenCount">{{ hiddenCount }} hidden<span v-if="hiddenErrors"> · {{ hiddenErrors }} with errors</span></span>
    </div>
  </div>
</template>

<style scoped>
.tw { display: block; min-width: 0; container-type: inline-size; }

.tw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.tw-title { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.tw-subtitle { display: block; margin-top: 2px; font-size: 11px; color: var(--text-tertiary); }
.tw-header-actions { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-left: auto; }
.tw-error-count { color: var(--error); font-size: 11px; font-weight: 600; }
.tw-collapse-all {
  padding: 3px 9px; font: inherit; font-size: 11px;
  border: 1px solid var(--border-default); border-radius: var(--r-sm);
  background: var(--bg-raised); color: var(--text-secondary); cursor: pointer;
  transition: color .12s, border-color .12s;
}
.tw-collapse-all:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-strong); }
.tw-collapse-all:disabled { opacity: .5; cursor: default; }
.tw-collapse-all:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }

.tw-legend {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-2); font-size: 11px; color: var(--text-secondary);
}
.tw-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; vertical-align: -1px; }
.tw-total { margin-left: auto; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

.tw-overview { margin-bottom: var(--sp-2); }
.tw-overview-label, .tw-readout {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.tw-overview svg {
  display: block;
  width: 100%;
  height: 44px;
  margin-top: var(--sp-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
}
.tw-overview path { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }
.tw-overview-range { fill: var(--accent-soft); stroke: var(--text-secondary); vector-effect: non-scaling-stroke; }
.tw-readout { padding: var(--sp-2) 0 0; overflow-wrap: anywhere; }
.tw-readout strong { color: var(--text-primary); }
.tw-grid {
  max-height: min(68vh, 760px); overflow: auto; overscroll-behavior: contain; overflow-anchor: none;
  border: 1px solid var(--border-subtle); border-radius: var(--r-md);
}
.tw--compact .tw-grid { max-height: 300px; overflow-y: auto; }
.tw--compact .tw-overview svg { height: 28px; }
.tw-head-row, .tw-row {
  display: grid;
  grid-template-columns: minmax(180px, 2fr) minmax(140px, 3fr) 104px;
  align-items: center;
}
.tw-head-row {
  position: sticky; top: 0; z-index: 1; box-sizing: border-box; height: 24px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-tertiary);
}
.tw-head-row .tw-col-span { padding-left: 10px; }
.tw-head-row .tw-col-bar { position: relative; height: 100%; margin: 0 var(--sp-2); padding: 0; }
.tw-tick {
  position: absolute; top: 6px; transform: translateX(-50%);
  font-size: 9px; color: var(--text-tertiary); white-space: nowrap;
  font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; font-weight: 400;
}
.tw-tick.is-first { transform: none; }
.tw-tick.is-last { transform: translateX(-100%); }
.tw-col-dur { padding-right: 10px; text-align: right; }

.tw-row {
  box-sizing: border-box; height: 26px; cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background .08s;
}
.tw-row:hover { background: var(--bg-hover); }
.tw-row:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: -2px; }
.tw-row-open { background: var(--bg-raised); }
/* Error and current are edge marks, not fills, so they can co-occur. */
.tw-row-error { box-shadow: inset 3px 0 0 var(--error); }
.tw-row-current { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.tw-row-error.tw-row-current { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--error), inset 6px 0 0 var(--accent); }

.tw-col-span { position: relative; display: flex; align-items: center; gap: 6px; min-width: 0; padding-right: var(--sp-2); }
.tw-connector { position: absolute; left: 6px; height: 1px; background: var(--border-default); }
.tw-branch-toggle {
  display: grid; place-items: center; width: 14px; height: 14px; flex-shrink: 0;
  padding: 0; border: none; border-radius: var(--r-sm);
  background: none; color: var(--text-tertiary); cursor: pointer;
}
.tw-branch-toggle:hover { color: var(--text-primary); background: var(--bg-active); }
.tw-branch-toggle:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 1px; }
.tw-branch-toggle svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.6; transition: transform .12s; }
.tw-branch-toggle svg.collapsed { transform: rotate(-90deg); }
.tw-leaf { width: 14px; flex-shrink: 0; }
.tw-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 2px; }
.tw-label { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.tw-op { font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tw-svc { font-size: 10px; flex-shrink: 0; }
.tw-events {
  flex-shrink: 0; padding: 0 5px; border-radius: var(--r-pill);
  background: var(--bg-active); color: var(--text-tertiary); font-size: 9px;
}

.tw-col-bar { position: relative; padding: 0 var(--sp-2); min-width: 0; }
.tw-track { position: relative; height: 14px; overflow: hidden; }
.tw-gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border-subtle); }
.tw-bar {
  position: absolute; top: 3px; height: 8px; min-width: 2px;
  border-radius: 2px; display: flex; align-items: center;
}

.tw-duration { font-size: 11px; font-variant-numeric: tabular-nums; }
.tw-status { margin-left: 5px; font-size: 10px; }

.tw-detail { padding: var(--sp-3) var(--sp-4); background: var(--bg-raised); border-bottom: 1px solid var(--border-subtle); }
.tw-detail-meta { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: 11px; color: var(--text-secondary); }
.tw-detail-meta b { color: var(--text-tertiary); font-weight: 600; }
.tw-detail-title { margin: var(--sp-3) 0 var(--sp-1); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
.tw-attr { display: flex; align-items: baseline; gap: var(--sp-3); padding: 2px 0; font-size: 11px; }
.tw-attr-k { min-width: 150px; max-width: 40%; flex-shrink: 0; color: var(--text-tertiary); overflow-wrap: anywhere; }
.tw-attr-v { color: var(--text-primary); overflow-wrap: anywhere; }

@container (max-width: 500px) {
  .tw-head-row, .tw-row { grid-template-columns: minmax(0, 1.4fr) minmax(0, 2fr) 72px; }
  .tw-row .tw-connector { display: none; }
  .tw-subtitle, .tw-svc, .tw-tick:not(.is-first, .is-last) { display: none; }
}
</style>
