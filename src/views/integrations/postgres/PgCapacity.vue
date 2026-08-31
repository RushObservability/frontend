<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromMatrixResponse } from '../../../types'
import TimeseriesWidget from '../../../components/widgets/TimeseriesWidget.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)
type Point = [number, number]
interface Series { name: string; points: Point[] }
const sizeSeries = ref<Series>({ name: 'Database size', points: [] })
const walSeries = ref<Series>({ name: 'WAL bytes / second', points: [] })
const ioSeries = ref<Series>({ name: 'I/O read bytes / second', points: [] })
const connections = ref(NaN)
const maxConnections = ref(NaN)
const dbSize = ref(NaN)
const walRate = ref(NaN)
const ioRate = ref(NaN)

function selector(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  if (props.db) p.push(`db="${props.db}"`)
  return p.length ? `{${p.join(',')}}` : ''
}
function clusterSelector(): string {
  const p: string[] = []
  if (props.server) p.push(`service_name="${props.server}"`)
  if (props.host) p.push(`host="${props.host}"`)
  return p.length ? `{${p.join(',')}}` : ''
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
function fmtBytes(value: number): string {
  if (!isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = value
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
function fmtRate(value: number): string { return isFinite(value) ? `${fmtBytes(value)}/s` : '—' }
async function scalar(query: string): Promise<number> {
  try { const result = await api.promQuery(query); return result.result.reduce((sum, row) => sum + n(row.value?.[1]), 0) } catch { return NaN }
}
async function range(query: string, name: string): Promise<Series> {
  try {
    const result: PromMatrixResponse = await api.promQueryRange(query, Math.floor(Date.now() / 1000) - 24 * 3600, Math.floor(Date.now() / 1000), 900)
    const values = result.result[0]?.values || []
    return { name, points: values.map(([ts, value]) => [ts, n(value)] as Point) }
  } catch { return { name, points: [] } }
}
function last(series: Series): number { return series.points[series.points.length - 1]?.[1] ?? NaN }
function growthPerHour(series: Series): number {
  if (series.points.length < 2) return NaN
  const first = series.points[0]!; const latest = series.points[series.points.length - 1]!
  const elapsed = latest[0] - first[0]
  return elapsed > 0 ? ((latest[1] - first[1]) / elapsed) * 3600 : NaN
}

async function load() {
  loading.value = true
  const L = selector()
  const C = clusterSelector()
  const [size, wal, io] = await Promise.all([
    range(`sum(postgresql_db_size${L})`, 'Database size'),
    range(`sum(rate(postgresql_wal_bytes_written${C}[5m]))`, 'WAL bytes / second'),
    range(`sum(rate(postgresql_io_read_bytes${C}[5m]))`, 'I/O read bytes / second'),
  ])
  sizeSeries.value = size; walSeries.value = wal; ioSeries.value = io
  ;[connections.value, maxConnections.value, dbSize.value] = await Promise.all([
    scalar(`sum(postgresql_backends${C})`), scalar(`max(postgresql_max_connections${C})`), scalar(`sum(postgresql_db_size${L})`),
  ])
  walRate.value = last(wal); ioRate.value = last(io)
  loading.value = false
}

const connectionRatio = computed(() => maxConnections.value > 0 ? connections.value / maxConnections.value : NaN)
const growth = computed(() => growthPerHour(sizeSeries.value))
const scaleMessage = computed(() => {
  if (isFinite(connectionRatio.value) && connectionRatio.value >= 0.85) return 'Connection headroom is becoming the limiting resource. Check pooling and idle-in-transaction sessions before increasing the database size.'
  if (isFinite(ioRate.value) && ioRate.value > 0 && ioRate.value > 50 * 1024 * 1024) return 'Storage throughput is carrying a sustained read load. Correlate this with latency and host I/O saturation before scaling storage.'
  if (isFinite(growth.value) && growth.value > 0) return 'Storage is growing. Set a retention or capacity alert using the observed growth rate and the actual volume limit.'
  return 'No single scaling pressure is dominant in the current 24-hour window.'
})
onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-capacity">
    <section class="capacity-head"><div><div class="eyebrow">Sustained pressure and growth</div><h2>Capacity outlook</h2><p>Use trends and correlated saturation signals to decide whether to tune, pool, scale vertically, add replicas, or change the data layout.</p></div><div class="capacity-note">{{ scaleMessage }}</div></section>
    <section class="metric-strip"><div><span>Connections</span><strong>{{ isFinite(connections) ? Math.round(connections).toLocaleString() : '—' }} <small>/ {{ isFinite(maxConnections) ? Math.round(maxConnections).toLocaleString() : '—' }}</small></strong><em>{{ isFinite(connectionRatio) ? `${(connectionRatio * 100).toFixed(0)}% used` : 'no ceiling data' }}</em></div><div><span>Database size</span><strong>{{ fmtBytes(dbSize) }}</strong><em>{{ isFinite(growth) ? `${fmtBytes(growth)}/hour` : 'growth needs more samples' }}</em></div><div><span>WAL rate</span><strong>{{ fmtRate(walRate) }}</strong><em>current five-minute rate</em></div><div><span>Read I/O</span><strong>{{ fmtRate(ioRate) }}</strong><em>current five-minute rate</em></div></section>
    <section class="chart-section"><div class="chart-head"><div><h3>Database size</h3><p>24-hour trend. Growth is observed from the first and latest samples.</p></div><strong>{{ fmtBytes(growth) }} / hour</strong></div><TimeseriesWidget :buckets="[]" :series="[sizeSeries]" unit="B" /></section>
    <section class="chart-grid"><div class="chart-section"><div class="chart-head"><div><h3>WAL generation</h3><p>Write volume drives storage, replica lag, and archive workload.</p></div></div><TimeseriesWidget :buckets="[]" :series="[walSeries]" unit="B/s" /></div><div class="chart-section"><div class="chart-head"><div><h3>Read I/O</h3><p>Correlate with host storage latency and cache behavior.</p></div></div><TimeseriesWidget :buckets="[]" :series="[ioSeries]" unit="B/s" /></div></section>
  </div>
</template>

<style scoped>
.pg-capacity { display: grid; gap: 22px; }
.capacity-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.capacity-head p, .chart-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.capacity-note { max-width: 320px; align-self: flex-start; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; border: 1px solid var(--border-subtle); background: var(--border-subtle); }
.metric-strip > div { display: grid; gap: 5px; padding: 16px; background: var(--bg-surface); }
.metric-strip span, .metric-strip em { color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; font-style: normal; }
.metric-strip strong { color: var(--text-primary); font: 600 18px var(--font-mono, monospace); }
.metric-strip small { color: var(--text-tertiary); font-size: 12px; font-weight: 400; }
.chart-section { min-width: 0; padding: 16px 18px 10px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.chart-head { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 9px; }
h3 { margin: 0 0 3px; font-size: 15px; }
.chart-head > strong { color: var(--text-primary); font: 600 13px var(--font-mono, monospace); white-space: nowrap; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
@media (max-width: 860px) { .capacity-head { display: block; } .capacity-note { margin-top: 16px; max-width: none; } .metric-strip { grid-template-columns: 1fr 1fr; } .chart-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .metric-strip { grid-template-columns: 1fr; } }
</style>
