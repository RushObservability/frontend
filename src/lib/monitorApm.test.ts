import { describe, expect, it } from 'vitest'
import { normalizeApmGroups } from './monitorApm'

describe('APM monitor grouping', () => {
  it('removes endpoint grouping when the endpoint filter is empty', () => {
    expect(normalizeApmGroups('checkout-api', '', ['service_name', 'endpoint', 'http_path'])).toEqual([
      'service_name',
    ])
    expect(normalizeApmGroups('checkout-api', '   ', ['endpoint'])).toEqual([])
  })

  it('adds endpoint grouping for wildcard filters', () => {
    expect(normalizeApmGroups('checkout-*', '/api/*', [])).toEqual([
      'service_name',
      'endpoint',
    ])
  })

  it('keeps an exact endpoint as one filtered series', () => {
    expect(normalizeApmGroups('checkout-api', '/health', ['endpoint'])).toEqual(['endpoint'])
  })
})
