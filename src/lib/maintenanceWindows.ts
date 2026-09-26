import type { MaintenanceWindow } from '../types'

export type ScopeKind = 'all' | 'monitor' | 'tag'

export interface ScopeDraft {
  kind: ScopeKind
  monitorId: string
  tagKey: string
  tagValue: string
}

/** Stored scope string for the API: `all`, `monitor:<id>`, or `tag:<key>:<value>`. */
export function scopeValue(draft: ScopeDraft): string {
  if (draft.kind === 'monitor') return `monitor:${draft.monitorId}`
  if (draft.kind === 'tag') return `tag:${draft.tagKey.trim()}:${draft.tagValue.trim()}`
  return 'all'
}

export function scopeReady(draft: ScopeDraft): boolean {
  if (draft.kind === 'monitor') return draft.monitorId !== ''
  if (draft.kind === 'tag') return draft.tagKey.trim() !== '' && draft.tagValue.trim() !== ''
  return true
}

/** Human label for a stored scope. `monitorName` resolves monitor ids. */
export function scopeLabel(scope: string, monitorName: (id: string) => string | undefined): string {
  if (!scope || scope === 'all') return 'All alerts'
  const monitorId = scope.startsWith('monitor:') ? scope.slice(8) : scope.startsWith('alert:') ? scope.slice(6) : null
  if (monitorId !== null) return monitorName(monitorId) ?? 'Deleted alert'
  if (scope.startsWith('tag:')) return scope.slice(4)
  return scope
}

const STATUS_ORDER: Record<string, number> = { active: 0, scheduled: 1, ended: 2 }

/** Active first, then upcoming by start time, then ended with the most recent first. */
export function sortWindows(windows: MaintenanceWindow[]): MaintenanceWindow[] {
  return [...windows].sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
    if (byStatus !== 0) return byStatus
    if (a.status === 'ended') return b.ends_at.localeCompare(a.ends_at)
    return a.starts_at.localeCompare(b.starts_at)
  })
}

/** `YYYY-MM-DDTHH:mm` in local time, the format a datetime-local input uses. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A datetime-local value, read as local time, as an RFC 3339 UTC string. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Shift a datetime-local value by `minutes`. */
export function addMinutes(value: string, minutes: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return toLocalInput(new Date(date.getTime() + minutes * 60_000))
}
