import { useApi } from './useApi'
import { applyVarsToFilters, substitute } from './useVarSubst'
import type { CountBucket, Filter, GroupedTimeseriesBucket, TimeseriesBucket, Widget, WidgetData, WidgetPanelQuery, WidgetQueryConfig, WidgetType } from '../types'

export function useWidgetData() {
  const api = useApi()

  // `varValues` maps dashboard variable name → selected value (VAR_ALL for "All").
  // `rangeMinutes` (dashboard time picker) overrides the panel's stored range.
  async function fetchWidgetData(
    widget: Widget,
    varValues: Record<string, string> = {},
    rangeMinutes?: number,
  ): Promise<WidgetData> {
    const qc = widget.query_config
    const queries = effectiveQueries(qc)
    const visibleQueries = queries.filter(query => !query.hidden)
    const rangeMin = rangeMinutes ?? qc.time_range_minutes ?? 60

    if (!visibleQueries.length) {
      return { type: widget.widget_type, series: [] }
    }

    // Time-series panels are the multi-source surface: each query is executed
    // independently, then normalized into a common [unixSec, value] series model.
    if (widget.widget_type === 'timeseries' && qc.queries?.length) {
      const settled = await Promise.allSettled(
        visibleQueries.map(query => fetchQueryData('timeseries', query, varValues, rangeMin)),
      )
      const series: NonNullable<WidgetData['series']> = []
      const queryErrors: NonNullable<WidgetData['query_errors']> = []

      settled.forEach((result, index) => {
        const query = visibleQueries[index]!
        if (result.status === 'rejected') {
          queryErrors.push({
            ref_id: query.ref_id,
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
          return
        }
        const data = result.value
        if (data.series?.length) {
          const isSplit = data.series.length > 1
          data.series.forEach((item) => {
            const fallback = isSplit ? `${query.ref_id} · ${item.name}` : item.name
            series.push({
              ...item,
              ref_id: query.ref_id,
              name: query.alias ? (isSplit ? `${query.alias} · ${item.name}` : query.alias) : fallback,
              // A query color represents the query as a whole. Once a query
              // splits into multiple lines, leave colors unset so the chart's
              // global palette assigns a different color to every returned
              // series (including APM groups and PromQL label sets).
              color: isSplit ? undefined : query.color || item.color,
              axis: query.axis || 'left',
            })
          })
        } else if (data.buckets) {
          series.push(bucketsToSeries(data.buckets, query))
        }
      })

      if (!series.length && queryErrors.length) {
        throw new Error(queryErrors.map(error => `${error.ref_id}: ${error.message}`).join(' · '))
      }
      return { type: 'timeseries', series, query_errors: queryErrors }
    }

    // Stat/bar/table panels use the first visible query for now. The editor
    // communicates that multiple overlaid queries are a time-series feature.
    return fetchQueryData(widget.widget_type, visibleQueries[0]!, varValues, rangeMin)
  }

  async function fetchQueryData(
    widgetType: WidgetType,
    query: WidgetPanelQuery,
    varValues: Record<string, string>,
    rangeMinutes: number,
  ): Promise<WidgetData> {
    const now = new Date()
    const from = new Date(now.getTime() - rangeMinutes * 60 * 1000)
    const timeRange = { from: from.toISOString(), to: now.toISOString() }

    if (query.source === 'metrics') {
      const promql = substitute(query.promql || '', varValues, '.*')
      if (!promql.trim()) return { type: widgetType, series: [] }
      const startSec = Math.floor(from.getTime() / 1000)
      const endSec = Math.floor(now.getTime() / 1000)
      const step = Math.max(1, Math.floor((endSec - startSec) / 250))
      const res = await api.promQueryRange(promql, startSec, endSec, step)
      const results = res.result || []
      const series = results.map((result) => ({
        name: seriesName(result.metric),
        points: result.values.map(([ts, value]) => [ts, parseFloat(value)] as [number, number]),
        color: results.length > 1 ? undefined : query.color,
        ref_id: query.ref_id,
        axis: query.axis || 'left',
      }))
      if (widgetType === 'counter') {
        const last = series[0]?.points.slice(-1)[0]
        return { type: 'counter', count: last ? last[1] : 0 }
      }
      return { type: widgetType, series }
    }

    if (query.source === 'logs') {
      const filters: Filter[] = applyVarsToFilters(query.filters || [], varValues)
      switch (widgetType) {
        case 'timeseries': {
          const buckets = await api.countLogs({ time_range: timeRange, filters, interval: query.interval || '1m' })
          return { type: 'timeseries', buckets }
        }
        case 'counter': {
          const buckets = await api.countLogs({ time_range: timeRange, filters, interval: query.interval || '1h' })
          return { type: 'counter', count: buckets.reduce((sum, bucket) => sum + bucket.count, 0) }
        }
        case 'bar': {
          const groupBy = (query.group_by || ['severity_text']).map(value => substitute(value, varValues))
          const res = await api.groupLogs({ time_range: timeRange, filters, group_by: groupBy, limit: query.limit || 10 })
          return { type: 'bar', groups: (res.groups || []).map(group => ({ key: group.key || 'unknown', count: group.count })) }
        }
        case 'table': {
          const res = await api.queryLogs({ time_range: timeRange, filters, limit: query.limit || 20 })
          return { type: 'table', rows: res.rows as unknown as Record<string, unknown>[] }
        }
      }
    }

    const filters: Filter[] = applyVarsToFilters(query.filters || [], varValues)
    switch (widgetType) {
      case 'timeseries': {
        const groupBy = query.group_by?.[0] ? substitute(query.group_by[0], varValues) : undefined
        const response = await api.queryTimeseries({
          time_range: timeRange,
          filters,
          interval: query.interval || '1m',
          group_by: groupBy,
        })
        return {
          type: 'timeseries',
          series: apmTimeseriesToSeries(response.buckets, query, response.grouped),
        }
      }
      case 'bar': {
        const configuredGroups = query.group_by?.length ? query.group_by : ['service_name']
        const groupBy = configuredGroups.map(value => substitute(value, varValues))
        const res = await api.queryGroup({
          time_range: timeRange,
          filters,
          group_by: groupBy,
          limit: query.limit || 10,
        })
        return {
          type: 'bar',
          groups: (res.groups || []).map(group => ({ key: group.key || 'unknown', count: group.count })),
        }
      }
      case 'table': {
        const res = await api.queryEvents({ time_range: timeRange, filters, limit: query.limit || 20 })
        return { type: 'table', rows: res.rows as unknown as Record<string, unknown>[] }
      }
      case 'counter': {
        const buckets = await api.queryCount({ time_range: timeRange, filters, interval: query.interval || '1h' })
        return { type: 'counter', count: buckets.reduce((sum, bucket) => sum + bucket.count, 0) }
      }
      default:
        return { type: widgetType, count: 0 }
    }
  }

  return { fetchWidgetData }
}

function apmTimeseriesToSeries(
  buckets: Array<TimeseriesBucket | GroupedTimeseriesBucket>,
  query: WidgetPanelQuery,
  grouped: boolean,
): NonNullable<WidgetData['series']> {
  const aggregation = normalizeApmAggregation(query.aggregation)
  const byGroup = new Map<string, Array<TimeseriesBucket | GroupedTimeseriesBucket>>()
  buckets.forEach((bucket) => {
    const key = grouped && 'group_key' in bucket ? bucket.group_key || 'unknown' : query.ref_id
    const list = byGroup.get(key) || []
    list.push(bucket)
    byGroup.set(key, list)
  })

  const groups = Array.from(byGroup.entries())
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))

  return groups.map(([name, items]) => ({
    name,
    ref_id: query.ref_id,
    color: grouped ? undefined : query.color,
    axis: query.axis || 'left',
    points: items.flatMap((bucket) => {
      const timestamp = new Date(bucket.bucket).getTime() / 1000
      if (!Number.isFinite(timestamp)) return []
      return [[timestamp, apmBucketValue(bucket, aggregation)] as [number, number]]
    }),
  }))
}

