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
})

