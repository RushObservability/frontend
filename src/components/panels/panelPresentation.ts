import type { WidgetType } from '../../types'
import type { PanelQueryConfig } from './types'

export function formatPanelRange(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440 && minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  return `${minutes}m`
}

export function formatPanelSource(config: PanelQueryConfig): string {
  const sources = new Set<string>()
  const visibleQueries = config.queries?.filter(query => !query.hidden) || []
  const configuredQueries = visibleQueries.length ? visibleQueries : (config.queries || [])

  if (configuredQueries.length) {
    for (const query of configuredQueries) sources.add(query.source)
  } else {
    sources.add(config.source || 'spans')
  }

  return [...sources]
    .map(source => source.charAt(0).toUpperCase() + source.slice(1))
    .join(' + ')
}

export function defaultPanelCaption(type: WidgetType): string {
  if (type === 'counter') return 'Current value for the selected dashboard window.'
  if (type === 'bar') return 'Top groups ranked by volume for the selected window.'
  if (type === 'table') return 'Latest matching records for the selected window.'
  return 'Trend across the selected dashboard window.'
}
