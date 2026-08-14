import { describe, expect, it } from 'vitest'
import { setupTokenFromFragment, withoutQueryParameter } from './url'

describe('setupTokenFromFragment', () => {
  it('accepts setup tokens from a URL fragment', () => {
    expect(setupTokenFromFragment('#token=one-time-secret')).toBe('one-time-secret')
  })

  it('never accepts a query-string token', () => {
    expect(setupTokenFromFragment('?token=legacy-secret')).toBe('')
    expect(setupTokenFromFragment('token=legacy-secret')).toBe('')
    expect(setupTokenFromFragment('')).toBe('')
  })
})

describe('withoutQueryParameter', () => {
  it('removes only the requested parameter', () => {
    const query = { token: 'one-time-secret', provider: 'okta', keep: ['a', 'b'] }
    expect(withoutQueryParameter(query, 'token')).toEqual({ provider: 'okta', keep: ['a', 'b'] })
    expect(query).toEqual({ token: 'one-time-secret', provider: 'okta', keep: ['a', 'b'] })
  })

  it('is safe when the parameter is absent', () => {
    expect(withoutQueryParameter({ provider: 'okta' }, 'token')).toEqual({ provider: 'okta' })
  })
})
