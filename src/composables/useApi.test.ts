import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('tenant-aware API transport', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'rush-active-tenant' ? 'customer-a' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scopes service-detail query and stream requests to the active tenant', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ buckets: [], grouped: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { useApi } = await import('./useApi')
    const api = useApi()

    await api.queryTimeseries({
      time_range: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
      filters: [{ field: 'service_name', op: '=', value: 'articles' }],
    })
    await api.openInvestigationStream({ question: 'What changed?' })

    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)['X-Rush-Tenant']).toBe('customer-a')
      expect(init?.credentials).toBe('same-origin')
    }
  })
})
