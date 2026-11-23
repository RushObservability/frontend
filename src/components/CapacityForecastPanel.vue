<script setup lang="ts">
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import TimeseriesWidget from './widgets/TimeseriesWidget.vue'
import type { TimeSeriesPanelSeries } from './panels/types'
import type { CapacityForecast } from '../types'

const props = defineProps<{
  forecast?: CapacityForecast
  loading?: boolean
  error?: string | null
  ready?: boolean
}>()

const observedColor = 'var(--accent)'
const forecastColor = 'var(--purple, #8b5cf6)'
const thresholdColor = 'var(--error)'
const pct = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
const seconds = (iso: string) => Date.parse(iso) / 1000
const absoluteTime = (iso: string) => new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})
const domain = computed(() => props.forecast && ({
  from: seconds(props.forecast.history_from),
  to: seconds(props.forecast.horizon_end),
}))
const thresholds = computed(() => props.forecast
  ? [{ value: props.forecast.threshold_pct, label: '', color: thresholdColor }]
  : [])
const series = computed<TimeSeriesPanelSeries[]>(() => {
  const forecast = props.forecast
  if (!forecast) return []
  const observed: [number, number][] = []
  for (const point of forecast.history) {
    const time = seconds(point.timestamp)
    const previous = observed.at(-1)
    if (previous && time - previous[0] >= 7200) observed.push([time - 1, Number.NaN])
    observed.push([time, point.value])
  }
  const result: TimeSeriesPanelSeries[] = [
    { name: 'Observed', points: observed, color: observedColor },
    { name: 'Forecast', points: forecast.projection.map(point => [seconds(point.timestamp), point.value]), color: forecastColor, lineStyle: 'dashed' },
  ]
  if (forecast.crossing_at && forecast.crossing_at !== forecast.evaluated_at) {
    result.push({ name: 'Projected crossing', points: [[seconds(forecast.crossing_at), forecast.threshold_pct]], color: thresholdColor })
  }
  return result
})

function relativeTime(delta: number): string {
  const minutes = Math.max(1, Math.ceil(delta / 60))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ')
}

const outcome = computed(() => {
  const forecast = props.forecast
  if (!forecast) return null
  const current = forecast.current_pct == null ? '' : `${pct(forecast.current_pct)} at last sample`
  if (forecast.no_data) {
    const details = {
      insufficient_history: 'The forecast needs at least 12 hourly readings spanning 12 hours.',
      stale: 'The most recent reading is at least an hour old.',
      invalid_unit: 'Some readings fall outside 0–100%. Check the gauge and sample unit.',
    }
    return { tone: 'nodata', status: 'No forecast', title: ({
      insufficient_history: 'Insufficient history', stale: 'Readings are stale', invalid_unit: 'Unexpected sample values',
    })[forecast.no_data], detail: details[forecast.no_data] }
  }
  const threshold = pct(forecast.threshold_pct)
  if (forecast.crossing_at === forecast.evaluated_at) {
    return { tone: 'alert', status: 'Would alert', title: `Already at or above ${threshold}`, detail: current }
  }
  if (forecast.crossing_at) {
    const delta = seconds(forecast.crossing_at) - seconds(forecast.evaluated_at)
    return {
      tone: 'alert', status: 'Would alert', title: `Projected to cross ${threshold} in ${relativeTime(delta)}`,
      detail: [absoluteTime(forecast.crossing_at), current].filter(Boolean).join(' · '),
    }
  }
  const hours = (seconds(forecast.horizon_end) - seconds(forecast.evaluated_at)) / 3600
  const projected = forecast.projected_pct == null ? '' : `${pct(forecast.projected_pct)} projected at the end of the window`
  return { tone: 'clear', status: 'Would stay clear', title: `No crossing in the next ${hours} hours`, detail: [projected, current].filter(Boolean).join(' · ') }
})
</script>

<template>
  <PanelCard
    title="Forecast preview"
    description="A linear trend fitted to the last 24 hours of gauge readings. The alert evaluates the peak projected usage or the latest observed usage, whichever is higher."
    :loading="loading"
    :error="error"
    :empty="!forecast"
    :empty-title="ready ? 'No forecast returned' : 'Choose a resource and threshold'"
    :empty-message="ready ? 'Check the query API supports capacity forecasts.' : 'The preview updates as you change the alert.'"
  >
    <template #actions>
      <span v-if="outcome && !loading && !error" class="forecast-status" :class="outcome.tone">{{ outcome.status }}</span>
    </template>
    <div v-if="outcome" class="forecast-reading" aria-live="polite">
      <strong>{{ outcome.title }}</strong>
      <span>{{ outcome.detail }}</span>
    </div>
    <div v-if="forecast?.history.length" class="forecast-plot">
      <TimeseriesWidget
        :buckets="[]"
        :series="series"
        :time-domain="domain"
        :thresholds="thresholds"
        :forecast-from="seconds(forecast.evaluated_at)"
        unit="%"
        shared-legend
      />
    </div>
    <div v-if="forecast?.history.length" class="forecast-legend" aria-label="Forecast chart legend">
      <span><i class="observed" aria-hidden="true" /> Observed</span>
      <span v-if="forecast.projection.length"><i class="projected" aria-hidden="true" /> Forecast</span>
      <span><i class="threshold" aria-hidden="true" /> {{ pct(forecast.threshold_pct) }} threshold</span>
    </div>
    <template v-if="forecast && !loading && !error" #footer>
      <span>{{ forecast.history.length }} hourly {{ forecast.history.length === 1 ? 'reading' : 'readings' }} · Last 24h</span>
      <span v-if="!forecast.no_data">Linear trend</span>
    </template>
  </PanelCard>
</template>

<style scoped>
.forecast-reading { display: grid; gap: 3px; padding: 2px var(--sp-1) var(--sp-2); }
.forecast-reading strong { font-size: clamp(15px, 2vw, 19px); letter-spacing: -.015em; }
.forecast-reading span { font-size: 12px; color: var(--text-secondary); }
.forecast-status {
  border-radius: 4px; padding: 3px 7px; font-size: 11px; font-weight: 650;
  background: var(--bg-raised); color: var(--text-secondary);
}
.forecast-status.alert { color: var(--error); background: color-mix(in srgb, var(--error) 13%, var(--bg-surface)); }
.forecast-status.nodata { color: var(--text-secondary); background: color-mix(in srgb, var(--warning) 13%, var(--bg-surface)); }
.forecast-plot { height: 200px; min-width: 0; }
.forecast-legend { display: flex; flex-wrap: wrap; gap: 6px 15px; padding: var(--sp-1); font-size: 11px; color: var(--text-secondary); }
.forecast-legend span { display: inline-flex; align-items: center; gap: 5px; }
.forecast-legend i { width: 14px; border-top: 2px solid var(--accent); }
.forecast-legend .projected { border-top: 2px dashed var(--purple, #8b5cf6); }
.forecast-legend .threshold { border-top: 1px dashed var(--error); }
</style>
