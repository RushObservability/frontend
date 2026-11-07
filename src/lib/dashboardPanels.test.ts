import { describe, expect, it } from 'vitest'
import { eventLink, patternSpark, scatterBounds, scatterTicks, stateSegments, timelineStates } from './dashboardPanels'
import type { LogPattern, ScatterPoint } from '../types'

describe('state timelines', () => {
  it('keeps the full window, measured zero, and gaps between sparse samples', () => {
    expect(stateSegments([[20, 0], [80, 1]], { from: 0, to: 100 }, 10)).toEqual([
      { from: 0, to: 20, value: null }, { from: 20, to: 35, value: 0 },
      { from: 35, to: 80, value: null }, { from: 80, to: 95, value: 1 }, { from: 95, to: 100, value: null },
    ])
  })
  it('merges adjacent equal states and uses the last duplicate sample', () => {
    expect(stateSegments([[10, 1], [0, 0], [10, 0], [20, 1]], { from: 0, to: 30 }, 10)).toEqual([
      { from: 0, to: 20, value: 0 }, { from: 20, to: 30, value: 1 },
    ])
  })
  it('does not turn NaN into a state or extend pre-window samples forever', () => {
    expect(stateSegments([[-100, 1], [5, NaN]], { from: 0, to: 20 }, 1)).toEqual([{ from: 0, to: 20, value: null }])
    expect(stateSegments([], { from: 0, to: 20 }, 1)).toEqual([{ from: 0, to: 20, value: null }])
  })
  it('clips partial overlaps and handles invalid domains', () => {
    expect(stateSegments([[-5, 2], [15, 0]], { from: 0, to: 10 }, 10)).toEqual([{ from: 0, to: 10, value: 2 }])
    expect(stateSegments([[0, 1]], { from: 1, to: 1 }, 10)).toEqual([])
  })
  it('accepts only named finite unique values and safe semantic colors', () => {
    expect(timelineStates([{ value: 0, label: 'Offline', color: 'red' }, { value: 0, label: 'Duplicate', color: 'green' }, { value: NaN, label: 'Invalid', color: 'red' }, { value: 1, label: 'Injected', color: 'red);url(https://bad)' }])).toEqual([{ value: 0, label: 'Offline', color: 'red' }])
    expect(timelineStates(undefined)).toHaveLength(3)
  })
})

describe('scatter plots and pattern volume', () => {
  it('uses the full selected time domain for a sparse pattern sparkline', () => {
    const pattern = { buckets: [[50, 3], [51, 2], [100, 1], [-1, 10]] } as LogPattern
    expect(patternSpark(pattern, { from: 0, to: 100 }, 4)).toEqual([0, 0, 5, 1])
    expect(patternSpark({ buckets: [[0, 4]] } as LogPattern, { from: .5, to: 60.5 }, 4)).toEqual([4, 0, 0, 0])
  })
  it('pads identical and negative values without inventing zero-valued events', () => {
    expect(scatterBounds([{ x: 0 }, { x: NaN }] as ScatterPoint[], 'x')).toEqual([0, 1])
    const bounds = scatterBounds([{ x: -20 }, { x: -10 }] as ScatterPoint[], 'x')
    expect(bounds[0]).toBeLessThan(-20); expect(bounds[1]).toBeGreaterThan(-10)
    expect(scatterBounds([], 'y')).toEqual([0, 1])
    expect(scatterTicks([0, 468.6])).toEqual([0, 200, 400])
  })
  it('links span points to a trace and log points to the captured window', () => {
    const point = { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), service: 'payments', timestamp: 'now' }
    expect(eventLink(point, 'spans')).toMatchObject({ name: 'trace', params: { traceId: point.trace_id }, query: { span: point.span_id } })
    expect(eventLink(point, 'logs', { from: 0, to: 60 })).toMatchObject({ path: '/', query: { mode: 'logs', q: `trace_id="${point.trace_id}"`, from: '1970-01-01T00:00:00.000Z', to: '1970-01-01T00:01:00.000Z' } })
    expect(eventLink({ ...point, trace_id: '../../settings' }, 'spans')).toMatchObject({ path: '/' })
  })
})
