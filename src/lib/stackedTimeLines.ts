import type { TimeSeriesPanelSeries } from '../components/panels/types'

export interface StackedLinePoint {
  time: number
  bottom: number
  top: number
}

export interface StackedLineLayer {
  seriesIndex: number
  axis: 'left' | 'right'
  segments: StackedLinePoint[][]
}

/** Stack series at shared timestamps without filling missing samples with zeroes. */
export function stackTimeLines(series: TimeSeriesPanelSeries[]): StackedLineLayer[] {
  const values = series.map(item => new Map(
    item.points.filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value) && value >= 0),
  ))
  const magnitudes = values.map(points => (
    [...points.values()].reduce((sum, value) => sum + value, 0) / (points.size || 1)
  ))
  const layers: StackedLineLayer[] = series.map((item, seriesIndex) => ({
    seriesIndex,
    axis: item.axis || 'left',
    segments: [],
  }))

  for (const axis of ['left', 'right'] as const) {
    // Keep one order for the whole window. Putting smaller series underneath
    // stops a small second query from taking over the chart's top boundary.
    const indexes = layers
      .filter(layer => layer.axis === axis && values[layer.seriesIndex]!.size)
      .map(layer => layer.seriesIndex)
      .sort((a, b) => magnitudes[a]! - magnitudes[b]! || a - b)
    const times = [...new Set(indexes.flatMap(index => [...values[index]!.keys()]))].sort((a, b) => a - b)
    const totals = new Map(times.map(time => [time, 0]))
    const available = new Set(times)

    for (const index of indexes) {
      const segments = layers[index]!.segments
      let segment: StackedLinePoint[] = []
      for (const time of times) {
        const value = values[index]!.get(time)
        if (!available.has(time) || value === undefined) {
          available.delete(time)
          if (segment.length) segments.push(segment)
          segment = []
          continue
        }
        const bottom = totals.get(time)!
        const top = bottom + value
        totals.set(time, top)
        segment.push({ time, bottom, top })
      }
      if (segment.length) segments.push(segment)
    }
  }

  return layers
}
