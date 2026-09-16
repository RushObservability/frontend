import { describe, expect, it } from 'vitest'
import { stackTimeLines } from './stackedTimeLines'

describe('stacked time lines', () => {
  it('stacks smaller series below larger ones at matching timestamps', () => {
    const layers = stackTimeLines([
      { name: 'Application', points: [[100, 30], [200, 40]] },
      { name: 'Database', points: [[100, 70], [200, 20]] },
      { name: 'Network', points: [[100, 5], [200, 10]] },
    ])
    expect(layers.map(layer => layer.segments[0]!.map(({ bottom, top }) => [bottom, top]))).toEqual([
      [[5, 35], [10, 50]],
      [[35, 105], [50, 70]],
      [[0, 5], [0, 10]],
    ])
  })

  it('keeps A above a smaller B without changing either series identity', () => {
    const layers = stackTimeLines([
      { name: 'A', points: [[100, 10], [200, 10]] },
      { name: 'B', points: [[100, 1], [200, 1]] },
    ])
    expect(layers[0]!.segments[0]).toEqual([
      { time: 100, bottom: 1, top: 11 },
      { time: 200, bottom: 1, top: 11 },
    ])
    expect(layers[1]!.segments[0]).toEqual([
      { time: 100, bottom: 0, top: 1 },
      { time: 200, bottom: 0, top: 1 },
    ])
  })

  it('keeps the stack order fixed when series cross', () => {
    const layers = stackTimeLines([
      { name: 'A', points: [[100, 10], [200, 1]] },
      { name: 'B', points: [[100, 2], [200, 8]] },
    ])
    expect(layers[0]!.segments[0]!.map(point => point.bottom)).toEqual([2, 8])
  })

  it('keeps left and right axes separate', () => {
    const layers = stackTimeLines([
      { name: 'Left', points: [[100, 30]] },
      { name: 'Right', axis: 'right', points: [[100, 7]] },
    ])
    expect(layers[1]!.segments[0]![0]).toEqual({ time: 100, bottom: 0, top: 7 })
  })

  it('breaks lines at missing or invalid samples instead of inventing zeroes', () => {
    const layers = stackTimeLines([
      { name: 'Base', points: [[100, 1], [200, 2], [300, 3]] },
      { name: 'Upper', points: [[100, 5], [200, -1], [300, 7]] },
    ])
    expect(layers[1]!.segments).toEqual([
      [{ time: 100, bottom: 1, top: 6 }],
      [{ time: 300, bottom: 3, top: 10 }],
    ])
  })
})
