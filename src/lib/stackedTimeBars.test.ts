import { describe, expect, it } from 'vitest'
import { stackTimeSeries } from './stackedTimeBars'

describe('stacked time bars', () => {
  it('adds application and database time at the same timestamp', () => {
    const bars = stackTimeSeries([
      { name: 'Application', points: [[100, 30], [200, 40]] },
      { name: 'Database', points: [[100, 70], [200, 20]] },
    ])
    expect(bars.map(({ bottom, top }) => [bottom, top])).toEqual([[0, 30], [0, 40], [30, 100], [40, 60]])
  })
  it('does not fill missing intervals or combine separate axes', () => {
    const bars = stackTimeSeries([
      { name: 'A', points: [[100, 30], [300, 10]] },
      { name: 'B', axis: 'right', points: [[100, 7]] },
    ])
    expect(bars).toHaveLength(3)
    expect(bars[2]?.bottom).toBe(0)
    expect(bars.some(bar => bar.time === 200)).toBe(false)
  })
  it('ignores invalid and negative samples and retains zero', () => {
    expect(stackTimeSeries([{ name: 'A', points: [[1, NaN], [NaN, 2], [3, -1], [4, 0]] }]))
      .toEqual([{ time: 4, value: 0, bottom: 0, top: 0, axis: 'left', seriesIndex: 0 }])
  })
})
