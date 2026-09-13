import type { TimeSeriesPanelSeries } from '../components/panels/types'

/** Stack matching intervals only; absent intervals remain gaps. */
export function stackTimeSeries(series: TimeSeriesPanelSeries[]) {
  const totals = new Map<string, number>()
  return series.flatMap((item, seriesIndex) => item.points.flatMap(([time, value]) => {
    if (!Number.isFinite(time) || !Number.isFinite(value) || value < 0) return []
    const axis = item.axis || 'left'
    const key = `${axis}:${time}`
    const bottom = totals.get(key) || 0
    const top = bottom + value
    totals.set(key, top)
    return [{ time, value, bottom, top, axis, seriesIndex }]
  }))
}
