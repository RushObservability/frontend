import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAnalyticsRequests } from '../lib/analyticsRequestCache'
import { setStorageUserId } from './storageScope'
import { useApi } from './useApi'
import { useTenant } from './useTenant'

const query = {
  time_range: { from: '2026-08-10T00:00:00Z', to: '2026-08-10T01:00:00Z' },
  filters: [{ field: 'service_name', op: '=', value: 'gateway' }],
  limit: 100,
}

describe('useApi analytics request policy', () => {
  beforeEach(() => {
    invalidateAnalyticsRequests()
    setStorageUserId('user-1')
    useTenant().activeTenant.value = 'default'
  })

  afterEach(() => {
    invalidateAnalyticsRequests()
    setStorageUserId(null)
    useTenant().activeTenant.value = 'default'
    vi.unstubAllGlobals()
  })

  it('deduplicates and caches an idempotent analytics POST', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{"rows":[],"total":0}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const api = useApi()

    await Promise.all([api.queryEvents(query), api.queryEvents(query)])
    await api.queryEvents(query)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalidates analytics results after a successful mutation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/query')) return Promise.resolve(new Response('{"rows":[],"total":0}', { status: 200 }))
      return Promise.resolve(new Response('{"id":"dash-1","name":"Test"}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = useApi()

    await api.queryEvents(query)
    await api.queryEvents(query)
    await api.createDashboard({ name: 'Test' })
    await api.queryEvents(query)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/query'))).toHaveLength(2)
  })

  it('never shares a cached POST response across tenants', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{"rows":[],"total":0}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const api = useApi()
    const tenant = useTenant().activeTenant

    tenant.value = 'tenant-a'
    await api.queryEvents(query)
    tenant.value = 'tenant-b'
    await api.queryEvents(query)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sentTenants = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-Rush-Tenant'))
    expect(sentTenants).toEqual(['tenant-a', 'tenant-b'])
  })
})
