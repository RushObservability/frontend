import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const alice = { id: 'alice', username: 'alice', role: 'admin' }
const bob = { id: 'bob', username: 'bob', role: 'read' }
const json = (data: unknown) => new Response(JSON.stringify(data))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index],
    get length() { return storage.size },
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('session response isolation', () => {
  it('coalesces bootstrap and cannot restore identity after expiration', async () => {
    const reply = deferred<Response>()
    const fetch = vi.fn(() => reply.promise)
    vi.stubGlobal('fetch', fetch)
    const auth = (await import('./useAuth')).useAuth()
    const first = auth.checkSession()
    const second = auth.checkSession()
    expect(fetch).toHaveBeenCalledTimes(1)
    ;(await import('./authSession')).reportSessionExpired()
    reply.resolve(json({ user: alice }))
    await Promise.all([first, second])
    expect(auth.user.value).toBeNull()
    expect(auth.sessionIdleDeadlineMs.value).toBeNull()
  })

  it('cannot replace a newer login with an old bootstrap response', async () => {
    const reply = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(reply.promise).mockResolvedValueOnce(json({ user: bob })))
    const auth = (await import('./useAuth')).useAuth()
    const check = auth.checkSession()
    await auth.login('bob', 'test-password')
    reply.resolve(json({ user: alice }))
    await check
    expect(auth.user.value?.id).toBe('bob')
  })

  it.each(['tenant', 'features', 'license'])('clears and rejects an old %s body after another user signs in', async kind => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: alice })))
    const auth = (await import('./useAuth')).useAuth()
    await auth.login('alice', 'test-password')
    const tenant = (await import('./useTenant')).useTenant()
    const features = (await import('./useFeatures')).useFeatures()
    const license = (await import('./useLicense')).useLicense()
    const load = kind === 'tenant' ? tenant.loadTenants : kind === 'features' ? features.loadFeatures : license.loadLicense
    const data = kind === 'tenant' ? { tenants: [{ name: 'alice-only', enabled: true }] }
      : kind === 'features' ? { sre_agent: true } : { valid: true, entitlements: ['postgres'] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(data)))
    await load()
    const body = deferred<unknown>()
    const bodyStarted = deferred<void>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => { bodyStarted.resolve(); return body.promise } }))
    const pending = load()
    await bodyStarted.promise
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: bob })))
    await auth.login('bob', 'test-password')
    body.resolve(data)
    await pending
    expect(tenant.tenants.value).toEqual([])
    expect(tenant.loaded.value).toBe(false)
    expect(features.features.value).toEqual({})
    expect(license.license.value).toBeNull()
  })

  it('rejects an API response whose body finishes after logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: alice })))
    const auth = (await import('./useAuth')).useAuth()
    await auth.login('alice', 'test-password')
    const body = deferred<string>()
    const started = deferred<void>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => { started.resolve(); return body.promise } }))
    const api = (await import('./useApi')).useApi()
    const pending = api.listDashboards()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await auth.logout()
    body.resolve('{"dashboards":[{"name":"private"}]}')
    await rejected
  })

  it('locks the UI instead of adopting a different identity returned on refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ user: alice })).mockResolvedValueOnce(json({ user: bob })))
    const auth = (await import('./useAuth')).useAuth()
    await auth.login('alice', 'test-password')
    await auth.refreshSession(false)
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('rejects an old refresh even when the same user signs in again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: alice })))
    const auth = (await import('./useAuth')).useAuth()
    await auth.login('alice', 'test-password')
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({ user: { ...alice, role: 'read' } })))
    const refresh = auth.refreshSession(false)
    await auth.login('alice', 'test-password')
    old.resolve(json({ user: alice }))
    await refresh
    expect(auth.user.value?.role).toBe('read')
  })

  it('preserves tenant state when logout revocation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: alice })))
    const auth = (await import('./useAuth')).useAuth()
    await auth.login('alice', 'test-password')
    const tenant = (await import('./useTenant')).useTenant()
    tenant.activeTenant.value = 'alice-only'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ tenants: [{ name: 'alice-only', enabled: true }] })))
    await tenant.loadTenants()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(auth.logout()).rejects.toThrow('temporarily unavailable')
    expect(auth.isAuthenticated.value).toBe(true)
    expect(tenant.activeTenant.value).toBe('alice-only')
    expect(tenant.tenants.value).toHaveLength(1)
  })
})
