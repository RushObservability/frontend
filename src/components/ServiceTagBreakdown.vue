<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataTable, { type DataTableColumn } from './DataTable.vue'
import PanelCard from './PanelCard.vue'
import TimeseriesWidget from './widgets/TimeseriesWidget.vue'
import type { TimeSeriesPanelSeries } from './panels/types'
import { useApi } from '../composables/useApi'
import { provideChartHover } from '../composables/useChartHover'
import { isServiceTagDimension, serviceTagLabels, type ServiceTagScope } from '../lib/serviceTagBreakdown'
import type { ServiceTagBreakdown, ServiceTagBucket, ServiceTagDimension } from '../types'

const props = defineProps<{
  service: string
  tenant: string
  range: { from: string; to: string }
}>()
const route = useRoute()
const router = useRouter()
const api = useApi()
const hover = provideChartHover()
const dimension = computed<ServiceTagDimension>({
  get: () => isServiceTagDimension(route.query.tag) ? route.query.tag : 'region',
  set: tag => { void router.replace({ query: { ...route.query, tag } }) },
})
const container = ref<HTMLElement>()
const visible = ref(false)
const response = shallowRef<ServiceTagBreakdown>()
const error = ref('')
const retry = ref(0)
let observer: IntersectionObserver | undefined

onMounted(() => {
  if (!container.value || typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return
    visible.value = true
    observer?.disconnect()
  }, { rootMargin: '200px 0px' })
  observer.observe(container.value)
})
onUnmounted(() => observer?.disconnect())

watch([visible, () => props.service, () => props.tenant, () => props.range, dimension, retry],
  async ([ready, service, , range, tag], _, onCleanup) => {
    if (!ready) return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    response.value = undefined
    error.value = ''
    hover.set(null)
    try {
      const data = await api.serviceTagBreakdown(service, tag, range, controller.signal)
      if (!controller.signal.aborted) response.value = data
    } catch {
      if (!controller.signal.aborted) error.value = 'Could not load the tag breakdown.'
    }
  }, { immediate: true })

const colors = ['#3b82f6', '#159984', '#8b5cf6']
const groups = computed(() => response.value?.groups ?? [])
const domain = computed(() => ({ from: Date.parse(props.range.from) / 1000, to: Date.parse(props.range.to) / 1000 }))
const bucketSeconds = computed(() => response.value?.bucket_seconds ?? 60)
const bucketLabel = computed(() => {
  const seconds = bucketSeconds.value
  if (seconds >= 86_400) return `${seconds / 86_400}d`
  if (seconds >= 3600) return `${seconds / 3600}h`
  return `${seconds / 60}m`
})
const count = (value: number) => value.toLocaleString()
const percent = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
const errorRate = (row: { errors: number; requests: number }) => row.errors / row.requests * 100

const rows = computed(() => {
  const data = response.value
  if (!data) return []
  const excluded = groups.value.flatMap(group => group.value === null ? [] : [group.value])
  return groups.value.map((group, index) => {
    const other = group.value === null
    const label = group.value ?? 'Other'
    const scope: ServiceTagScope = {
      service: props.service,
      dimension: dimension.value,
      selection: group.value === null ? { kind: 'other', excluded } : { kind: 'value', value: group.value },
    }
    return {
      id: index,
      label,
      other,
      otherNote: [
        group.other_values ? `${count(group.other_values)} more ${group.other_values === 1 ? 'value' : 'values'}` : '',
        group.untagged_requests ? `${count(group.untagged_requests)} without a usable tag` : '',
      ].filter(Boolean).join(' · '),
      color: other ? 'var(--text-muted)' : colors[index] ?? 'var(--text-muted)',
      requests: group.requests,
      share: group.requests / data.total_requests * 100,
      rate: errorRate(group),
      p95: group.p95_ms,
      traceLabel: other ? 'View traces for Other' : `View traces for ${label}`,
      to: {
        name: 'explore',
        query: { ...props.range, mode: 'traces', tenant: props.tenant, service_tag: JSON.stringify(scope) },
      },
    }
  })
})
const columns = computed<DataTableColumn[]>(() => [
  { key: 'label', label: serviceTagLabels[dimension.value] },
  { key: 'traffic', label: 'Traffic', align: 'right' },
  { key: 'rate', label: 'Error rate', align: 'right' },
  { key: 'p95', label: 'P95', align: 'right' },
  { key: 'traces', label: 'Explore', align: 'right' },
])

const charts = computed(() => {
  const signals: Array<{ title: string; unit?: string; value: (bucket: ServiceTagBucket) => number }> = [
    { title: `Requests / ${bucketLabel.value}`, value: bucket => bucket.requests },
    { title: 'Error rate', unit: '%', value: errorRate },
    { title: 'P95 latency', unit: 'ms', value: bucket => bucket.p95_ms },
  ]
  return signals.map(signal => ({
    title: signal.title,
    unit: signal.unit,
    series: groups.value.map((group, index): TimeSeriesPanelSeries => ({
      name: rows.value[index]!.label,
      color: rows.value[index]!.color,
      lineStyle: group.value === null ? 'dashed' : 'solid',
      points: group.buckets.map(bucket => [bucket.timestamp_ms / 1000, signal.value(bucket)]),
    })),
  }))
})

