import { describe, expect, it } from 'vitest'
import {
  containsSensitiveMaterial,
  tenantScopedStorageKey,
  userScopedStorageKey,
} from './storageScope'

describe('scoped browser storage', () => {
  it('requires an authenticated user and separates user/tenant values', () => {
    expect(userScopedStorageKey('theme', null)).toBeNull()
    expect(tenantScopedStorageKey('history', 'customer/a', 'user 1')).toBe(
      'rush:v2:user%201:customer%2Fa:history',
    )
  })

  it('detects common credential-shaped query material', () => {
    expect(containsSensitiveMaterial({ search: 'password=secret' })).toBe(true)
    expect(containsSensitiveMaterial({ query: 'service.name = articles' })).toBe(false)
  })

  it.each([
    { password: 'test-value' },
    { nested: { apiKey: 'test-value' } },
    { search: '{"token":"test-value"}' },
    { search: '"client_secret" : "test-value"' },
    { search: 'Authorization: Bearer test-value' },
    { search: 'postgres://user:test-value@db.local/app' },
    { filters: [{ field: 'attributes.password', op: 'eq', value: 'test-value' }] },
    { filters: [{ key: 'access_token', value: 'test-value' }] },
  ])('rejects credential-shaped structured queries: %j', value => {
    expect(containsSensitiveMaterial(value)).toBe(true)
  })

  it('keeps normal queries and rejects cyclic or excessively deep inputs', () => {
    expect(containsSensitiveMaterial({ filters: [{ field: 'service.name', op: 'eq', value: 'gateway' }], search: 'status=500' })).toBe(false)
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(containsSensitiveMaterial(cycle)).toBe(true)
    let nested: unknown = 'safe'
    for (let i = 0; i < 40; i++) nested = { nested }
    expect(containsSensitiveMaterial(nested)).toBe(true)
  })
})
