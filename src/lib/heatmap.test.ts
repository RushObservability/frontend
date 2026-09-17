import { describe, expect, it } from 'vitest'
import { buildHeatmap } from './heatmap'

describe('buildHeatmap', () => {
  it('keeps series identity, zero values, and missing buckets separate', () => {
    const result = buildHeatmap([
      { name: 'A', points: [[10, 0], [20, 10]] },
      { name: 'B', points: [[20, 1]] },
    ], { from: 10, to: 30 })
    expect(result.rows[0]?.cells[0]).toBe(0)
    expect(result.rows[0]?.cells[30]).toBe(10)
    expect(result.rows[1]?.cells[0]).toBeNull()
    expect(result.rows[1]?.cells[30]).toBe(1)
    expect(result.max).toBe(10)
  })

  it('averages multiple samples in one visual bucket and ignores invalid values', () => {
    const result = buildHeatmap([{ name: 'requests', points: [[10, 2], [10.05, 4], [12, NaN], [30, 99]] }], { from: 10, to: 20 })
    expect(result.rows[0]?.cells[0]).toBe(3)
    expect(result.rows[0]?.cells[30]).toBeNull()
    expect(result.rows[0]?.cells).toHaveLength(60)
  })
})
