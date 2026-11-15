import { describe, expect, it } from 'vitest'
import { apiMethod, apiOperation, requestOutcome, statusClass } from './apiTelemetry'

describe('API telemetry dimensions', () => {
  it('collapses resource IDs and queries and excludes self-ingest', () => {
    expect(apiOperation('/api/v1/dashboards/customer-secret?token=secret')).toBe('dashboards')
    expect(apiOperation('/api/v1/unrecognized-customer-name')).toBe('other')
    expect(apiOperation('/api/v1/rum/ingest')).toBeNull()
    expect(apiOperation('/api/v1/rum/replay/ingest')).toBeNull()
    expect(apiOperation('/prom/api/v1/query?query=secret')).toBe('prometheus')
    expect(apiMethod('CUSTOM-SECRET')).toBe('OTHER')
    expect(statusClass(503)).toBe('5xx')
  })
  it('separates decode, timeout, cancellation, HTTP and network failures', () => {
    expect(requestOutcome(new SyntaxError('secret'))).toBe('decode_error')
    expect(requestOutcome({ apiDecodeFailure: true })).toBe('decode_error')
    expect(requestOutcome({ name: 'TimeoutError' })).toBe('timeout')
    expect(requestOutcome({ name: 'AbortError' })).toBe('cancelled')
    expect(requestOutcome({ status: 429 })).toBe('http_error')
    expect(requestOutcome(new TypeError('secret'))).toBe('network_error')
  })
})
