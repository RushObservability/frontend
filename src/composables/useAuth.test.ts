import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useAuth session expiration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'default'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('uses the server remaining idle deadline and renews only explicit activity', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const user = { id: 'idle-user', username: 'idle', display_name: '', tenant_id: 'default', role: 'read' }
    const response = () => new Response(JSON.stringify({
      user, session: { idle_timeout_seconds: 7200, idle_remaining_seconds: 90, activity_interval_seconds: 300 },
    }))
    const fetchMock = vi.fn().mockImplementation(response)
    vi.stubGlobal('fetch', fetchMock)
    const { useAuth } = await import('./useAuth')
    const auth = useAuth()
    await auth.checkSession()
    expect(auth.sessionIdleDeadlineMs.value).toBe(1_090_000)
    await auth.refreshSession(false)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/auth/me')
    await auth.refreshSession()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/auth/activity')
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('POST')
    const { reportSessionExpired } = await import('./authSession')
    reportSessionExpired()
    expect(auth.sessionIdleDeadlineMs.value).toBeNull()
  })

  it('defaults to a two-hour UI deadline when an older API omits policy metadata', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'old-api', username: 'test', role: 'read' },
    }))))
    const { useAuth } = await import('./useAuth')
    const auth = useAuth()
    await auth.checkSession()
    expect(auth.sessionIdleDeadlineMs.value).toBe(8_200_000)
  })

  it('does not extend the idle deadline by time spent waiting for a response', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const body = { user: { id: 'slow-api', username: 'test', role: 'read' }, session: {
      idle_timeout_seconds: 7200, idle_remaining_seconds: 90, activity_interval_seconds: 300,
    } }
    let resolve: (response: Response) => void = () => {}
    const delayed = new Promise<Response>(done => { resolve = done })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(body)))
      .mockReturnValueOnce(delayed))
    const { useAuth } = await import('./useAuth')
    const auth = useAuth()
    await auth.checkSession()
    const refresh = auth.refreshSession(false)
    now += 60_000
    resolve(new Response(JSON.stringify(body)))
    await refresh
    expect(auth.sessionIdleDeadlineMs.value).toBe(1_090_000)
  })

  it('clears cached identity after an authenticated API request returns 401', async () => {
    const user = {
      id: 'user-1',
      username: 'operator',
      display_name: 'Operator',
      tenant_id: 'default',
      role: 'write',
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Session expired' }), { status: 401 })))

    const { useAuth } = await import('./useAuth')
    const { useApi } = await import('./useApi')
    const auth = useAuth()

    await auth.login('operator', 'password')
    expect(auth.isAuthenticated.value).toBe(true)

    await expect(useApi().listDashboards()).rejects.toThrow('Session expired')
    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.checked.value).toBe(true)
  })

  it('keeps the local identity when server-side logout revocation fails', async () => {
    const user = {
      id: 'user-1',
      username: 'operator',
      display_name: 'Operator',
      tenant_id: 'default',
      role: 'write',
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }))
      .mockResolvedValueOnce(new Response('logout temporarily unavailable', { status: 503 })))

    const { useAuth } = await import('./useAuth')
    const auth = useAuth()

    await auth.login('operator', 'password')
    await expect(auth.logout()).rejects.toThrow('temporarily unavailable')
    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.user.value?.id).toBe(user.id)
  })

  it('uses the server renewal interval and coalesces concurrent activity touches', async () => {
    const user = {
      id: 'user-1',
      username: 'operator',
      display_name: 'Operator',
      tenant_id: 'default',
      role: 'write',
    }
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user,
        session: { activity_interval_seconds: 120 },
      }), { status: 200 }))
      .mockReturnValueOnce(refreshResponse)
    vi.stubGlobal('fetch', fetchMock)

    const { useAuth } = await import('./useAuth')
    const auth = useAuth()
    await auth.login('operator', 'password')

    expect(auth.sessionActivityIntervalMs.value).toBe(120_000)
    const first = auth.refreshSession()
    const second = auth.refreshSession()
    resolveRefresh?.(new Response(JSON.stringify({
      user,
      session: { activity_interval_seconds: 120 },
    }), { status: 200 }))
    await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not restore identity when logout wins an in-flight activity refresh', async () => {
    const user = {
      id: 'user-1',
      username: 'operator',
      display_name: 'Operator',
      tenant_id: 'default',
      role: 'write',
    }
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }))
      .mockReturnValueOnce(refreshResponse)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { useAuth } = await import('./useAuth')
    const auth = useAuth()
    await auth.login('operator', 'password')

    const refresh = auth.refreshSession()
    await auth.logout()
    resolveRefresh?.(new Response(JSON.stringify({ user }), { status: 200 }))
    await refresh

    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.user.value).toBeNull()
  })
})
