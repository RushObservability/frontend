import { computed, ref, watch } from 'vue'
import type { ApiSavedQuery, SavedQuery, SavedQueryInput, SavedQueryVisibility } from '../types'
import { useApi } from './useApi'
import { useAuth } from './useAuth'
import { useTenant } from './useTenant'
import {
  containsSensitiveMaterial,
  removeLegacyStorageKey,
  tenantScopedStorageKey,
} from './storageScope'

const STORAGE_KEY = 'rush_saved_queries'
const MAX_LOCAL_QUERIES = 20

/** What the caller supplies when saving; identity and ownership come from the server. */
export type SavedQueryDraft = Pick<SavedQuery, 'name' | 'filters' | 'groupBy' | 'timePreset' | 'search' | 'viewMode'> & {
  visibility?: SavedQueryVisibility
}

// Browser-only entries are moved to the server once per storage key, even if
// several components mount the composable at the same time.
const migrating = new Set<string>()

export function fromApiSavedQuery(q: ApiSavedQuery): SavedQuery {
  const createdAt = Date.parse(`${q.created_at.replace(' ', 'T')}Z`)
  return {
    id: q.id,
    name: q.name,
    filters: q.query.filters.map((f, i) => ({ id: `f-${i}`, field: f.field, op: f.op, value: f.value })),
    groupBy: q.query.group_by,
    timePreset: q.query.time_preset,
    search: q.query.search || undefined,
    viewMode: q.query.view_mode || undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    visibility: q.visibility,
    ownerId: q.owner_id,
    ownerName: q.owner_name,
  }
}

export function toSavedQueryInput(draft: SavedQueryDraft): SavedQueryInput {
  return {
    name: draft.name,
    visibility: draft.visibility ?? 'private',
    query: {
      filters: draft.filters.map(({ field, op, value }) => ({ field, op, value: String(value) })),
      search: draft.search ?? '',
      group_by: draft.groupBy ?? '',
      time_preset: draft.timePreset ?? 0,
      view_mode: draft.viewMode ?? '',
    },
  }
}

function persist(key: string, queries: SavedQuery[]) {
  try { localStorage.setItem(key, JSON.stringify(queries.slice(0, MAX_LOCAL_QUERIES))) } catch { /* best effort */ }
}

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Saved queries are unavailable'
}

export function useSavedQueries() {
  const api = useApi()
  const { user, isAuthenticated, isAdmin, canWrite } = useAuth()
  const { activeTenant } = useTenant()
  const storageKey = computed(() => tenantScopedStorageKey(STORAGE_KEY, activeTenant.value))
  removeLegacyStorageKey(STORAGE_KEY)

  // Signed-in users keep queries on the server so they follow them across
  // browsers and can be shared. Signed-out use (public tenants) stays local.
  const serverMode = computed(() => isAuthenticated.value)
  const queries = ref<SavedQuery[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let generation = 0

  async function refresh() {
    if (!serverMode.value) return
    const current = ++generation
    loading.value = true
    try {
      const { saved_queries } = await api.listSavedQueries()
      if (current === generation) {
        queries.value = saved_queries.map(fromApiSavedQuery)
        error.value = null
      }
    } catch (e) {
      if (current === generation) error.value = errorMessage(e)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function migrateLocal(key: string | null) {
    if (!key || migrating.has(key)) return
    let remaining = loadFrom(key)
    if (!remaining.length) return
    migrating.add(key)
    try {
      // Oldest first, so the server's newest-first order matches the old list.
      for (const entry of [...remaining].reverse()) {
        try {
          await api.createSavedQuery(toSavedQueryInput({ ...entry, visibility: 'private' }))
          remaining = remaining.filter(q => q.id !== entry.id)
          persist(key, remaining)
        } catch {
          // Keep the entry in the browser and retry on the next load.
        }
      }
      if (!remaining.length) localStorage.removeItem(key)
    } finally {
      migrating.delete(key)
    }
  }

  watch([storageKey, serverMode], async ([key, server]) => {
    generation++
    error.value = null
    if (!server) {
      queries.value = key ? loadFrom(key) : []
      return
    }
    queries.value = []
    loading.value = true
    await migrateLocal(key)
    await refresh()
  }, { immediate: true })

  watch(queries, (v) => {
    if (!serverMode.value && storageKey.value) persist(storageKey.value, v)
  }, { deep: true })

  async function save(draft: SavedQueryDraft): Promise<boolean> {
    if (containsSensitiveMaterial(draft)) return false
    if (!serverMode.value) {
      const entry: SavedQuery = { ...draft, id: crypto.randomUUID(), createdAt: Date.now() }
      delete entry.visibility
      queries.value = [entry, ...queries.value].slice(0, MAX_LOCAL_QUERIES)
      return true
    }
    try {
      const created = await api.createSavedQuery(toSavedQueryInput(draft))
      queries.value = [fromApiSavedQuery(created), ...queries.value]
      error.value = null
      return true
    } catch (e) {
      error.value = errorMessage(e)
      return false
    }
  }

  async function setVisibility(id: string, visibility: SavedQueryVisibility): Promise<boolean> {
    const existing = queries.value.find(q => q.id === id)
    if (!existing || !serverMode.value) return false
    try {
      const updated = fromApiSavedQuery(await api.updateSavedQuery(id, toSavedQueryInput({ ...existing, visibility })))
      queries.value = queries.value.map(q => (q.id === id ? updated : q))
      error.value = null
      return true
    } catch (e) {
      error.value = errorMessage(e)
      return false
    }
  }

  async function remove(id: string): Promise<void> {
    if (!serverMode.value) {
      queries.value = queries.value.filter(q => q.id !== id)
      return
    }
    try {
      await api.deleteSavedQuery(id)
      queries.value = queries.value.filter(q => q.id !== id)
      error.value = null
    } catch (e) {
      error.value = errorMessage(e)
    }
  }

  /** Resolve a shared link. Returns null when the query is missing or not visible. */
  async function fetchById(id: string): Promise<SavedQuery | null> {
    if (!serverMode.value) return null
    try {
      return fromApiSavedQuery(await api.getSavedQuery(id))
    } catch {
      return null
    }
  }

  const canShare = computed(() => serverMode.value && canWrite.value)

  function isOwner(q: SavedQuery): boolean {
    return !q.visibility || q.ownerId === user.value?.id
  }

  // Mirrors the server's rules in handlers/saved_queries.rs.
  function canModify(q: SavedQuery): boolean {
    if (!q.visibility) return true
    if (q.visibility === 'tenant') return isAdmin.value || (isOwner(q) && canWrite.value)
    return isOwner(q)
  }

  return { queries, loading, error, serverMode, canShare, save, setVisibility, remove, refresh, fetchById, isOwner, canModify }
}

function loadFrom(key: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    const safe = Array.isArray(parsed)
      ? parsed.filter((entry): entry is SavedQuery => !containsSensitiveMaterial(entry)).slice(0, MAX_LOCAL_QUERIES)
      : []
    localStorage.setItem(key, JSON.stringify(safe))
    return safe
  } catch {
    return []
  }
}
