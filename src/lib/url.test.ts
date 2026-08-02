import { describe, expect, it } from 'vitest'
import { withoutQueryParameter } from './url'

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

