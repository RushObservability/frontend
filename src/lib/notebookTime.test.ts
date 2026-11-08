import { describe, expect, it } from 'vitest'
import { cellTimeLabel, createLimiter, fromLocalInput, resolveCellTime, rulerSegment, toLocalInput } from './notebookTime'

const now = new Date('2026-11-07T20:00:00Z')
const resolved = { incident_start: '2026-11-07T13:40:00Z', incident_end: '2026-11-07T19:40:00Z' }
const ongoing = { incident_start: '2026-11-07T13:40:00Z', incident_end: '' }

describe('resolveCellTime', () => {
  it('inherits the incident window, ending now while ongoing', () => {
    expect(resolveCellTime(resolved, { mode: 'inherit' }, now)).toEqual({ from: '2026-11-07T13:40:00.000Z', to: '2026-11-07T19:40:00.000Z' })
    expect(resolveCellTime(ongoing, { mode: 'inherit' }, now).to).toBe(now.toISOString())
  })

  it('offsets relative cells from the incident start', () => {
    expect(resolveCellTime(resolved, { mode: 'relative', offset_from_min: -15, offset_to_min: 30 }, now))
      .toEqual({ from: '2026-11-07T13:25:00.000Z', to: '2026-11-07T14:10:00.000Z' })
  })

  it('keeps absolute ranges and anchors live ones to now', () => {
    expect(resolveCellTime(resolved, { mode: 'absolute', from: '2026-11-07T14:02:00Z', to: '2026-11-07T14:20:00Z' }, now))
      .toEqual({ from: '2026-11-07T14:02:00.000Z', to: '2026-11-07T14:20:00.000Z' })
    expect(resolveCellTime(resolved, { mode: 'live', minutes: 15 }, now))
      .toEqual({ from: '2026-11-07T19:45:00.000Z', to: '2026-11-07T20:00:00.000Z' })
  })
})

describe('rulerSegment', () => {
  it('places a range inside the window', () => {
    const seg = rulerSegment(resolved, { from: '2026-11-07T15:10:00Z', to: '2026-11-07T16:40:00Z' }, now)
    expect(seg).toEqual({ left: 25, width: 25, clippedStart: false, clippedEnd: false })
  })

  it('clips ranges that spill out of the window', () => {
    const seg = rulerSegment(resolved, { from: '2026-11-07T13:25:00Z', to: '2026-11-07T20:00:00Z' }, now)
    expect(seg.left).toBe(0)
    expect(seg.width).toBe(100)
    expect(seg.clippedStart).toBe(true)
    expect(seg.clippedEnd).toBe(true)
  })
})

describe('cellTimeLabel', () => {
  it('names each mode briefly', () => {
    expect(cellTimeLabel({ mode: 'inherit' })).toBe('Incident window')
    expect(cellTimeLabel({ mode: 'relative', offset_from_min: -15, offset_to_min: 120 })).toBe('T−15m → T+2h')
    expect(cellTimeLabel({ mode: 'live', minutes: 60 })).toBe('Live · last 1h')
  })
})

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const run = createLimiter(2)
    let active = 0
    let peak = 0
    const task = () => run(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
    })
    await Promise.all([task(), task(), task(), task(), task()])
    expect(peak).toBe(2)
  })
})

describe('local input conversion', () => {
  it('round-trips through a datetime-local value', () => {
    expect(fromLocalInput(toLocalInput('2026-11-07T14:02:00Z'))).toBe('2026-11-07T14:02:00.000Z')
    expect(fromLocalInput('')).toBe('')
    expect(toLocalInput('not a time')).toBe('')
  })
})
