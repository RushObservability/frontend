// Shared chart geometry helpers for all SVG charts (dashboard, SLOs, previews,
// metrics). The goal is one cohesive, refined look: smooth monotone curves,
// gradient area fills, crisp non-scaling strokes, and consistent ticks.

export type Pt = [number, number] // [x, y] in viewBox coordinates

/**
 * Smooth monotone-cubic path through points. Monotone interpolation avoids the
 * overshoot/wiggle of naive Catmull-Rom (important for metrics that must not dip
 * below their data, e.g. rates), while still looking smooth and modern.
 * Falls back to straight segments for <3 points.
 */
export function smoothLinePath(pts: Pt[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${fmt(pts[0]![0])},${fmt(pts[0]![1])}`
  if (n === 2) {
    return `M${fmt(pts[0]![0])},${fmt(pts[0]![1])} L${fmt(pts[1]![0])},${fmt(pts[1]![1])}`
  }

  // Monotone cubic interpolation (Fritsch–Carlson) on y as a function of x.
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1]! - xs[i]!
    dx.push(h)
    slope.push(h !== 0 ? (ys[i + 1]! - ys[i]!) / h : 0)
  }

  const m: number[] = new Array(n).fill(0)
  m[0] = slope[0]!
  m[n - 1] = slope[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!
    const s1 = slope[i]!
    if (s0 * s1 <= 0) {
      m[i] = 0
    } else {
      // weighted harmonic mean keeps tangents monotone
      const w1 = 2 * dx[i]! + dx[i - 1]!
      const w2 = dx[i]! + 2 * dx[i - 1]!
      m[i] = (w1 + w2) / (w1 / s0 + w2 / s1)
    }
  }

  let d = `M${fmt(xs[0]!)},${fmt(ys[0]!)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]!
    const x0 = xs[i]!
    const y0 = ys[i]!
    const x1 = xs[i + 1]!
    const y1 = ys[i + 1]!
    // cubic control points from endpoint tangents (Hermite → Bézier)
    const c1x = x0 + h / 3
    const c1y = y0 + (m[i]! * h) / 3
    const c2x = x1 - h / 3
    const c2y = y1 - (m[i + 1]! * h) / 3
    d += ` C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(x1)},${fmt(y1)}`
  }
  return d
}

/** Close a smooth line path into an area down to `baselineY`. */
export function smoothAreaPath(pts: Pt[], baselineY: number): string {
  if (pts.length === 0) return ''
  const line = smoothLinePath(pts)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return `${line} L${fmt(last[0])},${fmt(baselineY)} L${fmt(first[0])},${fmt(baselineY)} Z`
}

/**
 * Straight (linear) line path — Grafana's default interpolation. Crisp polyline
 * through the points; pair with `non-scaling-stroke` for a clean ~1px line.
 */
export function straightLinePath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p[0])},${fmt(p[1])}`).join(' ')
}

/** Close a straight line path into an area down to `baselineY`. */
export function straightAreaPath(pts: Pt[], baselineY: number): string {
  if (pts.length === 0) return ''
  const line = straightLinePath(pts)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return `${line} L${fmt(last[0])},${fmt(baselineY)} L${fmt(first[0])},${fmt(baselineY)} Z`
}

/** Round to 2 decimals and strip trailing zeros — keeps path strings compact. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return (Math.round(n * 100) / 100).toString()
}

/** A "nice" axis maximum (1/2/5 × 10^n) at or above `v`, for clean tick labels. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const f = v / base
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * base
}

/** Compact human number for axis labels: 1.2k, 3.4M, 0.05, 12. */
export function fmtAxis(n: number): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return trim(n / 1_000_000) + 'M'
  if (abs >= 1_000) return trim(n / 1_000) + 'k'
  if (abs < 1) return n.toFixed(2)
  if (abs < 10) return trim(n)
  return Math.round(n).toString()
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}
