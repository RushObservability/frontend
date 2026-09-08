import { describe, expect, it } from 'vitest'
import { buildVirtualOffsets, nextVirtualIndex, virtualIndexAtOffset, virtualScrollTarget, virtualWindow } from './virtualWindow'

describe('virtual collection window', () => {
  it('keeps a 10,000-row collection bounded at the beginning, middle, and end', () => {
    const offsets = buildVirtualOffsets(10_000, 36, index => `row-${index}`, new Map())
    for (const scrollTop of [0, 36 * 5_000, 36 * 9_980]) {
      const window = virtualWindow(offsets, scrollTop, 720, 36, 8)
      expect(window.end - window.start).toBeLessThanOrEqual(45)
      expect(window.start).toBeGreaterThanOrEqual(0)
      expect(window.end).toBeLessThanOrEqual(10_000)
    }
  })

  it('computes a full 10,000-row scroll sweep without a 50ms helper task', () => {
    const offsets = buildVirtualOffsets(10_000, 36, index => `row-${index}`, new Map())
    const started = performance.now()
    for (let index = 0; index < 1_000; index++) {
      virtualWindow(offsets, index * 360, 720, 36, 8)
    }
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('accounts for variable-height wrapped and expanded rows by stable identity', () => {
    const measured = new Map<string | number, number>([
      ['log-10', 144],
      ['log-11', 280],
    ])
    const offsets = buildVirtualOffsets(100, 36, index => `log-${index}`, measured)
    expect(offsets[11]! - offsets[10]!).toBe(144)
    expect(offsets[12]! - offsets[11]!).toBe(280)
    expect(virtualIndexAtOffset(offsets, offsets[11]! + 100)).toBe(11)
  })

  it('preserves measured heights when rows are prepended but keys remain stable', () => {
    const measured = new Map<string | number, number>([['existing', 120]])
    const before = buildVirtualOffsets(1, 36, () => 'existing', measured)
    const afterKeys = ['new', 'existing']
    const after = buildVirtualOffsets(2, 36, index => afterKeys[index]!, measured)
    expect(before[1]).toBe(120)
    expect(after[1]).toBe(36)
    expect(after[2]! - after[1]!).toBe(120)
  })

  it('keeps keyboard focus in range and supports first/last navigation', () => {
    expect(nextVirtualIndex('ArrowDown', 2, 10)).toBe(3)
    expect(nextVirtualIndex('ArrowUp', 2, 10)).toBe(1)
    expect(nextVirtualIndex('Home', 8, 10)).toBe(0)
    expect(nextVirtualIndex('End', 1, 10)).toBe(9)
    expect(nextVirtualIndex('ArrowUp', 0, 10)).toBe(0)
    expect(nextVirtualIndex('ArrowDown', 9, 10)).toBe(9)
  })
})

describe('virtual scroll target', () => {
  // 100 rows of 36px, viewport 400px tall.
  const offsets = buildVirtualOffsets(100, 36, index => `row-${index}`, new Map())

  it('leaves the scroll position alone for a row already in view', () => {
    // Row 15 spans 540..576; the view covers 500..900.
    expect(virtualScrollTarget(offsets, 15, 500, 400)).toBe(500)
  })

  it('does not scroll when a selected row grows taller than the space below it', () => {
    // An expanded detail row: row 15 is now 800px tall and overflows the view,
    // but its top is still visible, so the list must not move.
    const measured = new Map<string, number>([['row-15', 800]])
    const expanded = buildVirtualOffsets(100, 36, index => `row-${index}`, measured)
    expect(virtualScrollTarget(expanded, 15, 540, 400)).toBe(540)
  })

  it('scrolls up to a row above the viewport', () => {
    expect(virtualScrollTarget(offsets, 2, 500, 400)).toBe(72)
  })

  it('scrolls down to a row below the viewport', () => {
    // Row 40 starts at 1440, past the 500..900 view.
    expect(virtualScrollTarget(offsets, 40, 500, 400)).toBe(1440)
  })

  it('centers on request and never returns a negative offset', () => {
    expect(virtualScrollTarget(offsets, 0, 0, 400, 'center')).toBe(0)
    expect(virtualScrollTarget(offsets, 50, 0, 400, 'center')).toBe(1800 - (400 - 36) / 2)
  })

  it('ignores an out-of-range index', () => {
    expect(virtualScrollTarget(offsets, -1, 250, 400)).toBe(250)
    expect(virtualScrollTarget(offsets, 100, 250, 400)).toBe(250)
  })
})
