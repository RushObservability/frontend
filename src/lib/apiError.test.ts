import { describe, expect, it } from 'vitest'
import { safeApiErrorMessage } from './apiError'

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
