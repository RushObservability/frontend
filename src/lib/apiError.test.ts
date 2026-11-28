import { describe, expect, it } from 'vitest'
import { publicApiErrorMessage, safeApiErrorMessage } from './apiError'

describe('safeApiErrorMessage', () => {
  it('uses actionable status copy without accepting a server message', () => {
    expect(safeApiErrorMessage(400, 'Export')).toBe(
      'Export was not accepted. Check the submitted values and try again.',
    )
    expect(safeApiErrorMessage(500, 'Investigation request')).toBe(
      'Investigation request service is temporarily unavailable. Try again shortly.',
    )
  })

  it('handles auth, permission, and rate-limit responses', () => {
    expect(safeApiErrorMessage(401)).toContain('Session expired')
    expect(safeApiErrorMessage(403)).toContain('permission')
    expect(safeApiErrorMessage(429)).toContain('Too many requests')
  })
})

describe('publicApiErrorMessage', () => {
  const envelope = (message: unknown) => JSON.stringify({ error: { code: 'promql_too_many_selectors', message } })

  it('accepts only the message of a 4xx error envelope', () => {
    expect(publicApiErrorMessage(400, envelope('PromQL query has more than 16 selectors'))).toBe(
      'PromQL query has more than 16 selectors',
    )
    expect(publicApiErrorMessage(500, envelope('request could not be completed'))).toBeUndefined()
    expect(publicApiErrorMessage(400, 'PromQL error: Code: 241 at db.internal')).toBeUndefined()
    expect(publicApiErrorMessage(400, JSON.stringify({ error: 'raw' }))).toBeUndefined()
    expect(publicApiErrorMessage(400, envelope(42))).toBeUndefined()
    expect(publicApiErrorMessage(400, envelope('x'.repeat(301)))).toBeUndefined()
  })
})
