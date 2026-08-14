import { reactive, watch } from 'vue'
import type { AddonDef } from '../integrations/catalog'
import { useTenant } from './useTenant'
import {
  removeLegacyStorageKey,
  storageUserId,
  tenantScopedStorageKey,
} from './storageScope'

// Shared, reactive enable/disable + namespace state for integrations, backed by
// localStorage. A module-level store (singleton) so toggling in Settings updates
// the Integrations rail and nav live. Free add-ons (e.g. ArgoCD) only appear when
// enabled; licensed add-ons are gated by entitlement and ignore this.
const K8S_NAMESPACE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const enabledState = reactive<Record<string, boolean>>({})
const namespaceState = reactive<Record<string, string>>({})
const { activeTenant } = useTenant()

const enabledKeyFor = (a: AddonDef) => a.enabledKey ?? `rush-integration-${a.key}-enabled`
const namespaceKeyFor = (a: AddonDef) => `rush-${a.key}-namespace`
const scopedKeyFor = (base: string) => tenantScopedStorageKey(base, activeTenant.value)

watch([storageUserId, activeTenant], () => {
  for (const key of Object.keys(enabledState)) delete enabledState[key]
  for (const key of Object.keys(namespaceState)) delete namespaceState[key]
})

function ensureEnabled(a: AddonDef): string {
  const k = enabledKeyFor(a)
  removeLegacyStorageKey(k)
  if (!(k in enabledState)) {
    const scopedKey = scopedKeyFor(k)
    try { enabledState[k] = scopedKey ? localStorage.getItem(scopedKey) === 'true' : false } catch { enabledState[k] = false }
  }
  return k
}
function ensureNamespace(a: AddonDef): string {
  const k = namespaceKeyFor(a)
  if (!(k in namespaceState)) {
    removeLegacyStorageKey(k)
    const scopedKey = scopedKeyFor(k)
    let stored: string | null = null
    try { stored = scopedKey ? localStorage.getItem(scopedKey) : null } catch { /* storage may be unavailable */ }
    const s = stored || a.key
    namespaceState[k] = K8S_NAMESPACE_RE.test(s) ? s : a.key
  }
  return k
}

/** Free add-ons must be enabled to be visible; licensed add-ons are always "enabled" here. */
export function isAddonEnabled(a: AddonDef): boolean {
  if (!a.free) return true
  return enabledState[ensureEnabled(a)] ?? false
}

export function setAddonEnabled(a: AddonDef, v: boolean): void {
  enabledState[ensureEnabled(a)] = v
  const key = scopedKeyFor(enabledKeyFor(a))
  try { if (key) localStorage.setItem(key, String(v)) } catch { /* storage may be unavailable */ }
}

export function addonNamespace(a: AddonDef): string {
  return namespaceState[ensureNamespace(a)] ?? a.key
}

export function setAddonNamespaceDraft(a: AddonDef, v: string): void {
  namespaceState[ensureNamespace(a)] = v
}

export function namespaceValid(v: string): boolean {
  return K8S_NAMESPACE_RE.test(v)
}

/** Validate + persist the namespace. Returns false (no write) when invalid. */
export function saveAddonNamespace(a: AddonDef, v: string): boolean {
  if (!K8S_NAMESPACE_RE.test(v)) return false
  namespaceState[ensureNamespace(a)] = v
  const key = scopedKeyFor(namespaceKeyFor(a))
  try { if (key) localStorage.setItem(key, v) } catch { /* storage may be unavailable */ }
  return true
}
