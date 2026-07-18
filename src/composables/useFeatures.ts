import { ref } from 'vue'
import { useTenant } from './useTenant'
import { authenticatedFetch } from './authSession'

export interface Features {
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

async function loadFeatures(): Promise<void> {
  try {
    const { activeTenant } = useTenant()
    const res = await authenticatedFetch('/api/v1/features', {
      credentials: 'same-origin',
      headers: { 'X-Rush-Tenant': activeTenant.value },
    })
    if (res.ok) {
      features.value = await res.json()
      loaded.value = true
    }
  } catch {
    /* non-critical — gated UI stays hidden until flags load */
  }
}

export function useFeatures() {
  return { features, loaded, loadFeatures }
}
