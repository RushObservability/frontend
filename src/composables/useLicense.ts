import { ref, watch } from 'vue'
import type { LicenseStatus } from '../types'
import { authenticatedFetch, getSessionGeneration, onSessionChanged } from './authSession'
import { storageUserId } from './storageScope'

// Module-level singleton (same pattern as useFeatures): one license status shared
// across the app so nav gating and the Integrations area react consistently.
const license = ref<LicenseStatus | null>(null)
const loaded = ref(false)
function resetLicense(): void {
  license.value = null
  loaded.value = false
}
onSessionChanged(resetLicense)
watch(storageUserId, resetLicense, { flush: 'sync' })

async function loadLicense(): Promise<void> {
  const generation = getSessionGeneration()
  const userId = storageUserId.value
  try {
    const res = await authenticatedFetch('/api/v1/license', { credentials: 'same-origin' })
    if (res.ok) {
      const data = await res.json()
      if (generation !== getSessionGeneration() || userId !== storageUserId.value) return
      license.value = data
      loaded.value = true
    }
  } catch {
    /* non-critical — entitled UI stays hidden until the license loads */
  }
}

/** True when a valid license carries the given add-on entitlement. */
function hasEntitlement(addon: string): boolean {
  const l = license.value
  return !!l && l.valid && l.entitlements.includes(addon)
}

export function useLicense() {
  return { license, loaded, loadLicense, hasEntitlement }
}
