import { describe, expect, it } from 'vitest'
import { hasWidgetSamples } from './queryDiagnostics'

describe('missing dashboard data', () => {
  it('keeps zero measurements distinct from absent measurements', () => {
    expect(hasWidgetSamples({ type: 'timeseries', series: [{ name: 'cpu', points: [[1, 0]] }] })).toBe(true)
    expect(hasWidgetSamples({ type: 'counter', count: 0 })).toBe(true)
    expect(hasWidgetSamples({ type: 'timeseries', series: [{ name: 'cpu', points: [[1, NaN]] }] })).toBe(false)
    expect(hasWidgetSamples({ type: 'timeseries', series: [] })).toBe(false)
    expect(hasWidgetSamples({ type: 'table', rows: [] })).toBe(false)
  })
})
