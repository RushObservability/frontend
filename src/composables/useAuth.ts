import { ref, computed, readonly } from 'vue'
import type { AuthUser } from '../types'
import { useApi } from './useApi'
import { markSessionActive, onSessionExpired } from './authSession'

const user = ref<AuthUser | null>(null)
const checked = ref(false)
const loading = ref(false)

const isAuthenticated = computed(() => !!user.value)
const isAdmin = computed(() => user.value?.role === 'admin')
const canWrite = computed(() => user.value?.role === 'admin' || user.value?.role === 'write')

const { login: apiLogin, logout: apiLogout, getMe } = useApi()

// Clear cached identity as soon as any authenticated transport reports a 401.
// The App shell owns the corresponding route change.
onSessionExpired(() => {
  user.value = null
  checked.value = true
  loading.value = false
})

async function checkSession(): Promise<void> {
  if (checked.value) return
  loading.value = true
  try {
    user.value = await getMe()
    markSessionActive()
  } catch {
    user.value = null
  } finally {
    checked.value = true
    loading.value = false
  }
}

async function login(username: string, password: string): Promise<void> {
  const res = await apiLogin(username, password)
  user.value = res.user
  checked.value = true
  markSessionActive()
}

async function logout(): Promise<void> {
  try {
    await apiLogout()
  } finally {
    user.value = null
    checked.value = false
  }
}

export function useAuth() {
  return {
    user: readonly(user),
    isAuthenticated,
    isAdmin,
    canWrite,
    checked: readonly(checked),
    loading: readonly(loading),
    checkSession,
    login,
    logout,
  }
}
