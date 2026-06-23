import { ref } from 'vue'
import type { LicenseStatus } from '../types'

// Module-level singleton (same pattern as useFeatures): one license status shared
// across the app so nav gating and the Integrations area react consistently.
const license = ref<LicenseStatus | null>(null)
const loaded = ref(false)

async function loadLicense(): Promise<void> {
  try {
    const res = await fetch('/api/v1/license', { credentials: 'same-origin' })
    if (res.ok) {
      license.value = await res.json()
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
