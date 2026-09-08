<script setup lang="ts">
/**
 * Trace span waterfall, shared by the Explore detail panel and the standalone
 * trace page so both render an identical timeline.
 *
 * Selection is optional and controlled: pass `activeSpanId` to mark the span the
 * host considers current, and listen to `select` to react. Branch collapse and
 * the inline detail row are local, since neither host needs to drive them.
 */
import { computed, ref, watch } from 'vue'
import type { SpanNode, TraceResponse } from '../types'
import {
  WATERFALL_TICKS,
  barOffsetPercent,
  barWidthPercent,
  buildWaterfallRows,
  displayableSpanAttrs,
  durationClass,
  flattenSpans,
  formatSpanDuration,
  isSpanError,
  serviceColor,
  spanOperation,
  spanStatusClass,
} from '../lib/traceWaterfall'

const props = withDefaults(defineProps<{
  trace: TraceResponse
  /** Span the host treats as current; highlighted but not expanded. */
  activeSpanId?: string | null
  /** Heading text, or empty to render the timeline without a header. */
  title?: string
  subtitle?: string
}>(), {
  activeSpanId: null,
  title: 'Trace timeline',
  subtitle: 'Follow the request from parent spans into downstream work.',
})

const emit = defineEmits<{ select: [spanId: string] }>()

const collapsed = ref<Set<string>>(new Set())
const expandedSpanId = ref<string | null>(null)

// A new trace starts fully expanded and with no open detail row.
watch(() => props.trace?.trace_id, () => {
  collapsed.value = new Set()
  expandedSpanId.value = null
})

const orderedSpans = computed(() => flattenSpans(props.trace?.spans ?? []))
const rows = computed(() => buildWaterfallRows(props.trace?.spans ?? [], collapsed.value))
const errorCount = computed(() => orderedSpans.value.filter(isSpanError).length)
const hasBranches = computed(() => orderedSpans.value.some(span => span.children?.length))
const durationNs = computed(() => props.trace?.duration_ns ?? 0)

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
  emit('select', spanId)
}

function attrsFor(span: SpanNode): Record<string, unknown> {
  return displayableSpanAttrs(span)
}
</script>

<template>
  <div class="tw">
    <div v-if="title" class="tw-header">
      <div>
        <span class="tw-title">{{ title }}</span>
        <span v-if="subtitle" class="tw-subtitle">{{ subtitle }}</span>
      </div>
      <div class="tw-header-actions">
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

    <div class="tw-grid" role="treegrid" aria-label="Trace span waterfall">
      <div class="tw-head-row" role="row">
        <div class="tw-col-span" role="columnheader">Span</div>
        <div class="tw-col-bar" role="columnheader">
          <span
            v-for="tick in WATERFALL_TICKS"
            :key="tick"
            class="tw-tick mono"
            :class="{ 'is-first': tick === 0, 'is-last': tick === 100 }"
            :style="{ left: tick + '%' }"
          >{{ formatSpanDuration(Math.round(durationNs * tick / 100)) }}</span>
        </div>
        <div class="tw-col-dur" role="columnheader">Duration</div>
      </div>

      <template v-for="row in rows" :key="'tw-' + row.span.span_id">
        <div
          class="tw-row"
          :class="{
            'tw-row-open': row.span.span_id === expandedSpanId,
            'tw-row-error': isSpanError(row.span),
            'tw-row-current': row.span.span_id === activeSpanId,
          }"
          role="row"
          tabindex="0"
          :aria-level="row.depth + 1"
          :aria-selected="row.span.span_id === activeSpanId"
          @click.stop="selectSpan(row.span.span_id)"
          @keydown.enter.prevent="selectSpan(row.span.span_id)"
          @keydown.space.prevent="selectSpan(row.span.span_id)"
        >
          <div class="tw-col-span" role="gridcell" :style="{ paddingLeft: (10 + row.depth * 18) + 'px' }">
            <span v-if="row.depth" class="tw-connector" :style="{ width: (row.depth * 18 - 5) + 'px' }" aria-hidden="true"></span>
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
                  width: barWidthPercent(row.span, durationNs),
                  left: barOffsetPercent(row.span, orderedSpans, durationNs),
                  backgroundColor: isSpanError(row.span) ? 'var(--error)' : colorFor(row.span.service_name),
                }"
              >
                <span
                  v-if="durationNs > 0 && row.span.duration_ns / durationNs > 0.14"
                  class="tw-bar-label mono"
                >{{ formatSpanDuration(row.span.duration_ns) }}</span>
              </div>
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

        <div v-if="expandedSpanId === row.span.span_id" class="tw-detail" @click.stop>
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
    </div>
  </div>
