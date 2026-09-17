export interface HistogramSeries {
  points: [number, number][]
}

export interface HistogramDistribution {
  bins: Array<{ key: string; count: number }>
  minLabel: string
  maxLabel: string
  sampleCount: number
}

function formatValue(value: number): string {
  return Number(value.toPrecision(4)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** Bucket returned numeric samples, not the underlying events represented by an aggregate. */
export function buildHistogram(series: HistogramSeries[], requestedBins = 20): HistogramDistribution {
  const values = series.flatMap(item => item.points.map(([, value]) => value).filter(Number.isFinite))
  if (!values.length) return { bins: [], minLabel: '', maxLabel: '', sampleCount: 0 }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const count = min === max ? 1 : Math.max(2, Math.min(50, Math.round(requestedBins) || 20))
  const width = count === 1 ? 0 : (max - min) / count
  const frequencies = Array<number>(count).fill(0)
  for (const value of values) {
    const index = count === 1 ? 0 : Math.min(count - 1, Math.floor((value - min) / width))
    frequencies[index] = (frequencies[index] ?? 0) + 1
  }
  return {
    bins: frequencies.map((frequency, index) => ({
      key: count === 1 ? formatValue(min) : `${formatValue(min + index * width)}–${formatValue(min + (index + 1) * width)}`,
      count: frequency,
    })),
    minLabel: formatValue(min),
    maxLabel: formatValue(max),
    sampleCount: values.length,
  }
}