function normalizeApmAggregation(aggregation?: string): 'count' | 'error_count' | 'error_rate' | 'avg' | 'p50' | 'p95' | 'p99' {
  if (aggregation === 'error_count' || aggregation === 'error_rate' || aggregation === 'avg' || aggregation === 'p50' || aggregation === 'p95' || aggregation === 'p99') return aggregation
  if (aggregation === 'avg_duration_ms') return 'avg'
  if (aggregation === 'p50_ms') return 'p50'
  if (aggregation === 'p95_ms') return 'p95'
  if (aggregation === 'p99_ms') return 'p99'
  return 'count'
}

function apmBucketValue(bucket: TimeseriesBucket, aggregation: ReturnType<typeof normalizeApmAggregation>): number {
  switch (aggregation) {
    case 'error_count': return bucket.error_count
    case 'error_rate': return bucket.count ? (bucket.error_count / bucket.count) * 100 : 0
    case 'avg': return bucket.avg_duration_ms
    case 'p50': return bucket.p50_ms
    case 'p95': return bucket.p95_ms
    case 'p99': return bucket.p99_ms
    default: return bucket.count
  }
}

/** Convert legacy single-query panels into the same runtime model as new panels. */
function effectiveQueries(config: WidgetQueryConfig): WidgetPanelQuery[] {
  if (config.queries?.length) return config.queries
  return [{
    ref_id: 'A',
    source: config.source || 'spans',
    filters: config.filters || [],
    group_by: config.group_by,
    aggregation: config.aggregation,
    interval: config.interval,
    limit: config.limit,
    promql: config.promql,
  }]
}

function bucketsToSeries(buckets: CountBucket[], query: WidgetPanelQuery) {
  return {
    name: query.alias || query.ref_id,
    ref_id: query.ref_id,
    color: query.color,
    axis: query.axis || 'left',
    points: buckets.flatMap((bucket) => {
      const timestamp = new Date(bucket.bucket).getTime() / 1000
      return Number.isFinite(timestamp) ? [[timestamp, bucket.count] as [number, number]] : []
    }),
  }
}

// Compact label for a PromQL series: prefer __name__{k="v",…}, else the label set.
function seriesName(metric: Record<string, string>): string {
  const name = metric.__name__ || ''
  const labels = Object.entries(metric)
    .filter(([key]) => key !== '__name__')
    .map(([key, value]) => `${key}="${value}"`)
    .join(', ')
  if (name && labels) return `${name}{${labels}}`
  return name || (labels ? `{${labels}}` : 'series')
}
