import { describe, expect, it } from 'vitest'
import { buildVirtualOffsets, nextVirtualIndex, virtualIndexAtOffset, virtualWindow } from './virtualWindow'

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
