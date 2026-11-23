import type { RouteLocationRaw } from 'vue-router'
import type { MonitorEvent, MonitorEvidenceQuery } from '../types'
import { forecastResourceLabel } from './capacityForecast'

type ExploreQuery = Extract<MonitorEvidenceQuery, { kind: 'apm' | 'log' }>

export interface AlertScope {
  monitor_id: string
  event_id: string
  query: ExploreQuery
  group_by: string[]
  group_key: string | null
}

export const ALERT_SCOPE_FIELD = 'rush.alert_scope'
export const alertTelemetryHint = 'No telemetry matched this alert query and time range. Older data may have expired under your retention policy.'

export function alertEvidenceLink(event: MonitorEvent): RouteLocationRaw | undefined {
  const evidence = event.evidence
  if (!evidence?.window_start || !(Date.parse(evidence.window_start) < Date.parse(evidence.evaluated_at))) return
  const bounds = { from: evidence.window_start, to: evidence.evaluated_at, tenant: event.tenant_id }
  const { query } = evidence
  if (query.kind === 'promql') {
    return { name: 'metrics', query: {
      ...bounds, q: query.expression, alert_monitor: event.monitor_id, alert_event: event.id,
      alert_series: query.series ? JSON.stringify(query.series) : undefined,
    } }
  }
  if (query.kind !== 'apm' && query.kind !== 'log') return
  const scope: AlertScope = {
    monitor_id: event.monitor_id,
    event_id: event.id,
    query,
    group_by: evidence.group_by,
    group_key: evidence.group_by.length ? event.group_key : null,
  }
  return { name: 'explore', query: { ...bounds, mode: query.kind === 'apm' ? 'spans' : 'logs', alert_scope: JSON.stringify(scope) } }
}

export function readAlertScope(value: unknown, mode: 'spans' | 'logs'): AlertScope | null {
  if (typeof value !== 'string') return null
  try {
    const scope = JSON.parse(value) as AlertScope
    const query = scope?.query
    if (typeof scope?.monitor_id !== 'string' || typeof scope.event_id !== 'string'
      || !Array.isArray(scope.group_by) || !scope.group_by.every(field => typeof field === 'string')
      || !(scope.group_key === null || typeof scope.group_key === 'string')) return null
    if (mode === 'spans' && query?.kind === 'apm' && typeof query.service === 'string'
      && typeof query.metric === 'string' && (query.endpoint_filter == null || typeof query.endpoint_filter === 'string')) return scope
    if (mode === 'logs' && query?.kind === 'log' && typeof query.search === 'string'
      && typeof query.service === 'string' && Array.isArray(query.severities)
      && query.severities.every(level => typeof level === 'string') && Array.isArray(query.filters)
      && query.filters.every(filter => typeof filter?.field === 'string' && typeof filter.op === 'string' && typeof filter.value === 'string')) return scope
  } catch { /* Malformed alert scope. */ }
  return null
}

export function readAlertSeries(value: unknown): Record<string, string> | null {
  if (typeof value !== 'string') return null
  try {
    const labels: unknown = JSON.parse(value)
    if (labels && typeof labels === 'object' && !Array.isArray(labels)
      && Object.values(labels).every(label => typeof label === 'string')) return labels as Record<string, string>
  } catch { /* Malformed series selector. */ }
  return null
}

export function matchesAlertSeries(metric: Record<string, string>, series: Record<string, string> | null): boolean {
  if (!series) return true
  return Object.keys(metric).length === Object.keys(series).length
    && Object.entries(series).every(([key, value]) => Object.hasOwn(metric, key) && metric[key] === value)
}

export function evidenceFilters(query: MonitorEvidenceQuery): string[] {
  if (query.kind === 'apm') {
    return [
      query.service && query.service !== '*' ? `Service ${query.service}` : '',
      query.endpoint_filter && query.endpoint_filter !== '*' ? `Endpoint ${query.endpoint_filter}` : '',
    ].filter(Boolean)
  }
  if (query.kind === 'log') {
    return [
      query.service ? `Service ${query.service}` : '',
      query.search ? `Message contains ${query.search}` : '',
      query.severities.length ? `Severity ${query.severities.join(', ')}` : '',
      ...query.filters.map(({ field, op, value }) => `${field} ${op} ${value}`),
    ].filter(Boolean)
  }
  if (query.kind === 'promql') return Object.entries(query.series ?? {}).map(([label, value]) => `${label}=${value}`)
  if (query.kind === 'forecast') return [
    query.metric_name,
    forecastResourceLabel(query.resource),
    `${query.horizon_secs / 3600}h forecast`,
    query.crossing_at ? `Threshold crossing ${formatEvidenceTime(query.crossing_at)}` : '',
  ].filter(Boolean)
  if (query.kind === 'metric') return query.filters.map(({ key, value }) => `${key}=${value}`)
  return Object.entries(query.members).map(([member, firing]) => `${member} ${firing ? 'firing' : 'clear'}`)
}

// Config rows use the edit's microsecond timestamp as a stable version ID.
// Show that instant in UTC, with the exact ID on the version label.
export function formatRuleVersion(version: number): string {
  return version ? formatEvidenceTime(new Date(Math.floor(version / 1000)).toISOString(), true) : 'Initial rule'
}

export function formatEvidenceTime(timestamp: string, milliseconds = false): string {
  return new Date(timestamp).toLocaleString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    ...(milliseconds ? { fractionalSecondDigits: 3 } : {}),
  }) + ' UTC'
}

export function formatEvidenceReading(value: number | null, query: MonitorEvidenceQuery): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const number = value.toLocaleString('en-US', { maximumSignificantDigits: 6 })
  if (query.kind === 'apm') {
    if (query.metric === 'error_rate') return `${number}%`
    if (query.metric === 'request_rate') return `${number}/s`
    if (/^p(50|75|90|95|99)(?:_latency)?$/.test(query.metric)) return `${number} ms`
  }
  return query.kind === 'forecast' ? `${number}%` : number
}

export function formatEvidenceThreshold(event: MonitorEvent): string {
  if (!event.evidence) return '—'
  const reading = formatEvidenceReading(event.threshold, event.evidence.query)
  if (event.threshold === null || !['alert', 'warn'].includes(event.new_state)) return reading
  const symbol = { above: '>', above_or_equal: '≥', equal: '=', below_or_equal: '≤', below: '<' }[event.evidence.comparator]
  return symbol ? `${symbol} ${reading}` : reading
}

export function evidenceSignal(query: MonitorEvidenceQuery): string {
  if (query.kind === 'apm') {
    const metrics: Record<string, string> = { error_rate: 'Error rate', error_count: 'Error count', request_rate: 'Request rate', count: 'Span count' }
    return metrics[query.metric] || query.metric.replace('_', ' ')
  }
  if (query.kind === 'log') return 'Log count'
  if (query.kind === 'promql') return 'PromQL'
  if (query.kind === 'forecast') return query.metric_name
  if (query.kind === 'metric') return `${query.metric_name} (${query.aggregation})`
  return 'Composite'
}
