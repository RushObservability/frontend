export interface HistogramSeries {
  points: [number, number][]
}

export interface HistogramBin {
  key: string
  count: number
  lower?: number
  upper?: number
}

export interface HistogramDistribution {
  bins: HistogramBin[]
  minLabel: string
  maxLabel: string
  sampleCount: number
}

function formatValue(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.0001) return Number(value.toPrecision(4)).toString()
  return Number(value.toPrecision(4)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** Labels sit on bucket edges. Keep enough space for full, unrotated labels. */
export function histogramAxisTicks(bins: HistogramBin[], plotWidth: number, unit = '') {
  if (!bins.length || bins.some(bin => !Number.isFinite(bin.lower) || !Number.isFinite(bin.upper))) return []
  const min = bins[0]!.lower!
  const max = bins[bins.length - 1]!.upper!
  const label = (value: number) => {
    const number = value !== 0 && Math.abs(value) < 0.0001
      ? Number(value.toPrecision(12)).toString()
      : Number(value.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 12 })
    return `${number}${unit ? ` ${unit}` : ''}`
  }
  if (min === max) return [{ position: 0.5, label: label(min) }]
  const boundaries = [...bins.map(bin => bin.lower!), max]
  const spacing = Math.max(52, ...boundaries.map(value => label(value).length * 7 + 16))
  const intervals = Math.max(1, Math.floor(plotWidth / spacing))
  const stride = Math.max(1, Math.ceil(bins.length / intervals))
  const ticks = boundaries.flatMap((value, index) => index % stride === 0
    ? [{ position: (value - min) / (max - min), label: label(value) }] : [])
  if (ticks[ticks.length - 1]!.position !== 1) {
    if (ticks.length > 1 && (1 - ticks[ticks.length - 1]!.position) * plotWidth < spacing) ticks.pop()
    ticks.push({ position: 1, label: label(max) })
  }
  return ticks
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
      lower: min + index * width,
      upper: index === count - 1 ? max : min + (index + 1) * width,
    })),
    minLabel: formatValue(min),
    maxLabel: formatValue(max),
    sampleCount: values.length,
  }
}
