import { ref, computed, watch } from 'vue'
import type { Tenant } from '../types'
import { authenticatedFetch } from './authSession'
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
  if (!userId) {
    activeTenant.value = 'default'
    return
  }
  const key = userScopedStorageKey('active-tenant', userId)
  try { activeTenant.value = key ? (localStorage.getItem(key) || 'default') : 'default' } catch { activeTenant.value = 'default' }
}, { immediate: true })

async function loadTenants(): Promise<void> {
  try {
    const res = await authenticatedFetch('/api/v1/tenants', {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return
    const data: { tenants: Tenant[] } = await res.json()
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

function setTenant(name: string): void {
  if (name === activeTenant.value) return
  stopPollingTasks()
  invalidateAnalyticsRequests({
    userId: storageUserId.value || undefined,
    tenant: activeTenant.value,
  })
  clearTenantScopedStorage(activeTenant.value)
  activeTenant.value = name
  const key = userScopedStorageKey('active-tenant')
  try { if (key) localStorage.setItem(key, name) } catch { /* storage may be unavailable */ }
  // Full page reload so every API call picks up the new tenant header
  window.location.reload()
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
  }
}
