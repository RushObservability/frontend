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
})
