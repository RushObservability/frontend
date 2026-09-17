import type { TimeDomain } from '../types'

export interface HeatmapSeries {
  name: string
  points: [number, number][]
}

export interface HeatmapRow {
  name: string
  cells: Array<number | null>
}

export interface HeatmapData {
  rows: HeatmapRow[]
  domain: TimeDomain
  columns: number
  min: number
  max: number
}

/** Keep empty time buckets distinct from measured zeroes. */
export function buildHeatmap(series: HeatmapSeries[], timeDomain?: TimeDomain): HeatmapData {
  const samples = series.flatMap(item => item.points.filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value)))
  const sampleTimes = [...new Set(samples.map(([time]) => time))].sort((a, b) => a - b)
  const from = timeDomain?.from ?? sampleTimes[0] ?? 0
  const to = timeDomain?.to ?? sampleTimes[sampleTimes.length - 1] ?? from + 1
  const domain = { from, to: Math.max(from + 1, to) }
  // A fixed-width grid keeps a sparse sample at its actual time instead of
  // stretching it across the entire requested window.
  const columns = timeDomain ? 60 : Math.min(60, Math.max(1, sampleTimes.length))
  const width = (domain.to - domain.from) / columns
  const rows = series.map(item => {
    const sums = Array<number>(columns).fill(0)
    const counts = Array<number>(columns).fill(0)
    for (const [time, value] of item.points) {
      if (!Number.isFinite(time) || !Number.isFinite(value) || time < domain.from || time > domain.to) continue
      const index = Math.min(columns - 1, Math.floor((time - domain.from) / width))
      sums[index] = (sums[index] ?? 0) + value
      counts[index] = (counts[index] ?? 0) + 1
    }
    return {
      name: item.name,
      cells: counts.map((count, index) => count ? (sums[index] ?? 0) / count : null),
    }
  })
  const values = rows.flatMap(row => row.cells.filter((value): value is number => value !== null))
  return { rows, domain, columns, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 }
}
