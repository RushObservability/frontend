import { describe, expect, it } from 'vitest'
import { buildHistogram } from './histogram'

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
    expect(buildHistogram([{ points: [[1, 12], [2, 12]] }], 20).bins).toEqual([{ key: '12', count: 2 }])
  })

  it('returns an empty distribution without finite values', () => {
    expect(buildHistogram([{ points: [[1, Number.NaN]] }]).bins).toEqual([])
  })
})
