import { describe, expect, it } from 'vitest'
import { buildPie, pieSlicePath, formatPieValue } from './pie'

describe('pie calculations', () => {
  const data = { series: [
    { name: 'payments', points: [[2, 30], [1, 10], [3, NaN]] as [number, number][] },
    { name: 'checkout', points: [[1, 20], [2, 70]] as [number, number][] },
  ] }
  it('defaults to the latest finite value, sorted largest first', () => {
    const result = buildPie(data)
    expect(result.total).toBe(100)
    expect(result.slices.map(s => [s.name, s.value, s.percent])).toEqual([['checkout', 70, 70], ['payments', 30, 30]])
  })
  it('supports mean and sum without mistaking summed samples for counter increases', () => {
    expect(buildPie(data, 'sum').total).toBe(130)
    expect(buildPie(data, 'mean').total).toBe(65)
  })
  it('keeps group counts and colors across calculation, order, and refresh changes', () => {
    const groups = [{ key: 'payments', count: 10 }, { key: 'checkout', count: 20 }]
    const original = buildPie({ groups }, 'sum', 'none')
    const sorted = buildPie({ groups: [...groups].reverse() }, 'mean', 'ascending')
    expect(sorted.total).toBe(30)
    expect(original.slices.map(s => s.color)).toEqual(sorted.slices.map(s => s.color))
  })
  it('does not draw zero, invalid, negative, or overflowing data', () => {
    expect(buildPie({}).slices).toEqual([])
    const result = buildPie({ groups: [{ key: 'zero', count: 0 }, { key: 'negative', count: -1 }, { key: 'bad', count: Infinity }, { key: 'ok', count: 7 }] })
    expect(result.omitted).toBe(2)
    expect(result.total).toBe(7)
    expect(result.slices).toHaveLength(1)
    expect(result.slices[0]!.percent).toBe(100)
    expect(buildPie({ groups: [{ key: 'a', count: 1e308 }, { key: 'b', count: 1e308 }] }).slices).toEqual([])
  })
  it('draws a full circle with two arcs, and a donut with reversed inner arcs', () => {
    const full = pieSlicePath(-Math.PI / 2, Math.PI * 1.5, 0)
    expect(full.match(/A 92 92/g)).toHaveLength(2)
    expect(full).toContain('L 100,100 Z')
    const donut = pieSlicePath(-Math.PI / 2, Math.PI * 1.5, 59)
    expect(donut.match(/A 59 59/g)).toHaveLength(2)
    expect(donut).not.toContain('NaN')
    expect(donut).not.toContain('L 100,100')
  })
  it('formats units without scaling their values', () => {
    expect(formatPieValue(20, 'events/s')).toBe('20 events/s')
    expect(formatPieValue(25, '%')).toBe('25%')
  })
})
