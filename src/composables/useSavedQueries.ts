import { computed, ref, watch } from 'vue'
import type { SavedQuery } from '../types'
import { useTenant } from './useTenant'
import {
  containsSensitiveMaterial,
  removeLegacyStorageKey,
  tenantScopedStorageKey,
} from './storageScope'

const STORAGE_KEY = 'rush_saved_queries'
const MAX_QUERIES = 20

function persist(key: string, queries: SavedQuery[]) {
  try { localStorage.setItem(key, JSON.stringify(queries.slice(0, MAX_QUERIES))) } catch { /* best effort */ }
}

export function useSavedQueries() {
  const { activeTenant } = useTenant()
  const storageKey = computed(() => tenantScopedStorageKey(STORAGE_KEY, activeTenant.value))
  removeLegacyStorageKey(STORAGE_KEY)
  const queries = ref<SavedQuery[]>([])

  watch(storageKey, (key) => { queries.value = key ? loadFrom(key) : [] }, { immediate: true })
  watch(queries, (v) => { if (storageKey.value) persist(storageKey.value, v) }, { deep: true })

  function save(query: Omit<SavedQuery, 'id' | 'createdAt'>) {
    if (containsSensitiveMaterial(query)) return false
    const entry: SavedQuery = {
      ...query,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    queries.value = [entry, ...queries.value].slice(0, MAX_QUERIES)
    return true
  }

  function remove(id: string) {
    queries.value = queries.value.filter(q => q.id !== id)
  }

  return { queries, save, remove }
}

function loadFrom(key: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is SavedQuery => !containsSensitiveMaterial(entry)).slice(0, MAX_QUERIES)
      : []
  } catch {
    return []
  }
}
