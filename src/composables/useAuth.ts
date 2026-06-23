import { ref, computed, readonly } from 'vue'
import type { AuthUser } from '../types'
import { useApi } from './useApi'

const user = ref<AuthUser | null>(null)
const checked = ref(false)
const loading = ref(false)

const isAuthenticated = computed(() => !!user.value)
const isAdmin = computed(() => user.value?.role === 'admin')
const canWrite = computed(() => user.value?.role === 'admin' || user.value?.role === 'write')

const { login: apiLogin, logout: apiLogout, getMe } = useApi()

async function checkSession(): Promise<void> {
  if (checked.value) return
  loading.value = true
  try {
    user.value = await getMe()
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
