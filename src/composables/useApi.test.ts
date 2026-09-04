import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('tenant-aware API transport', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'rush:v2:user-a:user:active-tenant' ? 'customer-a' : null),
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

    const { setStorageUserId } = await import('./storageScope')
    setStorageUserId('user-a')
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

  it('marks dashboard panel reads with the bounded dashboard workload class', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ buckets: [], grouped: false }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { setStorageUserId } = await import('./storageScope')
    setStorageUserId('user-a')
    const { useApi } = await import('./useApi')
    await useApi().queryTimeseries({
      time_range: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
      filters: [],
    }, 'dashboard')

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-Rush-Tenant']).toBe('customer-a')
    expect(headers['X-Rush-Workload']).toBe('dashboard')
  })

  it('deduplicates identical in-flight reads within the active tenant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ services: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { setStorageUserId } = await import('./storageScope')
    setStorageUserId('user-a')
    const { useApi } = await import('./useApi')
    const api = useApi()

    const [first, second] = await Promise.all([api.getServices(), api.getServices()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })

  it('does not expose a legacy login token to frontend callers', async () => {
    const user = {
      id: 'user-1',
      username: 'operator',
      display_name: 'Operator',
      tenant_id: 'default',
      role: 'write',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user, token: 'legacy-session-bearer' }), { status: 200 }),
    ))

    const { useApi } = await import('./useApi')
    const response = await useApi().login('operator', 'password')

    expect(response).toEqual({ user })
    expect(response).not.toHaveProperty('token')
  })

  it('preserves the HTTP status when login credentials are rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, { status: 401 }),
    ))

    const { useApi } = await import('./useApi')

    await expect(useApi().login('operator', 'wrong-password')).rejects.toMatchObject({
      status: 401,
    })
  })

  it('encodes identifiers as single URL path segments', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({}), { status: 200 }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    const { useApi } = await import('./useApi')
    const api = useApi()
    await api.getTrace('trace/with spaces?#')
    await api.getDashboard('dashboard/with spaces')
    await api.getSlo('slo/with spaces')
    await api.getAnomalyRule('rule/with spaces')
    await api.getMonitor('monitor/with spaces')

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/traces/trace%2Fwith%20spaces%3F%23',
      '/api/v1/dashboards/dashboard%2Fwith%20spaces',
      '/api/v1/slos/slo%2Fwith%20spaces',
      '/api/v1/anomaly-rules/rule%2Fwith%20spaces',
      '/api/v1/monitors/monitor%2Fwith%20spaces',
    ])
  })

  it('uses the admin-only inventory and revocation routes for session controls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { useApi } = await import('./useApi')
    const api = useApi()
    await api.listAuthSessions(true)
    await api.revokeAuthSession('f76df181-95e0-4e91-a24f-12f3d10daa5a', true)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/admin/sessions')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/v1/auth/admin/sessions/f76df181-95e0-4e91-a24f-12f3d10daa5a',
    )
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('queries and opens Kubernetes access evidence through admin routes', async () => {
    const accessEvent = {
      id: 'request/with spaces',
      source_kind: 'gateway',
      verb: 'list',
      resource: 'pods',
      recording_state: 'complete',
      created_at: '2026-08-21T12:00:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [accessEvent], total: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(accessEvent), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chunks: [], has_more: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { useApi } = await import('./useApi')
    const api = useApi()
    const list = await api.getKubernetesAccessEvents({
      actor: 'mike@example.com',
      namespace: 'payments',
      recording_state: 'complete',
      limit: 50,
      offset: 0,
    })
    const detail = await api.getKubernetesAccessEvent(accessEvent.id)
    const chunks = await api.getKubernetesSessionChunks('session/with spaces', 12, 50)

    const listUrl = new URL(fetchMock.mock.calls[0]?.[0], 'http://rush.local')
    expect(listUrl.pathname).toBe('/api/v1/kubernetes/access-events')
    expect(listUrl.searchParams.get('actor')).toBe('mike@example.com')
    expect(listUrl.searchParams.get('namespace')).toBe('payments')
    expect(listUrl.searchParams.get('recording_state')).toBe('complete')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/kubernetes/access-events/request%2Fwith%20spaces')
    const chunkUrl = new URL(fetchMock.mock.calls[2]?.[0], 'http://rush.local')
    expect(chunkUrl.pathname).toBe('/api/v1/kubernetes/sessions/session%2Fwith%20spaces/chunks')
    expect(chunkUrl.searchParams.get('after_sequence')).toBe('12')
    expect(chunkUrl.searchParams.get('limit')).toBe('50')
    expect(list.events).toHaveLength(1)
    expect(detail.event.id).toBe(accessEvent.id)
    expect(chunks.has_more).toBe(false)
  })

  it('previews and approves kubectl login codes with the browser session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'pending',
        cluster_id: 'orbstack',
        approval_expires_at: '2026-08-22 12:10:00',
        credential_ttl_seconds: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'approved',
        cluster_id: 'orbstack',
        credential_expires_at: '2026-08-22 13:00:00',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { useApi } = await import('./useApi')
    const api = useApi()
    await api.getKubernetesLoginDetails('A1B2C3D4E5F6A7B8')
    await api.approveKubernetesLogin('A1B2C3D4E5F6A7B8')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/kubernetes/login/details')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/kubernetes/login/approve')
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('POST')
      expect(init?.credentials).toBe('same-origin')
      expect(JSON.parse(init?.body as string)).toEqual({ user_code: 'A1B2C3D4E5F6A7B8' })
    }
  })

  it('sends coordinated Explore searches with tenant scope and caller cancellation', async () => {
    const fetchMock = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setStorageUserId } = await import('./storageScope')
    setStorageUserId('user-a')
    const { useApi } = await import('./useApi')
    const controller = new AbortController()
    const pending = useApi().queryExplore({
      signal: 'spans',
      time_range: { from: '2026-08-10T00:00:00Z', to: '2026-08-10T01:00:00Z' },
      filters: [{ field: 'service_name', op: '=', value: 'gateway' }],
      search: 'POST',
      interval: '1m',
    }, controller.signal)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [path, init] = fetchMock.mock.calls[0]!
    const forwardedSignal = init.signal as AbortSignal
    const headers = init.headers as Record<string, string>
    expect(path).toBe('/api/v1/explore/search')
    expect(forwardedSignal).toBeInstanceOf(AbortSignal)
    expect(headers['X-Rush-Tenant']).toBe('customer-a')
    expect(JSON.parse(init.body as string)).toMatchObject({ signal: 'spans', search: 'POST' })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(forwardedSignal.aborted).toBe(true)
  })
})
