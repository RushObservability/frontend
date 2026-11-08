import type { Notebook, NotebookCellTime } from '../types'

export interface TimeRange { from: string; to: string }

/** The incident window as dates; an ongoing incident ends now. */
export function incidentWindow(nb: Pick<Notebook, 'incident_start' | 'incident_end'>, now: Date): { from: Date; to: Date } {
  const from = new Date(nb.incident_start)
  const to = nb.incident_end ? new Date(nb.incident_end) : now
  return { from, to: to > from ? to : new Date(from.getTime() + 60_000) }
}

/** The only place a cell's time setting becomes a fixed range for a query. */
export function resolveCellTime(
  nb: Pick<Notebook, 'incident_start' | 'incident_end'>,
  time: NotebookCellTime,
  now: Date,
): TimeRange {
  const window = incidentWindow(nb, now)
  switch (time.mode) {
    case 'absolute':
      return { from: new Date(time.from).toISOString(), to: new Date(time.to).toISOString() }
    case 'relative': {
      const start = window.from.getTime()
      return {
        from: new Date(start + time.offset_from_min * 60_000).toISOString(),
        to: new Date(start + time.offset_to_min * 60_000).toISOString(),
      }
    }
    case 'live':
      return { from: new Date(now.getTime() - time.minutes * 60_000).toISOString(), to: now.toISOString() }
    default:
      return { from: window.from.toISOString(), to: window.to.toISOString() }
  }
}

export interface RulerSegment {
  /** Percent of the incident window, both clamped to 0–100. */
  left: number
  width: number
  /** The range starts before or ends after the incident window. */
  clippedStart: boolean
  clippedEnd: boolean
}

/** Where a range sits inside the incident window, for the bar under each cell. */
export function rulerSegment(
  nb: Pick<Notebook, 'incident_start' | 'incident_end'>,
  range: TimeRange,
  now: Date,
): RulerSegment {
  const window = incidentWindow(nb, now)
  const start = window.from.getTime()
  const span = window.to.getTime() - start
  const pct = (t: number) => ((t - start) / span) * 100
  const rawLeft = pct(new Date(range.from).getTime())
  const rawRight = pct(new Date(range.to).getTime())
  const left = Math.min(100, Math.max(0, rawLeft))
  const right = Math.min(100, Math.max(0, rawRight))
  return { left, width: Math.max(right - left, 0.5), clippedStart: rawLeft < 0, clippedEnd: rawRight > 100 }
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  const text = abs % 60 === 0 && abs >= 60 ? `${abs / 60}h` : `${abs}m`
  return `T${sign}${text}`
}

export function formatClock(iso: string, withDate: boolean): string {
  return new Date(iso).toLocaleString('en-US', {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function formatRange(range: TimeRange): string {
  const sameDay = new Date(range.from).toDateString() === new Date(range.to).toDateString()
  return `${formatClock(range.from, !sameDay)} → ${formatClock(range.to, !sameDay)}`
}

/** Short text for a cell's time chip. */
export function cellTimeLabel(time: NotebookCellTime): string {
  switch (time.mode) {
    case 'absolute': return formatRange(time)
    case 'relative': return `${offsetLabel(time.offset_from_min)} → ${offsetLabel(time.offset_to_min)}`
    case 'live': return `Live · last ${time.minutes >= 60 && time.minutes % 60 === 0 ? `${time.minutes / 60}h` : `${time.minutes}m`}`
    default: return 'Incident window'
  }
}

/** An ISO time as a `datetime-local` input value, in the browser's zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A `datetime-local` input value as an ISO time, or '' when it isn't a time. */
export function fromLocalInput(value: string): string {
  const d = new Date(value)
  return value && !Number.isNaN(d.getTime()) ? d.toISOString() : ''
}

/** Run at most `limit` tasks at once; the rest wait their turn. */
export function createLimiter(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}