</template>

<style scoped>
.tw { display: block; min-width: 0; }

.tw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.tw-title { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.tw-subtitle { display: block; margin-top: 2px; font-size: 11px; color: var(--text-tertiary); }
.tw-header-actions { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
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

.tw-grid { border: 1px solid var(--border-subtle); border-radius: var(--r-md); overflow: hidden; }
.tw-head-row, .tw-row {
  display: grid;
  grid-template-columns: minmax(180px, 2fr) minmax(140px, 3fr) 104px;
  align-items: center;
}
.tw-head-row {
  position: relative; height: 24px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-tertiary);
}
.tw-head-row .tw-col-span { padding-left: 10px; }
.tw-head-row .tw-col-bar { position: relative; height: 100%; }
.tw-tick {
  position: absolute; top: 6px; transform: translateX(-50%);
  font-size: 9px; color: var(--text-tertiary); white-space: nowrap;
  font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; font-weight: 400;
}
.tw-tick.is-first { transform: none; }
.tw-tick.is-last { transform: translateX(-100%); }
.tw-col-dur { padding-right: 10px; text-align: right; }

.tw-row {
  min-height: 26px; cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background .08s;
}
.tw-row:last-of-type { border-bottom: none; }
.tw-row:hover { background: var(--bg-hover); }
.tw-row:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: -2px; }
.tw-row-open { background: var(--bg-raised); }
/* Error and current are edge marks, not fills, so they can co-occur. */
.tw-row-error { box-shadow: inset 3px 0 0 var(--error); }
.tw-row-current { box-shadow: inset 3px 0 0 var(--accent); }
.tw-row-error.tw-row-current { box-shadow: inset 3px 0 0 var(--error), inset 6px 0 0 var(--accent); }

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
.tw-track { position: relative; height: 14px; }
.tw-gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border-subtle); }
.tw-bar {
  position: absolute; top: 3px; height: 8px; min-width: 2px;
  border-radius: 2px; display: flex; align-items: center;
}
.tw-bar-label { position: absolute; left: 5px; font-size: 9px; color: var(--text-inverse); white-space: nowrap; }

.tw-duration { font-size: 11px; font-variant-numeric: tabular-nums; }
.tw-status { margin-left: 5px; font-size: 10px; }

.tw-detail { padding: var(--sp-3) var(--sp-4); background: var(--bg-raised); border-bottom: 1px solid var(--border-subtle); }
.tw-detail-meta { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: 11px; color: var(--text-secondary); }
.tw-detail-meta b { color: var(--text-tertiary); font-weight: 600; }
.tw-detail-title { margin: var(--sp-3) 0 var(--sp-1); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
.tw-attr { display: flex; align-items: baseline; gap: var(--sp-3); padding: 2px 0; font-size: 11px; }
.tw-attr-k { min-width: 150px; max-width: 40%; flex-shrink: 0; color: var(--text-tertiary); overflow-wrap: anywhere; }
.tw-attr-v { color: var(--text-primary); overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .tw-head-row, .tw-row { grid-template-columns: minmax(120px, 1.4fr) minmax(90px, 2fr) 78px; }
  .tw-subtitle { display: none; }
}
</style>
