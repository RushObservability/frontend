import { ref, watch, type Ref } from 'vue'
import {
  removeLegacyStorageKey,
  storageUserId,
  userScopedStorageKey,
} from './storageScope'

const STORAGE_KEY = 'time-range-minutes'
const LEGACY_STORAGE_KEY = 'rush-time-range-minutes'
const DEFAULT_MINUTES = 60
const MAX_MINUTES = 525_600 // one year; guards corrupted browser storage

removeLegacyStorageKey(LEGACY_STORAGE_KEY)

const sharedMinutes = ref(DEFAULT_MINUTES)
let loadingStoredValue = false

function validMinutes(value: unknown): number | null {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return null
  return Math.round(minutes)
}

function loadForUser(userId: string | null): void {
  loadingStoredValue = true
  const key = userScopedStorageKey(STORAGE_KEY, userId)
  try {
    sharedMinutes.value = validMinutes(key ? localStorage.getItem(key) : null) ?? DEFAULT_MINUTES
  } catch {
    sharedMinutes.value = DEFAULT_MINUTES
  } finally {
    loadingStoredValue = false
  }
}

watch(storageUserId, loadForUser, { immediate: true, flush: 'sync' })

watch(sharedMinutes, (value) => {
  if (loadingStoredValue) return
  const minutes = validMinutes(value)
  const key = userScopedStorageKey(STORAGE_KEY)
  if (!minutes || !key) return
  try { localStorage.setItem(key, String(minutes)) } catch { /* storage may be unavailable */ }
}, { flush: 'sync' })

/**
 * Shared relative lookback window for the signed-in user.
 *
 * Pages should bind this ref directly to TimePicker. Exact custom from/to
 * windows stay local to the page, while their duration becomes the next
 * relative lookback when navigating elsewhere.
 */
export function useTimeRangePreference(): Ref<number> {
  return sharedMinutes
}

/** Apply a valid URL/share-link override and persist it as the new preference. */
export function applyTimeRangeOverride(value: unknown): boolean {
  const minutes = validMinutes(value)
  if (!minutes) return false
  sharedMinutes.value = minutes
  return true
}

export const DEFAULT_TIME_RANGE_MINUTES = DEFAULT_MINUTES