const footer = computed(() => {
  const named = rows.value.filter(row => !row.other).length
  const total = named + (groups.value.find(group => group.value === null)?.other_values ?? 0)
  const shown = named === total
    ? `${count(total)} tagged ${total === 1 ? 'value' : 'values'}`
    : `Top ${named} of ${count(total)} values by requests`
  return `${shown} · ${count(response.value?.total_requests ?? 0)} total requests`
})

function openSeries(index: number) {
  const row = rows.value[index]
  if (row) void router.push(row.to)
}
</script>

<template>
  <div ref="container" class="tag-breakdown">
    <PanelCard
      title="Breakdown by tag"
      description="Compares server requests for this service. Region and version come from resource tags, with span tags as a fallback. Endpoint groups by the recorded route template."
      :loading="!response && !error"
      :error="error || null"
      :empty="response?.total_requests === 0"
      empty-title="No server requests in this range"
      empty-message="Select a wider time range to compare tags."
    >
      <template #actions>
        <label class="tag-control">
          <span>Group by</span>
          <select v-model="dimension" class="select-input">
            <option v-for="(label, key) in serviceTagLabels" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <button v-if="error" class="btn btn-sm" type="button" @click="retry++">Retry</button>
      </template>
      <div class="tag-charts">
        <section v-for="chart in charts" :key="chart.title" :aria-label="chart.title" class="tag-chart">
          <h3>{{ chart.title }}</h3>
          <div class="tag-plot">
            <TimeseriesWidget
              :buckets="[]"
              :series="chart.series"
              :time-domain="domain"
              :bucket-seconds="bucketSeconds"
              :unit="chart.unit"
              shared-legend
              linked-readout
              selectable-series
              @series-select="openSeries"
            />
          </div>
        </section>
      </div>

      <DataTable :rows="rows" :columns="columns" bare>
        <template #cell-label="{ row }">
          <div class="tag-name">
            <span class="tag-swatch" :class="{ 'tag-swatch-other': row.other }" :style="{ color: String(row.color) }" aria-hidden="true" />
            <div>
              <span class="mono">{{ row.label }}</span>
              <small v-if="row.otherNote" class="tag-other">{{ row.otherNote }}</small>
            </div>
          </div>
        </template>
        <template #cell-traffic="{ row }">
          <div class="tag-traffic mono">
            <span class="tag-share-track" aria-hidden="true"><span :style="{ width: `${row.share}%`, background: String(row.color) }" /></span>
            <span>{{ count(Number(row.requests)) }}</span>
            <span class="tag-share">{{ percent(Number(row.share)) }}</span>
          </div>
        </template>
        <template #cell-rate="{ row }"><span class="mono">{{ percent(Number(row.rate)) }}</span></template>
        <template #cell-p95="{ row }"><span class="mono">{{ Number(row.p95).toLocaleString(undefined, { maximumFractionDigits: 1 }) }} ms</span></template>
        <template #cell-traces="{ row }">
          <router-link :to="rows[Number(row.id)]!.to" class="tag-link" :aria-label="rows[Number(row.id)]!.traceLabel">
            Traces <span aria-hidden="true">↗</span>
          </router-link>
        </template>
      </DataTable>
      <p class="tag-footer" aria-live="polite">{{ footer }}</p>
    </PanelCard>
  </div>
</template>

<style scoped>
.tag-breakdown { container-type: inline-size; min-width: 0; }
.tag-control { display: flex; align-items: center; gap: .55rem; white-space: nowrap; color: var(--text-secondary); }
.tag-control select {
  font: inherit;
  min-height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-surface);
  color: var(--text-primary);
  padding: 2px 6px;
}
.tag-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  margin-bottom: var(--sp-3);
}
.tag-chart { min-width: 0; padding: var(--sp-2) 0 0; }
.tag-chart + .tag-chart { border-top: 1px solid var(--border-subtle); }
.tag-chart h3 { margin: 0 var(--sp-3); color: var(--text-primary); font-size: 13px; font-weight: 600; }
.tag-plot { height: 158px; }
.tag-name { display: flex; align-items: baseline; gap: 8px; overflow-wrap: anywhere; }
.tag-swatch { flex: 0 0 14px; border-top: 2px solid currentColor; transform: translateY(-.25em); }
.tag-swatch-other { border-top-style: dashed; }
.tag-other { display: block; margin-top: 2px; color: var(--text-muted); }
.tag-traffic { display: flex; gap: .6rem; align-items: center; justify-content: flex-end; white-space: nowrap; }
.tag-share { min-width: 6ch; color: var(--text-secondary); }
.tag-share-track { display: none; width: 48px; height: 4px; background: var(--border-subtle); border-radius: 2px; overflow: hidden; }
.tag-share-track > span { display: block; height: 100%; }
.tag-link { white-space: nowrap; }
.tag-footer { margin: var(--sp-2) 0 0; font-size: 12px; color: var(--text-muted); }
@container (min-width: 760px) {
  .tag-charts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tag-chart + .tag-chart { border-top: 0; border-left: 1px solid var(--border-subtle); }
  .tag-share-track { display: inline-block; }
}
@container (max-width: 480px) {
  .tag-traffic { flex-direction: column; align-items: flex-end; gap: 0; }
  .tag-share { min-width: 0; }
}
</style>
