import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['history', 'saved'])('scrubs existing unsafe %s entries from disk and rejects new ones', async kind => {
  const { setStorageUserId, tenantScopedStorageKey } = await import('./storageScope')
  const { effectScope, nextTick } = await import('vue')
  setStorageUserId('audit-user')
  const key = tenantScopedStorageKey(kind === 'history' ? 'test-history' : 'rush_saved_queries', 'default')!
  const unsafe = { filters: [{ field: 'password', value: 'fake-secret' }] }
  const safe = { id: 'safe', name: 'Errors', filters: [], query: { search: 'status=500' } }
  storage.set(key, JSON.stringify([safe, { id: 'unsafe', ...unsafe, query: unsafe }]))
  const scope = effectScope()
  const { useQueryHistory } = await import('./useQueryHistory')
  const { useSavedQueries } = await import('./useSavedQueries')
  scope.run(() => {
    if (kind === 'history') {
      const history = useQueryHistory('test-history')
      expect(history.entries.value.map(entry => entry.id)).toEqual(['safe'])
      history.push(unsafe)
      expect(history.entries.value).toHaveLength(1)
    } else {
      const saved = useSavedQueries()
      expect(saved.queries.value.map(entry => entry.id)).toEqual(['safe'])
      expect(saved.save({ name: 'Unsafe', filters: [{ key: 'password', value: 'fake-secret', operator: '=' }] } as never)).toBe(false)
    }
  })
  await nextTick()
  expect(storage.get(key)).not.toContain('fake-secret')
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1)
  scope.stop()
})
