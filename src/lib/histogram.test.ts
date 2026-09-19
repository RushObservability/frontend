import { describe, expect, it } from 'vitest'
import { buildHistogram, histogramAxisTicks } from './histogram'

describe('dashboard histogram buckets', () => {
  it('counts finite samples across all series and includes the maximum in the last bin', () => {
    const result = buildHistogram([
      { points: [[1, 0], [2, 1], [3, 2], [4, Number.NaN]] },
      { points: [[5, 2], [6, Number.POSITIVE_INFINITY]] },
    ], 2)
    expect(result.sampleCount).toBe(4)
    expect(result.bins.map(bin => bin.count)).toEqual([1, 3])
    expect(result.minLabel).toBe('0')
    expect(result.maxLabel).toBe('2')
  })

  it('keeps a constant series in one bin', () => {
    expect(buildHistogram([{ points: [[1, 12], [2, 12]] }], 20).bins).toEqual([{ key: '12', count: 2, lower: 12, upper: 12 }])
  })

  it('returns an empty distribution without finite values', () => {
    expect(buildHistogram([{ points: [[1, Number.NaN]] }]).bins).toEqual([])
  })

  it('positions numeric ticks at bucket boundaries and thins narrow charts', () => {
    const { bins } = buildHistogram([{ points: [[1, 1.04], [2, 1.26]] }], 22)
    const wide = histogramAxisTicks(bins, 1800)
    const narrow = histogramAxisTicks(bins, 250)
    expect(wide).toHaveLength(23)
    expect(wide[0]).toEqual({ position: 0, label: '1.04' })
    expect(wide[1]!.position).toBeCloseTo(1 / 22)
    expect(wide[1]!.label).toBe('1.05')
    expect(wide.at(-1)).toEqual({ position: 1, label: '1.26' })
    expect(narrow.length).toBeLessThan(wide.length)
    expect(narrow[0]!.position).toBe(0)
    expect(narrow.at(-1)!.position).toBe(1)
    for (let i = 1; i < narrow.length; i++) {
      expect((narrow[i]!.position - narrow[i - 1]!.position) * 250).toBeGreaterThanOrEqual(44)
    }
  })

  it('handles constant, negative, tiny and non-numeric buckets', () => {
    expect(histogramAxisTicks(buildHistogram([{ points: [[1, 12]] }]).bins, 500, 'ms'))
      .toEqual([{ position: 0.5, label: '12 ms' }])
    const tiny = histogramAxisTicks(buildHistogram([{ points: [[1, 1e-8], [2, 2e-8]] }], 2).bins, 500)
    expect(new Set(tiny.map(tick => tick.label)).size).toBe(3)
    expect(histogramAxisTicks(buildHistogram([{ points: [[1, -20], [2, 20]] }], 2).bins, 500)[1]!.label).toBe('0')
    expect(histogramAxisTicks([{ key: '<1 ms', count: 3 }], 500)).toEqual([])
    expect(histogramAxisTicks([], 500)).toEqual([])
  })
})
