import { describe, expect, it } from 'vitest'
import { stackTimeLines } from './stackedTimeLines'

describe('stacked time lines', () => {
  it('places each line on the previous line at matching timestamps', () => {
    const layers = stackTimeLines([
      { name: 'Application', points: [[100, 30], [200, 40]] },
      { name: 'Database', points: [[100, 70], [200, 20]] },
      { name: 'Network', points: [[100, 5], [200, 10]] },
    ])
    expect(layers.map(layer => layer.segments[0]!.map(({ bottom, top }) => [bottom, top]))).toEqual([
      [[0, 30], [0, 40]],
      [[30, 100], [40, 60]],
      [[100, 105], [60, 70]],
    ])
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
      { name: 'Base', points: [[100, 10], [200, 20], [300, 30]] },
      { name: 'Upper', points: [[100, 5], [200, -1], [300, 7]] },
    ])
    expect(layers[1]!.segments).toEqual([
      [{ time: 100, bottom: 10, top: 15 }],
      [{ time: 300, bottom: 30, top: 37 }],
    ])
  })
})
