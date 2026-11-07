import type { LogPattern, ScatterPoint, TimeDomain, TimelineState } from '../types'

export const DEFAULT_TIMELINE_STATES: TimelineState[] = [
  { value: 0, label: 'Unavailable', color: 'red' },
  { value: 1, label: 'Healthy', color: 'green' },
  { value: 2, label: 'Degraded', color: 'yellow' },
]
export const STATE_COLORS = ['green', 'yellow', 'red', 'blue', 'purple'] as const
export function stateColor(color: string) {
  return ({ green: 'var(--ok)', yellow: 'var(--warning)', red: 'var(--error)', blue: 'var(--accent)', purple: '#8b5cf6' } as Record<string, string>)[color] || 'var(--accent)'
}

export function timelineStates(value: unknown): TimelineState[] {
  if (!Array.isArray(value)) return DEFAULT_TIMELINE_STATES.map(s => ({ ...s }))
  const seen = new Set<number>()
  return value.slice(0, 20).flatMap(s => {
    if (!s || typeof s.value !== 'number' || !Number.isFinite(s.value) || seen.has(s.value)
      || typeof s.label !== 'string' || !s.label.trim() || !STATE_COLORS.includes(s.color)) return []
    seen.add(s.value)
    return [{ value: s.value, label: s.label.slice(0, 80), color: s.color } as TimelineState]
  })
}

export interface StateSegment { from: number; to: number; value: number | null }
export function stateSegments(points: [number, number][], domain: TimeDomain, step: number): StateSegment[] {
  if (!(domain.to > domain.from)) return []
  const hold = Number.isFinite(step) && step > 0 ? step * 1.5 : 60
  const sorted = [...new Map(points.filter(([time]) => Number.isFinite(time)).map(p => [p[0], p])).values()]
    .sort((a, b) => a[0] - b[0])
  const result: StateSegment[] = []
  function push(from: number, to: number, value: number | null) {
    if (to <= from) return
    const prev = result[result.length - 1]
    if (prev && prev.value === value && Math.abs(prev.to - from) < 0.001) prev.to = to
    else result.push({ from, to, value })
  }
  let cursor = domain.from
  sorted.forEach(([time, value], i) => {
    const from = Math.max(time, domain.from, cursor)
    const to = Math.min(domain.to, sorted[i + 1]?.[0] ?? domain.to, time + hold)
    if (to <= from || from >= domain.to) return
    push(cursor, from, null)
    push(from, to, Number.isFinite(value) ? value : null)
    cursor = to
  })
  push(cursor, domain.to, null)
  return result
}

export function patternSpark(pattern: LogPattern, domain?: TimeDomain, columns = 30): number[] {
  const times = pattern.buckets.map(b => b[0]).filter(Number.isFinite)
  const from = domain?.from ?? Math.min(...times)
  const to = domain?.to ?? Math.max(...times) + 1
  const bins = Array<number>(columns).fill(0)
  if (!(to > from)) return bins
  // Server buckets are aligned to wall-clock seconds. Include the first
  // partially overlapping bucket instead of dropping its in-range events.
  const step = Math.max(1, Math.floor((to - from) / 60))
  for (const [time, count] of pattern.buckets) {
    if (!Number.isFinite(time) || !Number.isFinite(count) || time + step <= from || time > to) continue
    const i = Math.min(columns - 1, Math.floor((Math.max(time, from) - from) / (to - from) * columns))
    bins[i]! += Math.max(0, count)
  }
  return bins
}

export function scatterBounds(points: ScatterPoint[], field: 'x' | 'y'): [number, number] {
  const values = points.map(p => p[field]).filter(Number.isFinite)
  if (!values.length) return [0, 1]
  const min = Math.min(...values), max = Math.max(...values)
  const pad = max === min ? Math.max(Math.abs(min) * .05, 1) : (max - min) * .07
  return [min >= 0 ? Math.max(0, min - pad) : min - pad, max + pad]
}

export function scatterTicks(domain: [number, number], count = 5): number[] {
  const raw = (domain[1] - domain[0]) / Math.max(1, count - 1)
  if (!(raw > 0) || !Number.isFinite(raw)) return []
  const power = 10 ** Math.floor(Math.log10(raw)), ratio = raw / power
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power
  const start = Math.ceil(domain[0] / step) * step
  return Array.from({ length: Math.min(10, Math.max(0, Math.floor((domain[1] - start) / step) + 1)) }, (_, i) => Number((start + step * i).toPrecision(12)))
}

export function eventLink(point: Pick<ScatterPoint, 'trace_id' | 'span_id' | 'service' | 'timestamp'>, source: 'logs' | 'spans', domain?: TimeDomain) {
  if (source === 'spans' && /^[a-f0-9]{16,32}$/i.test(point.trace_id)) {
    return { name: 'trace', params: { traceId: point.trace_id }, query: { span: point.span_id || undefined } }
  }
  const filters = point.trace_id ? `trace_id=${JSON.stringify(point.trace_id)}` : `service_name=${JSON.stringify(point.service)}`
  return { path: '/', query: { mode: source === 'logs' ? 'logs' : 'spans', q: filters,
    from: domain ? new Date(domain.from * 1000).toISOString() : undefined,
    to: domain ? new Date(domain.to * 1000).toISOString() : undefined } }
}
