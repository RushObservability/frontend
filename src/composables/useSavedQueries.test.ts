import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import type { ApiSavedQuery } from '../types'

const user = ref<{ id: string; role: string } | null>({ id: 'alice', role: 'write' })
const api = {
  listSavedQueries: vi.fn(),
  getSavedQuery: vi.fn(),
  createSavedQuery: vi.fn(),
  updateSavedQuery: vi.fn(),
  deleteSavedQuery: vi.fn(),
}
vi.mock('./useApi', () => ({ useApi: () => api }))
vi.mock('./useTenant', () => ({ useTenant: () => ({ activeTenant: ref('default') }) }))
vi.mock('./useAuth', () => ({
  useAuth: () => ({
    user,
    isAuthenticated: computed(() => !!user.value),
    isAdmin: computed(() => user.value?.role === 'admin'),
    canWrite: computed(() => user.value?.role === 'admin' || user.value?.role === 'write'),
  }),
}))

function apiQuery(overrides: Partial<ApiSavedQuery> = {}): ApiSavedQuery {
  return {
    id: 'q1', tenant_id: 'default', name: 'Checkout errors', description: '',
    visibility: 'tenant', owner_id: 'bob', owner_name: 'Bob',
    query: { filters: [{ field: 'service.name', op: '=', value: 'checkout' }], search: 'timeout', group_by: 'status', time_preset: 60, view_mode: 'logs' },
    created_at: '2026-10-18 12:00:00', updated_at: '2026-10-18 12:00:00',
    ...overrides,
  }
}

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  user.value = { id: 'alice', role: 'write' }
  for (const fn of Object.values(api)) fn.mockReset()
  api.listSavedQueries.mockResolvedValue({ saved_queries: [apiQuery()] })
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const { setStorageUserId } = await import('./storageScope')
  setStorageUserId('alice')
  const { useSavedQueries } = await import('./useSavedQueries')
  const scope = effectScope()
  const saved = scope.run(() => useSavedQueries())!
  await vi.waitFor(() => expect(saved.loading.value).toBe(false))
  return { saved, scope }
}

it('maps API queries into the Explore shape and back', async () => {
  const { fromApiSavedQuery, toSavedQueryInput } = await import('./useSavedQueries')
  const query = fromApiSavedQuery(apiQuery())
  expect(query).toMatchObject({
    id: 'q1', groupBy: 'status', timePreset: 60, search: 'timeout', viewMode: 'logs',
    visibility: 'tenant', ownerId: 'bob', ownerName: 'Bob',
    filters: [{ field: 'service.name', op: '=', value: 'checkout' }],
  })
  expect(toSavedQueryInput(query)).toEqual({
    name: 'Checkout errors', visibility: 'tenant',
    query: apiQuery().query,
  })
})

it('loads server queries and moves browser-only entries to the server as private', async () => {
  const { tenantScopedStorageKey } = await import('./storageScope')
  const key = tenantScopedStorageKey('rush_saved_queries', 'default', 'alice')!
  storage.set(key, JSON.stringify([
    { id: 'local-new', name: 'Newer', filters: [], groupBy: '', timePreset: 15, createdAt: 2 },
    { id: 'local-old', name: 'Older', filters: [], groupBy: '', timePreset: 15, createdAt: 1 },
  ]))
  api.createSavedQuery.mockResolvedValue(apiQuery({ visibility: 'private', owner_id: 'alice' }))
  const { saved, scope } = await setup()

  expect(api.createSavedQuery.mock.calls.map(([input]) => [input.name, input.visibility])).toEqual([
    ['Older', 'private'],
    ['Newer', 'private'],
  ])
  expect(storage.has(key)).toBe(false)
  expect(saved.queries.value.map(q => q.id)).toEqual(['q1'])
  scope.stop()
})

it('keeps a browser entry when moving it to the server fails', async () => {
  const { tenantScopedStorageKey } = await import('./storageScope')
  const key = tenantScopedStorageKey('rush_saved_queries', 'default', 'alice')!
  storage.set(key, JSON.stringify([{ id: 'local', name: 'Keep me', filters: [], groupBy: '', timePreset: 15, createdAt: 1 }]))
  api.createSavedQuery.mockRejectedValue(new Error('offline'))
  const { scope } = await setup()
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1)
  scope.stop()
})

it('saves to the server with the chosen visibility and reports failures', async () => {
  const { saved, scope } = await setup()
  api.createSavedQuery.mockResolvedValueOnce(apiQuery({ id: 'q2', owner_id: 'alice' }))
  const ok = await saved.save({ name: 'Shared', filters: [], groupBy: '', timePreset: 60, visibility: 'tenant' })
  expect(ok).toBe(true)
  expect(api.createSavedQuery.mock.calls[0][0].visibility).toBe('tenant')
  expect(saved.queries.value[0].id).toBe('q2')

  api.createSavedQuery.mockRejectedValueOnce(new Error('Write access is required'))
  expect(await saved.save({ name: 'Nope', filters: [], groupBy: '', timePreset: 60 })).toBe(false)
  expect(saved.error.value).toBe('Write access is required')

  // Credentials are rejected before any request is made.
  api.createSavedQuery.mockClear()
  expect(await saved.save({ name: 'Secret', filters: [{ id: 'f', field: 'password', op: '=', value: 'x' }], groupBy: '', timePreset: 60 })).toBe(false)
  expect(api.createSavedQuery).not.toHaveBeenCalled()
  scope.stop()
})

it('mirrors the server permission rules', async () => {
  const { saved, scope } = await setup()
  const { fromApiSavedQuery } = await import('./useSavedQueries')
  const sharedByBob = fromApiSavedQuery(apiQuery())
  const sharedByAlice = fromApiSavedQuery(apiQuery({ owner_id: 'alice' }))
  const privateByAlice = fromApiSavedQuery(apiQuery({ owner_id: 'alice', visibility: 'private' }))

  expect(saved.canModify(sharedByBob)).toBe(false)
  expect(saved.canModify(sharedByAlice)).toBe(true)
  expect(saved.canModify(privateByAlice)).toBe(true)
  expect(saved.canShare.value).toBe(true)

  user.value = { id: 'alice', role: 'viewer' }
  await nextTick()
  expect(saved.canModify(sharedByAlice)).toBe(false)
  expect(saved.canModify(privateByAlice)).toBe(true)
  expect(saved.canShare.value).toBe(false)

  user.value = { id: 'carol', role: 'admin' }
  await nextTick()
  expect(saved.canModify(sharedByBob)).toBe(true)
  expect(saved.canModify(privateByAlice)).toBe(false)
  scope.stop()
})
