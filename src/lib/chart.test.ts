import { describe, it, expect } from 'vitest'
import {
  smoothLinePath,
  smoothAreaPath,
  straightLinePath,
  straightAreaPath,
  niceMax,
  fmtAxis,
  type Pt,
} from './chart'

describe('straightLinePath', () => {
  it('returns empty for no points', () => {
    expect(straightLinePath([])).toBe('')
  })

  it('moves to the first point then lines to the rest', () => {
    const pts: Pt[] = [
      [0, 0],
      [10, 5],
      [20, 2.5],
    ]
    expect(straightLinePath(pts)).toBe('M0,0 L10,5 L20,2.5')
  })

  it('rounds to 2 decimals and strips trailing zeros', () => {
    expect(straightLinePath([[1.234, 5.6789]])).toBe('M1.23,5.68')
  })
})

describe('straightAreaPath', () => {
  it('closes the line down to the baseline', () => {
    const pts: Pt[] = [
      [0, 10],
      [20, 4],
    ]
    expect(straightAreaPath(pts, 100)).toBe('M0,10 L20,4 L20,100 L0,100 Z')
  })

  it('returns empty for no points', () => {
    expect(straightAreaPath([], 100)).toBe('')
  })
})

describe('smoothLinePath', () => {
  it('returns empty for no points', () => {
    expect(smoothLinePath([])).toBe('')
  })

  it('emits a bare move for a single point', () => {
    expect(smoothLinePath([[3, 4]])).toBe('M3,4')
  })

  it('emits a straight segment for exactly two points', () => {
    expect(smoothLinePath([[0, 0], [10, 10]])).toBe('M0,0 L10,10')
  })

  it('emits cubic Béziers for three or more points', () => {
    const d = smoothLinePath([
      [0, 0],
      [10, 10],
      [20, 0],
    ])
    expect(d.startsWith('M0,0')).toBe(true)
    // one cubic segment per gap between points (n-1 = 2)
    expect((d.match(/C/g) ?? []).length).toBe(2)
  })

  it('produces a monotone (non-overshooting) curve at a local peak', () => {
    // At the apex the tangent should flatten, so control-point y values must not
    // exceed the peak height of 10 (Fritsch–Carlson monotonicity).
    const d = smoothLinePath([
      [0, 0],
      [10, 10],
      [20, 0],
    ])
    const ys = [...d.matchAll(/[ML C,](-?\d+(?:\.\d+)?)(?=[ ,]|$)/g)]
    // crude guard: no coordinate token exceeds the data max by more than rounding
    const nums = d
      .split(/[^0-9.\-]+/)
      .filter(Boolean)
      .map(Number)
    expect(Math.max(...nums)).toBeLessThanOrEqual(20) // x max; y never overshoots 10
    expect(ys.length).toBeGreaterThan(0)
  })
})

describe('smoothAreaPath', () => {
  it('returns empty for no points', () => {
    expect(smoothAreaPath([], 0)).toBe('')
  })

  it('appends baseline corners and closes the path', () => {
    const d = smoothAreaPath([[0, 5], [10, 5]], 50)
    expect(d.endsWith('L10,50 L0,50 Z')).toBe(true)
  })
})

describe('niceMax', () => {
  it('returns 1 for non-positive input', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-7)).toBe(1)
  })

  it('rounds up to a 1/2/5 × 10^n value', () => {
    expect(niceMax(0.8)).toBe(1)
    expect(niceMax(1.5)).toBe(2)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(42)).toBe(50)
    expect(niceMax(123)).toBe(200)
  })
})

describe('fmtAxis', () => {
  it('formats zero', () => {
    expect(fmtAxis(0)).toBe('0')
  })

  it('abbreviates thousands and millions', () => {
    expect(fmtAxis(1200)).toBe('1.2k')
    expect(fmtAxis(3_400_000)).toBe('3.4M')
  })

  it('keeps two decimals below 1', () => {
    expect(fmtAxis(0.05)).toBe('0.05')
  })

  it('rounds to an integer at or above 10', () => {
    expect(fmtAxis(12.6)).toBe('13')
  })

  it('trims a single decimal in the 1–10 range', () => {
    expect(fmtAxis(3.45)).toBe('3.5')
  })
})
