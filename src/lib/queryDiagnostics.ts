import type { Filter, WidgetData } from '../types'

export interface DiagnosticRequest {
  signal: 'spans' | 'logs' | 'metrics'
  time_range: { from: string; to: string }
  filters: Filter[]
  search?: string
  promql?: string
}

export interface QueryDiagnosis {
  code: string
  message: string
  complete: boolean
  checked_filters: number
  filter_index?: number
  suggestions?: string[]
}

export function hasWidgetSamples(data?: WidgetData): boolean {
  if (!data) return false
  if (typeof data.count === 'number' && Number.isFinite(data.count)) return true
  return Boolean(data.rows?.length || data.groups?.length || data.patterns?.length || data.scatter_points?.length
    || data.buckets?.some(bucket => bucket.count > 0)
    || data.series?.some(series => series.points.some(point => point[1] !== null && Number.isFinite(point[1]))))
}
