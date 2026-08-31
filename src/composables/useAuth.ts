import { ref, computed, readonly } from 'vue'
import type { AuthUser } from '../types'
import { useApi } from './useApi'
import { markSessionActive, onSessionExpired } from './authSession'
import { clearAllScopedStorage, setStorageUserId, storageUserId } from './storageScope'
import { invalidateAnalyticsRequests } from '../lib/analyticsRequestCache'
import { pausePollingTasks, resumePollingTasks, stopPollingTasks } from './usePollingTask'

const user = ref<AuthUser | null>(null)
const checked = ref(false)
const loading = ref(false)
const sessionActivityIntervalMs = ref(5 * 60 * 1_000)
let refreshPromise: Promise<void> | null = null

const isAuthenticated = computed(() => !!user.value)
const isAdmin = computed(() => user.value?.role === 'admin')
const canWrite = computed(() => user.value?.role === 'admin' || user.value?.role === 'write')

const { login: apiLogin, logout: apiLogout, getMe } = useApi()

function applySessionPolicy(activityIntervalSeconds?: number): void {
  if (!Number.isFinite(activityIntervalSeconds)) return
  const seconds = Math.max(30, Number(activityIntervalSeconds))
  sessionActivityIntervalMs.value = seconds * 1_000
}

// Clear cached identity as soon as any authenticated transport reports a 401.
// The App shell owns the corresponding route change.
onSessionExpired(() => {
  stopPollingTasks()
  invalidateAnalyticsRequests({ userId: user.value?.id || storageUserId.value || undefined })
  user.value = null
  setStorageUserId(null)
  clearAllScopedStorage()
  checked.value = true
  loading.value = false
})

async function checkSession(): Promise<void> {
  if (checked.value) return
  loading.value = true
  try {
    const response = await getMe()
    user.value = response.user
    applySessionPolicy(response.session?.activity_interval_seconds)
    setStorageUserId(user.value.id)
    markSessionActive()
  } catch {
    user.value = null
    setStorageUserId(null)
    clearAllScopedStorage()
  } finally {
    checked.value = true
    loading.value = false
  }
}

async function login(username: string, password: string): Promise<void> {
  const res = await apiLogin(username, password)
  invalidateAnalyticsRequests()
  if (storageUserId.value && storageUserId.value !== res.user.id) clearAllScopedStorage()
  user.value = res.user
  applySessionPolicy(res.session?.activity_interval_seconds)
  setStorageUserId(res.user.id)
  checked.value = true
  markSessionActive()
}

async function refreshSession(): Promise<void> {
  if (!user.value) return
  if (refreshPromise) return refreshPromise
  const expectedUserId = user.value.id

  refreshPromise = (async () => {
    const response = await getMe()
    // Do not restore identity if logout or session expiration won the race
    // while this activity refresh was in flight.
    if (user.value?.id !== expectedUserId) return
    user.value = response.user
    applySessionPolicy(response.session?.activity_interval_seconds)
    setStorageUserId(response.user.id)
    markSessionActive()
  })()

  try {
    await refreshPromise
  } finally {
    refreshPromise = null
  }
}

async function logout(): Promise<void> {
  // Keep the local identity when server-side revocation fails so the UI does
  // not claim the user is logged out while the session bearer remains valid.
  pausePollingTasks()
  try {
    await apiLogout()
  } catch (error) {
    resumePollingTasks()
    throw error
  }
  stopPollingTasks()
  invalidateAnalyticsRequests({ userId: user.value?.id || storageUserId.value || undefined })
  user.value = null
  setStorageUserId(null)
  clearAllScopedStorage()
  checked.value = false
}

export function useAuth() {
  return {
    user: readonly(user),
    isAuthenticated,
    isAdmin,
    canWrite,
    checked: readonly(checked),
    loading: readonly(loading),
    sessionActivityIntervalMs: readonly(sessionActivityIntervalMs),
    checkSession,
    refreshSession,
    login,
    logout,
  }
}
