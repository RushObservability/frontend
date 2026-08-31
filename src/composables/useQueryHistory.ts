import { computed, ref, watch, type Ref } from 'vue'
import { useTenant } from './useTenant'
import {
  containsSensitiveMaterial,
  removeLegacyStorageKey,
  tenantScopedStorageKey,
} from './storageScope'

export interface HistoryEntry<T> {
  id: string
  timestamp: number
  query: T
}

function load<T>(key: string, maxEntries: number): HistoryEntry<T>[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is HistoryEntry<T> => !containsSensitiveMaterial(entry)).slice(0, maxEntries)
      : []
  } catch {
    return []
  }
}

function persist<T>(key: string, entries: HistoryEntry<T>[], maxEntries: number) {
  try { localStorage.setItem(key, JSON.stringify(entries.slice(0, maxEntries))) } catch { /* best effort */ }
}

export function useQueryHistory<T>(storageKey: string, maxEntries = 100) {
  const { activeTenant } = useTenant()
  const scopedKey = computed(() => tenantScopedStorageKey(storageKey, activeTenant.value))
  const boundedMaxEntries = Math.max(1, Math.min(maxEntries, 100))
  removeLegacyStorageKey(storageKey)
  const entries = ref<HistoryEntry<T>[]>([]) as Ref<HistoryEntry<T>[]>

  watch(scopedKey, (key) => { entries.value = key ? load<T>(key, boundedMaxEntries) : [] }, { immediate: true })
  watch(entries, (v) => { if (v && scopedKey.value) persist(scopedKey.value, v, boundedMaxEntries) }, { deep: true })

  function push(query: T) {
    if (containsSensitiveMaterial(query)) return
    // Deduplicate: skip if identical to most recent entry
    if (entries.value.length > 0) {
      const latest = entries.value[0]!
      if (JSON.stringify(latest.query) === JSON.stringify(query)) return
    }
    const entry: HistoryEntry<T> = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      query,
    }
    entries.value = [entry, ...entries.value].slice(0, boundedMaxEntries)
  }

  function remove(id: string) {
    entries.value = entries.value.filter(e => e.id !== id)
  }

  function clear() {
    entries.value = []
  }

  return { entries, push, remove, clear }
}
