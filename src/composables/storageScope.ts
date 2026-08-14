import { ref } from 'vue'

const STORAGE_PREFIX = 'rush:v2:'
const LEGACY_KEYS = new Set<string>()
const KNOWN_LEGACY_KEYS = [
  'rush-theme',
  'rush-active-tenant',
  'rush_saved_queries',
  'rush_metrics_history',
  'rush_explore_history',
  'rush-log-word-wrap',
  'svc_funnel_range_minutes',
  'funnels_range_minutes',
]

/** Set only in memory after the server has authenticated the current user. */
export const storageUserId = ref<string | null>(null)

export function setStorageUserId(userId: string | null): void {
  storageUserId.value = userId
}

export function userScopedStorageKey(baseKey: string, userId = storageUserId.value): string | null {
  if (!userId) return null
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:user:${baseKey}`
}

export function tenantScopedStorageKey(
  baseKey: string,
  tenant: string,
  userId = storageUserId.value,
): string | null {
  if (!userId) return null
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(tenant)}:${baseKey}`
}

/** Remove pre-v2 unscoped values so they cannot be exposed to another user. */
export function removeLegacyStorageKey(key: string): void {
  if (LEGACY_KEYS.has(key)) return
  LEGACY_KEYS.add(key)
  try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}

export function clearAllScopedStorage(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
    for (const key of KNOWN_LEGACY_KEYS) localStorage.removeItem(key)
  } catch { /* storage may be unavailable or quota-restricted */ }
}

export function clearTenantScopedStorage(tenant: string): void {
  const encodedTenant = encodeURIComponent(tenant)
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const parts = key?.split(':')
      if (parts?.[0] === 'rush' && parts[1] === 'v2' && parts[3] === encodedTenant) {
        keys.push(key!)
      }
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch { /* storage may be unavailable or quota-restricted */ }
}

/** Avoid persisting values that look like credentials or connection secrets. */
export function containsSensitiveMaterial(value: unknown): boolean {
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return true }
  return /(?:password|passwd|token|api[_-]?key|client[_-]?secret|authorization|dsn|secret)\s*[:=]/i.test(serialized)
}
