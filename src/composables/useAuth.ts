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
const sessionIdleDeadlineMs = ref<number | null>(null)
let supportsActivityEndpoint = false
let refreshPromise: Promise<void> | null = null

const isAuthenticated = computed(() => !!user.value)
const isAdmin = computed(() => user.value?.role === 'admin')
const canWrite = computed(() => user.value?.role === 'admin' || user.value?.role === 'write')

const { login: apiLogin, logout: apiLogout, getMe } = useApi()

function applySessionPolicy(policy: { activity_interval_seconds?: number; idle_remaining_seconds?: number; idle_timeout_seconds?: number } | undefined, requestedAt: number): void {
  // Older APIs renew GET /auth/me. Keep rolling frontend/API upgrades usable.
  supportsActivityEndpoint = Number.isFinite(policy?.idle_timeout_seconds)
  const seconds = Number.isFinite(policy?.activity_interval_seconds)
    ? Math.max(30, Number(policy?.activity_interval_seconds)) : 300
  sessionActivityIntervalMs.value = seconds * 1_000
  const remaining = Number.isFinite(policy?.idle_remaining_seconds)
    ? Math.max(0, Number(policy?.idle_remaining_seconds)) : 2 * 60 * 60
  // Anchor before the request so a slow response or sleeping browser cannot
  // make an old server deadline appear newer than it is.
  sessionIdleDeadlineMs.value = requestedAt + remaining * 1_000
}

// Clear cached identity as soon as any authenticated transport reports a 401.
// The App shell owns the corresponding route change.
onSessionExpired(() => {
  stopPollingTasks()
  invalidateAnalyticsRequests({ userId: user.value?.id || storageUserId.value || undefined })
  user.value = null
  sessionIdleDeadlineMs.value = null
  setStorageUserId(null)
  clearAllScopedStorage()
  checked.value = true
  loading.value = false
})

async function checkSession(): Promise<void> {
  if (checked.value) return
  loading.value = true
  const requestedAt = Date.now()
  try {
    const response = await getMe()
    user.value = response.user
    applySessionPolicy(response.session, requestedAt)
    setStorageUserId(user.value.id)
    markSessionActive()
  } catch {
    user.value = null
    sessionIdleDeadlineMs.value = null
    setStorageUserId(null)
    clearAllScopedStorage()
  } finally {
    checked.value = true
    loading.value = false
  }
}

async function login(username: string, password: string): Promise<void> {
  const requestedAt = Date.now()
  const res = await apiLogin(username, password)
  invalidateAnalyticsRequests()
  if (storageUserId.value && storageUserId.value !== res.user.id) clearAllScopedStorage()
  user.value = res.user
  applySessionPolicy(res.session, requestedAt)
  setStorageUserId(res.user.id)
  checked.value = true
  markSessionActive()
}

async function refreshSession(activity = true): Promise<void> {
  if (!user.value) return
  if (refreshPromise) return refreshPromise
  const expectedUserId = user.value.id

  refreshPromise = (async () => {
    const requestedAt = Date.now()
    const response = await getMe(activity && supportsActivityEndpoint)
    // Do not restore identity if logout or session expiration won the race
    // while this activity refresh was in flight.
    if (user.value?.id !== expectedUserId) return
    if (!response.user?.id) throw new Error('Invalid session response')
    user.value = response.user
    applySessionPolicy(response.session, requestedAt)
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
  sessionIdleDeadlineMs.value = null
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
    sessionIdleDeadlineMs: readonly(sessionIdleDeadlineMs),
    checkSession,
    refreshSession,
    login,
    logout,
  }
}
