import { ref, watch } from 'vue'
import type { SavedQuery } from '../types'

const STORAGE_KEY = 'rush_saved_queries'
const MAX_QUERIES = 20

function load(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist(queries: SavedQuery[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries))
}

export function useSavedQueries() {
  const queries = ref<SavedQuery[]>(load())

  watch(queries, (v) => persist(v), { deep: true })

  function save(query: Omit<SavedQuery, 'id' | 'createdAt'>) {
    const entry: SavedQuery = {
      ...query,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    queries.value = [entry, ...queries.value].slice(0, MAX_QUERIES)
  }

  function remove(id: string) {
    queries.value = queries.value.filter(q => q.id !== id)
  }

  return { queries, save, remove }
}
