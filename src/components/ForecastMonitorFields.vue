<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { forecastLabelDetail, forecastResourceKey, forecastResourceLabel, type ForecastDraft } from '../lib/capacityForecast'
import type { ForecastResource } from '../types'
import AutocompleteInput from './AutocompleteInput.vue'

const config = defineModel<ForecastDraft>({ required: true })
const threshold = defineModel<number | null>('threshold', { required: true })
const api = useApi()
const filter = ref('')
const resources = ref<ForecastResource[]>([])
const truncated = ref(false)
const loading = ref(false)
const error = ref('')
const retry = ref(0)

const options = computed(() => {
  const selected = config.value.resource
  if (!selected || resources.value.some(resource => forecastResourceKey(resource) === forecastResourceKey(selected))) {
    return resources.value
  }
  return [selected, ...resources.value]
})
const resourceOptions = computed(() => {
  const labels = options.value.map(forecastResourceLabel)
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return options.value.map((resource, index) => ({
    key: forecastResourceKey(resource),
    label: counts.get(labels[index]!) === 1
      ? labels[index]!
      : [labels[index], forecastLabelDetail(resource)].filter(Boolean).join(' · '),
  }))
})
const invalidThreshold = computed(() => threshold.value != null
  && !(Number(threshold.value) > 0 && Number(threshold.value) <= 100))
const resourceKey = computed({
  get: () => config.value.resource ? forecastResourceKey(config.value.resource) : '',
  set: key => { config.value = { ...config.value, resource: options.value.find(resource => forecastResourceKey(resource) === key) ?? null } },
})

function updateMetric(metric: string) {
  if (metric === config.value.metric_name) return
  filter.value = ''
  config.value = { ...config.value, metric_name: metric, resource: null }
}

function metricNames(prefix: string): Promise<string[]> {
  return api.monitorAutocomplete({ type: 'forecast_metric', prefix })
    .then(result => result.suggestions)
    .catch(() => [])
}

watch([() => config.value.metric_name.trim(), filter, retry], ([metric, search], _, onCleanup) => {
  resources.value = []
  truncated.value = false
  error.value = ''
  loading.value = Boolean(metric)
  if (!metric) return
  const controller = new AbortController()
  const timer = setTimeout(async () => {
    try {
      const result = await api.forecastSeries(metric, search.trim(), controller.signal)
      if (controller.signal.aborted) return
      resources.value = result.resources
      truncated.value = result.truncated
      if (!config.value.resource && !search && !result.truncated && result.resources.length === 1) {
        config.value = { ...config.value, resource: result.resources[0]! }
      }
    } catch {
      if (!controller.signal.aborted) error.value = 'Could not load resource series.'
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  }, 250)
  onCleanup(() => {
    clearTimeout(timer)
    controller.abort()
  })
}, { immediate: true })
</script>

<template>
  <div class="forecast-fields">
    <div class="forecast-source">
      <label class="forecast-field">
        <span>Usage gauge</span>
        <AutocompleteInput :model-value="config.metric_name" :fetch-suggestions="metricNames" :mono="true"
          placeholder="system.filesystem.utilization" @update:model-value="updateMetric" />
      </label>
      <label class="forecast-field">
        <span>Sample unit</span>
        <select :value="config.input_unit" @change="config = { ...config, input_unit: ($event.target as HTMLSelectElement).value as ForecastDraft['input_unit'] }">
          <option value="ratio">Ratio (0–1)</option>
          <option value="percent">Percent (0–100)</option>
        </select>
      </label>
    </div>

    <div class="forecast-source">
      <label class="forecast-field">
        <span>Resource</span>
        <select v-model="resourceKey" :disabled="!options.length" aria-describedby="forecast-resource-status">
          <option value="">{{ loading ? 'Loading series…' : 'Choose a series' }}</option>
          <option v-for="option in resourceOptions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="forecast-field">
        <span>Find a resource</span>
        <input v-model="filter" :disabled="!config.metric_name.trim()" maxlength="128" placeholder="Host or mount point" />
      </label>
    </div>
    <p v-if="error" id="forecast-resource-status" class="forecast-hint" role="alert">
      {{ error }} <button class="btn btn-sm" type="button" @click="retry++">Retry</button>
    </p>
    <p v-else id="forecast-resource-status" class="forecast-hint" aria-live="polite">
      {{ truncated ? 'Showing up to 100 series. Use the resource filter to narrow the list.'
        : !loading && config.metric_name.trim() && !resources.length ? 'No matching gauge series in the last 24 hours.'
        : 'The alert follows the exact series selected here.' }}
    </p>

    <div class="forecast-conditions">
      <label class="forecast-field">
        <span>Threshold (%)</span>
        <input v-model.number="threshold" type="number" min="0" max="100" step="any" :aria-invalid="invalidThreshold" />
      </label>
      <label class="forecast-field">
        <span>Forecast window</span>
        <select :value="config.horizon_secs" @change="config = { ...config, horizon_secs: Number(($event.target as HTMLSelectElement).value) }">
          <option :value="21600">Next 6 hours</option>
          <option :value="43200">Next 12 hours</option>
          <option :value="86400">Next 24 hours</option>
          <option :value="172800">Next 48 hours</option>
        </select>
      </label>
    </div>
    <p v-if="invalidThreshold" class="forecast-hint" role="alert">Enter a threshold above 0% and at most 100%.</p>
  </div>
</template>

<style scoped>
.forecast-fields { display: grid; gap: var(--sp-3); }
.forecast-source, .forecast-conditions { display: grid; gap: var(--sp-3); grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.forecast-conditions { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 28rem; }
.forecast-field { display: grid; gap: var(--sp-1); min-width: 0; color: var(--text-secondary); font-size: 12px; }
.forecast-field select, .forecast-field input {
  width: 100%; min-width: 0; min-height: 33px; border-radius: 5px; padding: 5px 8px;
  font: inherit; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default);
}
.forecast-field select:disabled, .forecast-field input:disabled { color: var(--text-muted); }
.forecast-hint { margin: 0; color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 540px) { .forecast-source { grid-template-columns: minmax(0, 1fr); } }
</style>
