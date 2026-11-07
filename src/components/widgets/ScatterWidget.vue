<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, useId } from 'vue'
import { RouterLink } from 'vue-router'
import type { ScatterPoint, TimeDomain } from '../../types'
import { eventLink, scatterBounds, scatterTicks } from '../../lib/dashboardPanels'

const props = withDefaults(defineProps<{ points: ScatterPoint[]; xLabel: string; yLabel: string; xUnit?: string; yUnit?: string; source?: 'spans' | 'logs'; truncated?: boolean; timeDomain?: TimeDomain }>(), { xUnit: '', yUnit: '', source: 'spans' })
const host = ref<HTMLElement | null>(null), width = ref(520)
const height = ref(210), pad = { left: 66, right: 18, top: 22, bottom: 48 }
const detailId = `scatter-${useId()}`
const valid = computed(() => props.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
const selectedIndex = ref<number | null>(null)
const selected = computed(() => selectedIndex.value === null ? null : valid.value[selectedIndex.value] || null)
watch(() => props.points, () => { selectedIndex.value = null })
const xDomain = computed(() => scatterBounds(valid.value, 'x')), yDomain = computed(() => scatterBounds(valid.value, 'y'))
const x = (value: number) => pad.left + (value - xDomain.value[0]) / (xDomain.value[1] - xDomain.value[0]) * (width.value - pad.left - pad.right)
const y = (value: number) => height.value - pad.bottom - (value - yDomain.value[0]) / (yDomain.value[1] - yDomain.value[0]) * (height.value - pad.top - pad.bottom)
const format = (v: number) => v.toLocaleString(undefined, { maximumSignificantDigits: 4 })
const xTicks = computed(() => scatterTicks(xDomain.value, width.value < 360 ? 3 : 5)), yTicks = computed(() => scatterTicks(yDomain.value, 4))
let observer: ResizeObserver | undefined
onMounted(() => { if (host.value) { width.value = Math.max(220, host.value.clientWidth); height.value = Math.max(120, host.value.clientHeight); observer = new ResizeObserver(entries => { width.value = Math.max(220, entries[0]!.contentRect.width); height.value = Math.max(120, entries[0]!.contentRect.height) }); observer.observe(host.value) } })
onBeforeUnmount(() => observer?.disconnect())
function selectNearest(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement, rect = svg.getBoundingClientRect()
  const mx = (event.clientX - rect.left) * width.value / rect.width, my = (event.clientY - rect.top) * height.value / rect.height
  if (mx < pad.left || mx > width.value - pad.right || my < pad.top || my > height.value - pad.bottom) return
  let distance = Infinity, nearest: number | null = null
  valid.value.forEach((p, i) => { const d = Math.hypot(x(p.x) - mx, y(p.y) - my); if (d < distance) { distance = d; nearest = i } })
  selectedIndex.value = nearest
}
function onKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Escape') { selectedIndex.value = null; return }
  if (!valid.value.length) return
  selectedIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? valid.value.length - 1
    : Math.max(0, Math.min(valid.value.length - 1, (selectedIndex.value ?? -1) + (event.key === 'ArrowLeft' ? -1 : 1)))
}
</script>

<template>
  <div class="scatter-widget">
    <div ref="host" class="scatter-plot">
      <svg :viewBox="`0 0 ${width} ${height}`" :height="height" role="group" aria-label="Scatter plot. Use left and right arrow keys to inspect requests." :aria-describedby="detailId" tabindex="0" @pointerdown="selectNearest" @keydown="onKey">
        <g v-for="tick in yTicks" :key="tick"><line :x1="pad.left" :x2="width - pad.right" :y1="y(tick)" :y2="y(tick)" class="scatter-grid" /><text :x="pad.left - 8" :y="y(tick) + 4" text-anchor="end">{{ format(tick) }}</text></g>
        <text v-for="(tick, i) in xTicks" :key="i" :x="x(tick)" :y="height - 27" :text-anchor="i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'">{{ format(tick) }}</text>
        <text :x="pad.left" y="13">{{ yLabel }}{{ yUnit ? ` (${yUnit})` : '' }}</text>
        <text :x="(pad.left + width - pad.right) / 2" :y="height - 6" text-anchor="middle">{{ xLabel }}{{ xUnit ? ` (${xUnit})` : '' }}</text>
        <g v-for="(point, i) in valid" :key="i" :transform="`translate(${x(point.x)},${y(point.y)})`" :class="{ 'scatter-selected': selectedIndex === i }">
          <path v-if="point.error" d="M-3,-3L3,3M3,-3L-3,3" class="scatter-error" /><circle v-else r="3" class="scatter-point" />
          <circle v-if="selectedIndex === i" r="7" class="scatter-ring" />
        </g>
      </svg>
    </div>
    <div class="scatter-legend"><span><i />Success</span><span><b>×</b>Error</span><span>{{ valid.length.toLocaleString() }} {{ truncated ? 'latest points · result capped' : 'points' }}</span></div>
    <div :id="detailId" class="scatter-detail" aria-live="polite"><template v-if="selected"><strong>{{ selected.service }} · {{ selected.label }}</strong><span>{{ format(selected.x) }} {{ xUnit }} / {{ format(selected.y) }} {{ yUnit }} · {{ selected.timestamp }}</span><RouterLink :to="eventLink(selected, source, timeDomain)">{{ source === 'spans' && selected.trace_id ? 'View trace' : 'Explore events' }} →</RouterLink></template><template v-else>Select a point to inspect its event. Arrow keys move between points.</template></div>
  </div>
</template>

<style scoped>
.scatter-widget { height: 100%; min-height: 0; overflow: auto; display: flex; flex-direction: column; min-width: 0; font-size: 11px; }
.scatter-plot { margin: 0 12px; min-width: 0; flex: 1 1 0; min-height: 120px; position: relative; }
.scatter-plot svg { display: block; width: 100%; height: 100%; position: absolute; touch-action: pan-y; }
.scatter-plot text { font: 11px var(--font-ui); fill: var(--text-muted); }
.scatter-grid { stroke: var(--border-subtle); stroke-width: 1; }
.scatter-point { fill: var(--accent); opacity: .58; }
.scatter-error { fill: none; stroke: var(--error); stroke-width: 1.7; }
.scatter-selected .scatter-point { opacity: 1; }
.scatter-ring { fill: none; stroke: var(--text-primary); stroke-width: 1; }
.scatter-legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 6px 16px 12px; color: var(--text-secondary); }
.scatter-legend span { display: flex; align-items: center; gap: 5px; }
.scatter-legend i { width: 7px; height: 7px; background: var(--accent); border-radius: 50%; }
.scatter-legend b { color: var(--error); }
.scatter-legend span:last-child { margin-left: auto; color: var(--text-muted); }
.scatter-detail { flex: 0 0 auto; margin-top: auto; border-top: 1px solid var(--border-subtle); padding: 10px 16px; display: flex; flex-direction: column; gap: 3px; min-height: 55px; color: var(--text-muted); overflow-wrap: anywhere; }
.scatter-detail strong { color: var(--text-primary); font-weight: 500; }
.scatter-detail a { color: var(--accent); }
</style>
