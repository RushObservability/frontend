import { describe, expect, it } from 'vitest'
import type { Filter, LogRecord } from '../types'
import { DEFAULT_LOG_COLUMNS, logColumnValue, logViewFilters, validateLogColumns, type LogView } from './logViews'

const view: LogView = {
  id: '33333333-3333-4333-8333-333333333333', name: 'Flights',
  filters: [{ field: 'type', op: '=', value: 'event_data' }],
  columns: [{ field: 'timestamp', label: 'Time' }, { field: 'log.airline', label: 'Airline' }],
}
const row = {
  Timestamp: 123, ServiceName: 'flights', SeverityText: 'INFO', SeverityNumber: 9,
  Body: '{"flight":{"number":"0042","delay":0,"cancelled":false}}',
  TraceId: '', SpanId: '', ScopeName: '',
  LogAttributes: { airline: 'Example Air', status: 'on time' }, ResourceAttributes: { cluster: 'west' },
} as LogRecord

describe('log views', () => {
  it('adds the base without replacing same-field filters or mutating the search', () => {
    const user: Filter[] = [{ field: 'type', op: '!=', value: 'event_data' }, { field: 'status', op: '=', value: 'delayed' }]
    expect(logViewFilters(user, view)).toEqual([...user, ...view.filters])
    expect(user).toHaveLength(2)
    expect(view.filters).toHaveLength(1)
    expect(logViewFilters(user)).toEqual(user)
  })

  it('resolves attributes, builtins, and nested JSON without losing zeroes', () => {
    expect(logColumnValue(row, 'service_name')).toBe('flights')
    expect(logColumnValue(row, 'log.airline')).toBe('Example Air')
    expect(logColumnValue(row, 'airline')).toBe('Example Air')
    expect(logColumnValue(row, 'resource.cluster')).toBe('west')
    expect(logColumnValue(row, 'body.flight.number')).toBe('0042')
    expect(logColumnValue(row, 'body.flight.delay')).toBe('0')
    expect(logColumnValue(row, 'body.flight.cancelled')).toBe('false')
    expect(logColumnValue(row, 'body.missing.value')).toBe('')
    expect(logColumnValue({ ...row, Body: 'plain text' }, 'body.airline')).toBe('')
    expect(logColumnValue(row, 'body.__proto__')).toBe('')
  })

  it('uses the server projection for slim rows, including empty values', () => {
    expect(logColumnValue({ ...row, DisplayValues: { 'log.airline': 'Server Air' } }, 'log.airline')).toBe('Server Air')
    expect(logColumnValue({ ...row, DisplayValues: { 'log.airline': '' } }, 'log.airline')).toBe('')
  })

  it('validates bounded, named, unique columns', () => {
    expect(validateLogColumns(DEFAULT_LOG_COLUMNS)).toBeNull()
    expect(validateLogColumns([])).not.toBeNull()
    expect(validateLogColumns(Array.from({ length: 21 }, (_, i) => ({ field: `key${i}`, label: 'Key' })))).not.toBeNull()
    expect(validateLogColumns([{ field: 'airline', label: 'Airline' }, { field: ' airline ', label: 'Carrier' }])).not.toBeNull()
    expect(validateLogColumns([{ field: '\u0000', label: 'Bad' }])).not.toBeNull()
    expect(validateLogColumns([{ field: 'airline', label: ' ' }])).not.toBeNull()
  })
})
