import type { Filter, LogRecord } from '../types'

export interface LogViewColumn { field: string; label: string }
export interface LogView { id: string; name: string; filters: Filter[]; columns: LogViewColumn[] }

export const DEFAULT_LOG_COLUMNS: LogViewColumn[] = [
  { field: 'timestamp', label: 'Time' },
  { field: 'severity_text', label: 'Level' },
  { field: 'service_name', label: 'Service' },
  { field: 'body', label: 'Message' },
  { field: 'trace_id', label: 'Trace' },
]

export function logViewFilters(userFilters: Filter[], view?: LogView): Filter[] {
  // Base filters stay outside the search editor and are always ANDed with it.
  // A field called "status" is a valid log attribute, even though spans also use it.
  return [...userFilters, ...(view?.filters ?? [])]
}

export function logColumnValue(row: LogRecord, field: string): string {
  if (Object.hasOwn(row.DisplayValues ?? {}, field)) return row.DisplayValues![field]!
  const builtins: Record<string, unknown> = {
    time: row.Timestamp, timestamp: row.Timestamp, Timestamp: row.Timestamp,
    severity: row.SeverityText, severity_text: row.SeverityText, SeverityText: row.SeverityText,
    severity_number: row.SeverityNumber, SeverityNumber: row.SeverityNumber,
    service_name: row.ServiceName, ServiceName: row.ServiceName,
    body: row.Body, Body: row.Body, trace_id: row.TraceId, TraceId: row.TraceId,
    span_id: row.SpanId, SpanId: row.SpanId, scope_name: row.ScopeName, ScopeName: row.ScopeName,
  }
  if (Object.hasOwn(builtins, field)) return String(builtins[field] ?? '')
  if (field.startsWith('log.')) return row.LogAttributes?.[field.slice(4)] ?? ''
  if (field.startsWith('resource.')) return row.ResourceAttributes?.[field.slice(9)] ?? ''
  if (field.startsWith('body.')) {
    try {
      let value: unknown = JSON.parse(row.Body)
      for (const key of field.slice(5).split('.')) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return ''
        value = (value as Record<string, unknown>)[key]
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
    } catch { return '' }
  }
  return row.LogAttributes?.[field] || row.ResourceAttributes?.[field] || ''
}

export function validateLogColumns(columns: LogViewColumn[]): string | null {
  if (!columns.length || columns.length > 20) return 'Choose between 1 and 20 columns.'
  const seen = new Set<string>()
  for (const column of columns) {
    const field = column.field.trim()
    if (!field || field.length > 128 || /[\u0000-\u001f\u007f]/.test(field)) return 'Each column needs a field of 1 to 128 characters.'
    if (!column.label.trim() || column.label.length > 80) return 'Each column needs a heading of 1 to 80 characters.'
    if (seen.has(field)) return `The field ${field} appears more than once.`
    seen.add(field)
  }
  return null
}
