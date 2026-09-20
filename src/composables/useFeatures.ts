import { ref, watch } from 'vue'
import { useTenant } from './useTenant'
import { authenticatedFetch, getSessionGeneration, onSessionChanged } from './authSession'
import { storageUserId } from './storageScope'

export interface Features {
  [key: string]: boolean | number
  sre_agent: boolean
  argocd: boolean
  fluxcd: boolean
  kubernetes: boolean
  cloudwatch: boolean
  export_max_rows: number
  deploy_markers: boolean
  rum: boolean
}

// Module-level singleton (same pattern as useTenant/useAuth): every component
// sees the same flags, and a reload after toggling a feature in Settings
// updates the top bar and all gated buttons live.
const features = ref<Partial<Features>>({})
const loaded = ref(false)
const { activeTenant } = useTenant()
function resetFeatures(): void {
  features.value = {}
  loaded.value = false
}
onSessionChanged(resetFeatures)
watch([storageUserId, activeTenant], resetFeatures, { flush: 'sync' })

async function loadFeatures(): Promise<void> {
  const generation = getSessionGeneration()
  const userId = storageUserId.value
  const tenant = activeTenant.value
  try {
    const res = await authenticatedFetch('/api/v1/features', {
      credentials: 'same-origin',
      headers: { 'X-Rush-Tenant': tenant },
    })
    if (res.ok) {
      const data = await res.json()
      if (generation !== getSessionGeneration() || userId !== storageUserId.value || tenant !== activeTenant.value) return
      features.value = data
      loaded.value = true
    }
  } catch {
    /* non-critical — gated UI stays hidden until flags load */
  }
}

export function useFeatures() {
  return { features, loaded, loadFeatures }
}
