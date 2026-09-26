import { describe, expect, it } from 'vitest'
import { isErrorSpan, isErrorStatus } from './spanStatus'

describe('span status', () => {
  it('recognizes the status ingest writes and the older form', () => {
    expect(isErrorStatus('STATUS_CODE_ERROR')).toBe(true)
    expect(isErrorStatus('ERROR')).toBe(true)
    expect(isErrorStatus('error')).toBe(true)
    expect(isErrorStatus('STATUS_CODE_OK')).toBe(false)
    expect(isErrorStatus('STATUS_CODE_UNSET')).toBe(false)
    expect(isErrorStatus('')).toBe(false)
    expect(isErrorStatus(undefined)).toBe(false)
  })

  it('counts failed status or HTTP 5xx as an error span', () => {
    expect(isErrorSpan({ status: 'STATUS_CODE_ERROR', http_status_code: 200 })).toBe(true)
    expect(isErrorSpan({ status: 'STATUS_CODE_UNSET', http_status_code: 503 })).toBe(true)
    expect(isErrorSpan({ status: 'STATUS_CODE_OK', http_status_code: 404 })).toBe(false)
    expect(isErrorSpan({ status: 'STATUS_CODE_UNSET' })).toBe(false)
  })
})
