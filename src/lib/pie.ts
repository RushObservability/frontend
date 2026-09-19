export type PieStyle = 'pie' | 'donut'
export type PieCalculation = 'last' | 'sum' | 'mean'
export type PieSort = 'descending' | 'ascending' | 'none'
export interface PieSlice { id: string; name: string; value: number; percent: number; color: string }
export interface PieData {
  groups?: Array<{ key: string; count: number }>
  series?: Array<{ name: string; points: [number, number][] }>
}
const COLORS = ['#3b82f6', '#47b881', '#e5584f', '#8b5cf6', '#d97706', '#db2777', '#0891b2', '#65a30d', '#6366f1', '#0f766e']

function seriesValue(points: [number, number][], calculation: PieCalculation): number {
  const finite = points.filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value))
  if (!finite.length) return NaN
  if (calculation === 'last') return finite.reduce((last, point) => point[0] >= last[0] ? point : last)[1]
  const total = finite.reduce((sum, [, value]) => sum + value, 0)
  return calculation === 'mean' ? total / finite.length : total
}

/** A pie compares non-negative parts of a whole; never turn negatives into positive slices. */
export function buildPie(data: PieData, calculation: PieCalculation = 'last', sort: PieSort = 'descending') {
  const raw = data.groups
    ? data.groups.map(group => ({ name: group.key, value: group.count }))
    : (data.series || []).map(series => ({ name: series.name, value: seriesValue(series.points, calculation) }))
  const omitted = raw.filter(item => !Number.isFinite(item.value) || item.value < 0).length
  const positive = raw.filter(item => Number.isFinite(item.value) && item.value > 0)
  // Assign colors before sorting, in label order, so refreshing or sorting preserves identity.
  const names = [...new Set(positive.map(item => item.name))].sort()
  const colors = new Map(names.map((name, i) => [name, COLORS[i % COLORS.length]!]))
  const total = positive.reduce((sum, item) => sum + item.value, 0)
  if (!Number.isFinite(total)) return { slices: [] as PieSlice[], total: 0, omitted: raw.length }
  const slices = positive.map((item, i) => ({ ...item, id: `${i}:${item.name}`, percent: item.value / total * 100, color: colors.get(item.name)! }))
  if (sort !== 'none') slices.sort((a, b) => sort === 'ascending' ? a.value - b.value : b.value - a.value)
  return { slices, total, omitted }
}

/** Two outer arcs also cover a single slice occupying the entire circle. */
export function pieSlicePath(start: number, end: number, innerRadius: number): string {
  const point = (angle: number, r: number) => `${100 + Math.cos(angle) * r},${100 + Math.sin(angle) * r}`
  const middle = (start + end) / 2
  const outer = `M ${point(start, 92)} A 92 92 0 0 1 ${point(middle, 92)} A 92 92 0 0 1 ${point(end, 92)}`
  return innerRadius === 0 ? `${outer} L 100,100 Z`
    : `${outer} L ${point(end, innerRadius)} A ${innerRadius} ${innerRadius} 0 0 0 ${point(middle, innerRadius)} A ${innerRadius} ${innerRadius} 0 0 0 ${point(start, innerRadius)} Z`
}

export function formatPieValue(value: number, unit = ''): string {
  const formatted = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value)
  return unit ? `${formatted}${unit === '%' ? '' : ' '}${unit}` : formatted
}
