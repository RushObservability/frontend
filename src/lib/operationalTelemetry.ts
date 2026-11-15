export type OperationalAttributes = Record<string, string | number>
type Sink = (name: string, attributes: OperationalAttributes) => void
interface Summary { name: string; labels: Record<string, string>; values: Record<string, number> }
const BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]
const MAX_SERIES = 64
const FLUSH_MS = 10_000
const LIMIT = Number.MAX_SAFE_INTEGER
const safeNumber = (value: number) => Math.min(LIMIT, Math.max(0, value))

/** Bounded numeric aggregates only. No timer runs while self-monitoring is disabled. */
export function createOperationalTelemetry() {
  const pending = new Map<string, Summary>()
  let sink: Sink | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let dropped = 0
  const schedule = () => {
    if (sink && !timer && (pending.size || dropped)) timer = setTimeout(flush, FLUSH_MS)
  }
  function record(name: string, labels: Record<string, string> = {}, durationMs?: number, counters: Record<string, number> = {}) {
    if (!/^frontend_[a-z0-9_]{1,48}$/.test(name)) return
    const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length > 5 || entries.some(([key, value]) => !/^[a-z][a-z0-9_]{0,31}$/.test(key) || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(value))) return
    const key = JSON.stringify([name, entries])
    let summary = pending.get(key)
    if (!summary) {
      if (pending.size >= MAX_SERIES) { dropped = safeNumber(dropped + 1); schedule(); return }
      summary = { name, labels: Object.fromEntries(entries), values: {} }
      pending.set(key, summary)
    }
    const add = (key: string, value: number) => {
      summary.values[key] = safeNumber((summary.values[key] || 0) + value)
    }
    add('count', 1)
    for (const [key, value] of Object.entries(counters).slice(0, 12)) {
      if (/^[a-z][a-z0-9_]{0,47}$/.test(key) && Number.isFinite(value) && value >= 0) add(key, value)
    }
    if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) {
      add('duration_count', 1)
      add('duration_ms_sum', durationMs)
      summary.values.duration_ms_max = Math.max(summary.values.duration_ms_max || 0, safeNumber(durationMs))
      for (const bucket of BUCKETS_MS) if (durationMs <= bucket) add(`duration_ms_le_${bucket}`, 1)
    }
    schedule()
  }
  function flush() {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!sink) return
    for (const [key, summary] of pending) {
      try { sink(summary.name, { ...summary.labels, ...summary.values }); pending.delete(key) } catch { break }
    }
    if (dropped) {
      try { sink('frontend_telemetry_dropped', { count: dropped }); dropped = 0 } catch { /* retain bounded totals until recovery */ }
    }
    schedule()
  }
  function setSink(next: Sink | null) {
    if (timer) clearTimeout(timer)
    timer = undefined
    sink = next
    schedule()
  }
  return { record, flush, setSink }
}
const telemetry = createOperationalTelemetry()
export const recordOperationalMetric = telemetry.record
export const flushOperationalMetrics = telemetry.flush
export const setOperationalMetricSink = telemetry.setSink
