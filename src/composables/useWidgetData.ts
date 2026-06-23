import { useApi } from './useApi'
import { applyVarsToFilters, substitute } from './useVarSubst'
import type { Widget, WidgetData, Filter } from '../types'

export function useWidgetData() {
  const api = useApi()

  // `varValues` maps dashboard variable name → selected value (VAR_ALL for "All").
  // `rangeMinutes` (dashboard time picker) overrides each widget's stored range.
  async function fetchWidgetData(
    widget: Widget,
    varValues: Record<string, string> = {},
    rangeMinutes?: number,
  ): Promise<WidgetData> {
    const qc = widget.query_config
    const now = new Date()
    const rangeMin = rangeMinutes ?? qc.time_range_minutes ?? 60
    const from = new Date(now.getTime() - rangeMin * 60 * 1000)
    const timeRange = { from: from.toISOString(), to: now.toISOString() }

    // ── Metrics (PromQL) source ──
    if (qc.source === 'metrics') {
      const promql = substitute(qc.promql || '', varValues, '.*')
      if (!promql.trim()) return { type: widget.widget_type, series: [] }
      const startSec = Math.floor(from.getTime() / 1000)
      const endSec = Math.floor(now.getTime() / 1000)
      const step = Math.max(1, Math.floor((endSec - startSec) / 250))
      const res = await api.promQueryRange(promql, startSec, endSec, step)
      const series = (res.result || []).map((r) => ({
        name: seriesName(r.metric),
        points: r.values.map(([ts, v]) => [ts, parseFloat(v)] as [number, number]),
      }))
      if (widget.widget_type === 'counter') {
        // Counter from metrics: last value of the (first) series.
        const last = series[0]?.points.slice(-1)[0]
        return { type: 'counter', count: last ? last[1] : 0 }
      }
      return { type: widget.widget_type, series }
    }

    // ── Logs source ── queries the logs table (counter/timeseries/table/bar) ──
    if (qc.source === 'logs') {
      const logFilters: Filter[] = applyVarsToFilters(qc.filters || [], varValues)
      switch (widget.widget_type) {
        case 'timeseries': {
          const buckets = await api.countLogs({ time_range: timeRange, filters: logFilters, interval: qc.interval || '1m' })
          return { type: 'timeseries', buckets }
        }
        case 'counter': {
          const buckets = await api.countLogs({ time_range: timeRange, filters: logFilters, interval: qc.interval || '1h' })
          return { type: 'counter', count: buckets.reduce((s, b) => s + b.count, 0) }
        }
        case 'bar': {
          const groupBy = (qc.group_by || ['severity_text']).map((g) => substitute(g, varValues))
          const res = await api.groupLogs({ time_range: timeRange, filters: logFilters, group_by: groupBy, limit: qc.limit || 10 })
          return { type: 'bar', groups: (res.groups || []).map((g) => ({ key: g.key || 'unknown', count: g.count })) }
        }
        case 'table': {
          const res = await api.queryLogs({ time_range: timeRange, filters: logFilters, limit: qc.limit || 20 })
          return { type: 'table', rows: res.rows as any }
        }
      }
    }

    // ── Spans source (default) ── apply variables to filters/group_by ──
    const filters: Filter[] = applyVarsToFilters(qc.filters || [], varValues)

    switch (widget.widget_type) {
      case 'timeseries': {
        const buckets = await api.queryCount({
          time_range: timeRange,
          filters,
          interval: qc.interval || '1m',
        })
        return { type: 'timeseries', buckets }
      }
      case 'bar': {
        const groupBy = (qc.group_by || ['service_name']).map((g) => substitute(g, varValues))
        const res = await api.queryGroup({
          time_range: timeRange,
          filters,
          group_by: groupBy,
          limit: qc.limit || 10,
        })
        // queryGroup normalizes rows to { key, count }.
        const groups = (res.groups || []).map((g) => ({
          key: g.key || 'unknown',
          count: g.count,
        }))
        return { type: 'bar', groups }
      }
      case 'table': {
        const res = await api.queryEvents({
          time_range: timeRange,
          filters,
          limit: qc.limit || 20,
        })
        return { type: 'table', rows: res.rows as any }
      }
      case 'counter': {
        const buckets = await api.queryCount({
          time_range: timeRange,
          filters,
          interval: qc.interval || '1h',
        })
        const count = buckets.reduce((sum, b) => sum + b.count, 0)
        return { type: 'counter', count }
      }
      default:
        return { type: widget.widget_type, count: 0 }
    }
  }

  return { fetchWidgetData }
}

// Compact label for a PromQL series: prefer __name__{k="v",…}, else the label set.
function seriesName(metric: Record<string, string>): string {
  const name = metric.__name__ || ''
  const labels = Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  if (name && labels) return `${name}{${labels}}`
  return name || (labels ? `{${labels}}` : 'series')
}
