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

  describe('in-flight analytics vs. concurrent non-GET requests', () => {
    // Mirrors fetch's abort semantics so a coordinator abort rejects the search.
    function pendingSearchFetch(other: (url: string, init?: RequestInit) => Promise<Response>) {
      let release!: () => void
      let aborted = false
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.endsWith('/explore/search')) return other(url, init)
        return new Promise<Response>((resolve, reject) => {
          release = () => resolve(new Response('{"rows":[],"total":0}', { status: 200 }))
          init?.signal?.addEventListener('abort', () => {
            aborted = true
            const error = new Error('The request was aborted.')
            error.name = 'AbortError'
            reject(error)
          })
        })
      })
      return { fetchMock, release: () => release(), wasAborted: () => aborted }
    }
    const search = { ...query, mode: 'logs' } as never

    it('keeps an in-flight search alive across a session heartbeat (POST /auth/activity)', async () => {
      const { fetchMock, release, wasAborted } = pendingSearchFetch(() =>
        Promise.resolve(new Response('{"user":{"id":"user-1","username":"u","role":"admin"}}', { status: 200 })))
      vi.stubGlobal('fetch', fetchMock)
      const api = useApi()

      const pending = api.queryExplore(search, new AbortController().signal)
      await api.getMe(true)
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).endsWith('/auth/activity') && init?.method === 'POST')).toBe(true)
      expect(wasAborted()).toBe(false)

      release()
      await expect(pending).resolves.toEqual({ rows: [], total: 0 })
    })

    it('keeps an in-flight search alive across a read-only log value suggestion', async () => {
      const { fetchMock, release, wasAborted } = pendingSearchFetch(() =>
        Promise.resolve(new Response('["gateway"]', { status: 200 })))
      vi.stubGlobal('fetch', fetchMock)
      const api = useApi()

      const pending = api.queryExplore(search, new AbortController().signal)
      await api.suggestLogValues({ field: 'service_name', prefix: 'g', filters: [], time_range: query.time_range })
      expect(wasAborted()).toBe(false)

      release()
      await expect(pending).resolves.toEqual({ rows: [], total: 0 })
    })

    it('still aborts an in-flight search after a successful settings mutation', async () => {
      const { fetchMock, wasAborted } = pendingSearchFetch(() =>
        Promise.resolve(new Response('{"idle_timeout_seconds":900}', { status: 200 })))
      vi.stubGlobal('fetch', fetchMock)
      const api = useApi()

      const pending = api.queryExplore(search, new AbortController().signal)
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await api.saveSessionTimeoutSettings(900)
      await rejected
      expect(wasAborted()).toBe(true)
    })

    it('still aborts an in-flight search after a successful POST that creates a resource', async () => {
      const { fetchMock, wasAborted } = pendingSearchFetch(() =>
        Promise.resolve(new Response('{"id":"dash-1","name":"Test"}', { status: 200 })))
      vi.stubGlobal('fetch', fetchMock)
      const api = useApi()

      const pending = api.queryExplore(search, new AbortController().signal)
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await api.createDashboard({ name: 'Test' })
      await rejected
      expect(wasAborted()).toBe(true)
    })
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
