import type { DashboardExport, Widget, WidgetData, WidgetType } from '../types'

export interface DashboardDraftResponse {
  draft: DashboardExport
  time_range: { from: string; to: string }
}

export function draftWidgets(draft: DashboardExport): Widget[] {
  if (!draft || draft.format_version !== 'v1' || !draft.dashboard?.name || !Array.isArray(draft.widgets)
    || draft.widgets.length < 1 || draft.widgets.length > 6 || draft.dashboard.visibility !== 'private') {
    throw new Error('The API returned an invalid dashboard draft.')
  }
  return draft.widgets.map((panel, index) => {
    if (!['timeseries', 'counter', 'table'].includes(panel.widget_type)
      || !['spans', 'logs', 'metrics'].includes(String(panel.query_config?.source))) {
      throw new Error('The API returned an unsupported draft panel.')
    }
    return {
      ...panel, id: `draft-${index}`, dashboard_id: '', created_at: '', updated_at: '',
      widget_type: panel.widget_type as WidgetType,
      query_config: panel.query_config as unknown as Widget['query_config'],
      position: panel.position as unknown as Widget['position'],
    }
  })
}

export function previewHasData(data?: WidgetData): boolean {
  if (!data) return false
  if (typeof data.count === 'number' && Number.isFinite(data.count)) return true
  return Boolean(data.rows?.length || data.groups?.length || data.buckets?.some(bucket => bucket.count > 0)
    || data.series?.some(series => series.points.some(point => point[1] !== null && Number.isFinite(point[1]))))
}
