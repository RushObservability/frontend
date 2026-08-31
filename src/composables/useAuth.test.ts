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

  afterEach(() => vi.unstubAllGlobals())

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
