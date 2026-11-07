<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TimeDomain, TimelineState, WidgetData } from '../../types'
import { stateColor, stateSegments, timelineStates, type StateSegment } from '../../lib/dashboardPanels'

const props = defineProps<{ series: NonNullable<WidgetData['series']>; timeDomain: TimeDomain; stepSecs?: number; states?: TimelineState[] }>()
const mappings = computed(() => timelineStates(props.states))
const rows = computed(() => props.series.slice(0, 24).map(s => ({ name: s.name, segments: stateSegments(s.points, props.timeDomain, props.stepSecs ?? 60) })))
const active = ref<{ name: string; segment: StateSegment } | null>(null)
watch(() => [props.series, props.timeDomain], () => { active.value = null })
const info = (value: number | null) => value === null ? { label: 'No data', color: '' } : mappings.value.find(s => s.value === value) || { label: `Value ${value}`, color: 'blue' }
const percent = (time: number) => (time - props.timeDomain.from) / (props.timeDomain.to - props.timeDomain.from) * 100
const clock = (time: number) => new Date(time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const duration = (s: StateSegment) => `${Math.max(1, Math.round(s.to - s.from)).toLocaleString()}s`
</script>

<template>
  <div class="state-widget">
    <div class="state-lanes" aria-label="State timeline">
      <div v-for="(row, index) in rows" :key="index" class="state-row">
        <span class="state-name" :title="row.name">{{ row.name }}</span>
        <div class="state-track">
          <button v-for="(segment, n) in row.segments" :key="n" class="state-segment" :class="{ missing: segment.value === null, selected: active?.name === row.name && active?.segment === segment }"
            :style="{ left: `${percent(segment.from)}%`, width: `${percent(segment.to) - percent(segment.from)}%`, background: segment.value === null ? undefined : stateColor(info(segment.value).color) }"
            :aria-label="`${row.name}: ${info(segment.value).label}, ${clock(segment.from)} to ${clock(segment.to)}, ${duration(segment)}`"
            @mouseenter="active = { name: row.name, segment }" @focus="active = { name: row.name, segment }" @click="active = { name: row.name, segment }" />
        </div>
      </div>
      <div class="state-axis"><span>{{ clock(timeDomain.from) }}</span><span>{{ clock(timeDomain.to) }}</span></div>
    </div>
    <div class="state-legend"><span v-for="state in mappings" :key="state.value"><i :style="{ background: stateColor(state.color) }" />{{ state.label }}</span><span><i class="missing" />No data</span></div>
    <div class="state-detail" aria-live="polite"><template v-if="active"><strong>{{ active.name }} · {{ info(active.segment.value).label }}</strong><span>{{ clock(active.segment.from) }} – {{ clock(active.segment.to) }} · {{ duration(active.segment) }}</span></template><template v-else>Select a state interval to inspect its duration.</template></div>
    <div v-if="series.length > rows.length" class="state-overflow">Showing {{ rows.length }} of {{ series.length }} series. Narrow the query to see the rest.</div>
  </div>
</template>

<style scoped>
.state-widget { height: 100%; min-height: 160px; display: flex; flex-direction: column; font-size: 11px; }
.state-lanes { flex: 1; overflow: auto; padding: 12px 16px; }
.state-row { display: grid; grid-template-columns: minmax(70px, 25%) 1fr; align-items: center; gap: 10px; margin-bottom: 11px; }
.state-name { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state-track { height: 26px; position: relative; }
.state-segment { position: absolute; top: 0; height: 26px; border: 0; border-radius: 2px; padding: 0; cursor: pointer; opacity: .72; min-width: 1px; }
.state-segment:hover,.state-segment:focus-visible,.state-segment.selected { opacity: 1; z-index: 1; }
.state-segment:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.missing { background: var(--border-default); }
.state-axis { display: flex; justify-content: space-between; gap: 8px; margin-left: calc(25% + 10px); color: var(--text-muted); font-size: 10px; flex-wrap: wrap; }
.state-legend { display: flex; gap: 12px; flex-wrap: wrap; padding: 4px 16px 12px; color: var(--text-secondary); }
.state-legend span { display: flex; gap: 5px; align-items: center; }
.state-legend i { width: 8px; height: 8px; border-radius: 2px; }
.state-detail { border-top: 1px solid var(--border-subtle); padding: 10px 16px; color: var(--text-muted); min-height: 50px; display: flex; flex-direction: column; gap: 3px; overflow-wrap: anywhere; }
.state-detail strong { color: var(--text-primary); font-weight: 500; }
.state-overflow { padding: 4px 16px; color: var(--text-muted); }
</style>
