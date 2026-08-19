import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('shared time-range preference', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    })
  })

  it('persists one user-scoped range and restores it after switching users', async () => {
    const storage = await import('./storageScope')
    storage.setStorageUserId('alice')
    const preference = await import('./useTimeRangePreference')

    const first = preference.useTimeRangePreference()
    expect(first.value).toBe(60)

    expect(preference.applyTimeRangeOverride(720)).toBe(true)
    expect(localStorage.getItem('rush:v2:alice:user:time-range-minutes')).toBe('720')

    localStorage.setItem('rush:v2:bob:user:time-range-minutes', '360')
    storage.setStorageUserId('bob')
    expect(preference.useTimeRangePreference().value).toBe(360)
  })

  it('ignores invalid overrides', async () => {
    const storage = await import('./storageScope')
    storage.setStorageUserId('alice')
    const preference = await import('./useTimeRangePreference')

    expect(preference.applyTimeRangeOverride('not-a-range')).toBe(false)
    expect(preference.useTimeRangePreference().value).toBe(60)
  })
})
