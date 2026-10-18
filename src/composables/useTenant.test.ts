import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
let storage: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index],
    get length() { return storage.size },
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function setup(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  const { setStorageUserId } = await import('./storageScope')
  setStorageUserId('alice')
  const tenant = (await import('./useTenant')).useTenant()
  return { tenant, fetch }
}

const list = { tenants: [{ name: 'default', enabled: true }, { name: 'prod', enabled: true }] }

describe('tenant links', () => {
  it('switches to a tenant from the user list and remembers it', async () => {
    const { tenant } = await setup(json(list))
    expect(await tenant.applyLinkedTenant('prod')).toBe('switched')
    expect(tenant.activeTenant.value).toBe('prod')
    expect([...storage.values()]).toContain('prod')
    expect(tenant.linkedTenantNotice.value).toBe('')
  })

  it('reports the current tenant without switching', async () => {
    const { tenant } = await setup(json(list))
    expect(await tenant.applyLinkedTenant('default')).toBe('current')
    expect(tenant.activeTenant.value).toBe('default')
  })

  it('refuses a tenant the user cannot access and says so', async () => {
    const { tenant } = await setup(json(list))
    expect(await tenant.applyLinkedTenant('acme')).toBe('denied')
    expect(tenant.activeTenant.value).toBe('default')
    expect(tenant.linkedTenantNotice.value).toContain('"acme"')
    expect(tenant.linkedTenantNotice.value).toContain('Showing "default"')
    tenant.dismissLinkedTenantNotice()
    expect(tenant.linkedTenantNotice.value).toBe('')
  })

  it('keeps the current tenant when the list cannot be loaded', async () => {
    const { tenant } = await setup(json({ error: 'nope' }, 500))
    expect(await tenant.applyLinkedTenant('prod')).toBe('unavailable')
    expect(tenant.activeTenant.value).toBe('default')
    expect(tenant.linkedTenantNotice.value).toContain("Couldn't check access")
  })

  it('shares one tenant request between concurrent loads', async () => {
    const { tenant, fetch } = await setup(json(list))
    await Promise.all([tenant.loadTenants(), tenant.loadTenants()])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
