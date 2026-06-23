import { reactive } from 'vue'
import type { AddonDef } from '../integrations/catalog'

// Shared, reactive enable/disable + namespace state for integrations, backed by
// localStorage. A module-level store (singleton) so toggling in Settings updates
// the Integrations rail and nav live. Free add-ons (e.g. ArgoCD) only appear when
// enabled; licensed add-ons are gated by entitlement and ignore this.
const K8S_NAMESPACE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const enabledState = reactive<Record<string, boolean>>({})
const namespaceState = reactive<Record<string, string>>({})

const enabledKeyFor = (a: AddonDef) => a.enabledKey ?? `rush-integration-${a.key}-enabled`
const namespaceKeyFor = (a: AddonDef) => `rush-${a.key}-namespace`

function ensureEnabled(a: AddonDef): string {
  const k = enabledKeyFor(a)
  if (!(k in enabledState)) enabledState[k] = localStorage.getItem(k) === 'true'
  return k
}
function ensureNamespace(a: AddonDef): string {
  const k = namespaceKeyFor(a)
  if (!(k in namespaceState)) {
    const s = localStorage.getItem(k) || a.key
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
  localStorage.setItem(enabledKeyFor(a), String(v))
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
  localStorage.setItem(namespaceKeyFor(a), v)
  return true
}
