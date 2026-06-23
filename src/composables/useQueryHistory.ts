import { ref, watch, type Ref } from 'vue'

export interface HistoryEntry<T> {
  id: string
  timestamp: number
  query: T
}

function load<T>(key: string): HistoryEntry<T>[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist<T>(key: string, entries: HistoryEntry<T>[]) {
  localStorage.setItem(key, JSON.stringify(entries))
}

export function useQueryHistory<T>(storageKey: string, maxEntries = 100) {
  const entries = ref(load<T>(storageKey)) as Ref<HistoryEntry<T>[]>

  watch(entries, (v) => { if (v) persist(storageKey, v) }, { deep: true })

  function push(query: T) {
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
    entries.value = [entry, ...entries.value].slice(0, maxEntries)
  }

  function remove(id: string) {
    entries.value = entries.value.filter(e => e.id !== id)
  }

  function clear() {
    entries.value = []
  }

  return { entries, push, remove, clear }
}
