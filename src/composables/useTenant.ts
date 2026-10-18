import { ref, computed, watch } from 'vue'
import type { Tenant } from '../types'
import { authenticatedFetch, getSessionGeneration, onSessionChanged } from './authSession'
import {
  clearTenantScopedStorage,
  storageUserId,
  userScopedStorageKey,
} from './storageScope'
import { invalidateAnalyticsRequests } from '../lib/analyticsRequestCache'
import { stopPollingTasks } from './usePollingTask'

// The active tenant is stored by NAME (not UUID) because that's what the
// X-Rush-Tenant header uses and what ClickHouse data has in the tenant_id column.
const activeTenant = ref<string>('default')
const tenants = ref<Tenant[]>([])
const loaded = ref(false)
// Shown by the app shell when a `?tenant=` link could not be honored.
const linkedTenantNotice = ref('')
let loadPromise: Promise<void> | null = null
function resetTenants(): void {
  tenants.value = []
  loaded.value = false
  loadPromise = null
}
onSessionChanged(resetTenants)

const activeTenantName = computed(() => {
  const t = tenants.value.find((t) => t.name === activeTenant.value)
  return t?.name ?? activeTenant.value
})

const showSwitcher = computed(() => tenants.value.length > 1)

// Whether APM (traces/spans) ingest is enabled for the active tenant.
// Defaults to true when the tenant's signal config is absent (backward
// compatible) so the APM view stays available unless explicitly disabled.
const apmEnabled = computed(() => {
  const t = tenants.value.find((t) => t.name === activeTenant.value)
  return t?.signals?.apm !== false
})

// Whether metrics ingest is enabled for the active tenant. Defaults to true
// when the tenant's signal config is absent (backward compatible).
const metricsEnabled = computed(() => {
  const t = tenants.value.find((t) => t.name === activeTenant.value)
  return t?.signals?.metrics !== false
})

watch(storageUserId, (userId) => {
  resetTenants()
  if (!userId) {
    activeTenant.value = 'default'
    return
  }
  const key = userScopedStorageKey('active-tenant', userId)
  try { activeTenant.value = key ? (localStorage.getItem(key) || 'default') : 'default' } catch { activeTenant.value = 'default' }
}, { immediate: true, flush: 'sync' })

// The app shell and the router guard both need the list during startup;
// share one request between them.
function loadTenants(): Promise<void> {
  loadPromise ??= fetchTenants().finally(() => { loadPromise = null })
  return loadPromise
}

async function fetchTenants(): Promise<void> {
  const generation = getSessionGeneration()
  const userId = storageUserId.value
  try {
    const res = await authenticatedFetch('/api/v1/tenants', {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return
    const data: { tenants: Tenant[] } = await res.json()
    if (generation !== getSessionGeneration() || userId !== storageUserId.value) return
    tenants.value = data.tenants.filter((t) => t.enabled)

    // Validate stored tenant still exists in the list
    if (
      tenants.value.length > 0 &&
      !tenants.value.some((t) => t.name === activeTenant.value)
    ) {
      // Fall back to 'default' if it exists, otherwise first tenant
      const fallback = tenants.value.find((t) => t.name === 'default')
      const first = tenants.value[0]
      activeTenant.value = fallback ? fallback.name : (first ? first.name : 'default')
      const key = userScopedStorageKey('active-tenant')
      try { if (key) localStorage.setItem(key, activeTenant.value) } catch { /* storage may be unavailable */ }
    }

    loaded.value = true
  } catch {
    // Silently fail -- tenant list is non-critical
  }
}

/** Make `name` the active tenant and drop the old tenant's cached state. */
function persistActiveTenant(name: string): void {
  stopPollingTasks()
  invalidateAnalyticsRequests({
    userId: storageUserId.value || undefined,
    tenant: activeTenant.value,
  })
  clearTenantScopedStorage(activeTenant.value)
  activeTenant.value = name
  const key = userScopedStorageKey('active-tenant')
  try { if (key) localStorage.setItem(key, name) } catch { /* storage may be unavailable */ }
}

function setTenant(name: string): void {
  if (name === activeTenant.value) return
  persistActiveTenant(name)
  // Full page reload so every API call picks up the new tenant header
  window.location.reload()
}

export type LinkedTenantOutcome = 'current' | 'switched' | 'denied' | 'unavailable'

/**
 * Honor a tenant named in a link (`?tenant=<name>`). Only tenants in the
 * signed-in user's own tenant list are accepted; the server filters that list
 * to the tenants the user can access. On `switched` the caller must reload so
 * every request uses the new tenant.
 */
async function applyLinkedTenant(name: string): Promise<LinkedTenantOutcome> {
  linkedTenantNotice.value = ''
  if (!loaded.value) await loadTenants()
  if (!loaded.value) {
    linkedTenantNotice.value = `Couldn't check access to tenant "${name}". Showing "${activeTenant.value}".`
    return 'unavailable'
  }
  if (name === activeTenant.value) return 'current'
  if (!tenants.value.some((t) => t.name === name)) {
    linkedTenantNotice.value = `This link is for tenant "${name}", which you can't access or doesn't exist. Showing "${activeTenant.value}" instead.`
    return 'denied'
  }
  persistActiveTenant(name)
  return 'switched'
}

function dismissLinkedTenantNotice(): void {
  linkedTenantNotice.value = ''
}

export function useTenant() {
  return {
    activeTenant,
    tenants,
    activeTenantName,
    showSwitcher,
    apmEnabled,
    metricsEnabled,
    loaded,
    loadTenants,
    setTenant,
    applyLinkedTenant,
    linkedTenantNotice,
    dismissLinkedTenantNotice,
  }
}
