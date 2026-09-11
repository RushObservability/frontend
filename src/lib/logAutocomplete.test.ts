import { describe, expect, it } from 'vitest'
import { completionPrefix, filterValue, localLogSuggestions, logSearchFields, searchTokenAt, searchTokens } from './logAutocomplete'
import type { LogRecord } from '../types'

const rows: LogRecord[] = [{
  Timestamp: 0, TraceId: '', SpanId: '', SeverityText: 'INFO', SeverityNumber: 9,
  ServiceName: 'flights', ResourceAttributes: {}, ScopeName: '', LogAttributes: {},
  Body: '{"airline":"Example Air","flight":{"number":"0042"}}',
  DisplayValues: { 'log.airline': 'Example Air', 'log.status': 'Delayed' },
}]

describe('log autocomplete', () => {
  it('suggests saved-view fields, bare log aliases and nested JSON paths', () => {
    const fields = logSearchFields([{ field: 'log.airline', label: 'Airline' }], [{ field: 'type', op: '=', value: 'event_data' }], rows)
    expect(fields).toEqual(expect.arrayContaining(['airline', 'log.airline', 'body.airline', 'body.flight.number', 'status', 'type']))
    expect(fields).not.toContain('http_method')
  })
  it('uses selected-column projections as well as the JSON message for values', () => {
    for (const field of ['airline', 'log.airline', 'body.airline']) {
      expect(localLogSuggestions(rows, field, 'exa')).toEqual(['Example Air'])
    }
    expect(localLogSuggestions(rows, 'airline', 'Atlas')).toEqual([])
  })
  it('recognizes values with spaces and replaces the entire token when editing quotes', () => {
    const text = 'origin=SFO airline="Example Air" status=Delayed'
    expect(searchTokens(text).map(item => item.token)).toEqual(['origin=SFO', 'airline="Example Air"', 'status=Delayed'])
    const cursor = text.indexOf(' Air') + 2
    expect(searchTokenAt(text, cursor)).toEqual({ token: 'airline="Example A', start: 11, end: 32 })
    expect(searchTokenAt('airline=""', 9)).toEqual({ token: 'airline="', start: 0, end: 10 })
    expect(completionPrefix('""')).toBe('')
    expect(completionPrefix('"Example A')).toBe('Example A')
  })
  it('round-trips quoted spaces, embedded quotes and numeric-looking string values', () => {
    for (const value of ['Example Air', '0042', '', 'Demo "Air"', "Demo's Air", 'C:\\flights']) {
      const token = `airline=${JSON.stringify(value)}`
      expect(searchTokens(token)).toHaveLength(1)
      expect(filterValue(token.slice('airline='.length))).toBe(value)
    }
    expect(filterValue('200')).toBe(200)
    expect(filterValue('Delayed')).toBe('Delayed')
  })
})
