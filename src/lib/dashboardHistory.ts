import type { DashboardVersion, DashboardWithWidgets } from '../types'

const REASON_LABELS: Record<string, string> = {
  'dashboard.create': 'Created',
  'dashboard.import': 'Imported',
  'dashboard.update': 'Edited dashboard settings',
  'dashboard.restore': 'Restored an earlier version',
  'dashboard_widget.create': 'Added a panel',
  'dashboard_widget.update': 'Edited a panel',
  'dashboard_widget.delete': 'Removed a panel',
}

export function versionReasonLabel(reason: string): string {
  return REASON_LABELS[reason] || reason
}

// Key order differs between server JSON and objects edited in the browser.
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v)
}

export interface RestorePreview {
  /** Set when restoring changes the dashboard name. */
  renamedTo: string | null
  /** Panels the version has that the dashboard no longer has. */
  returning: string[]
  /** Panels on the dashboard now that the version does not have. */
  removing: string[]
  /** Panels in both whose title, type, query, layout or display differ. */
  changing: string[]
}

/** What restoring `version` would change on the dashboard as it is now. */
export function restorePreview(version: DashboardVersion, current: DashboardWithWidgets): RestorePreview {
  const then = version.snapshot.widgets
  const now = current.widgets
  const nowById = new Map(now.map(w => [w.id, w]))
  const thenIds = new Set(then.map(w => w.id))
  const same = (a: unknown, b: unknown) => sortedJson(a ?? {}) === sortedJson(b ?? {})
  return {
    renamedTo: version.snapshot.dashboard.name !== current.name ? version.snapshot.dashboard.name : null,
    returning: then.filter(w => !nowById.has(w.id)).map(w => w.title),
    removing: now.filter(w => !thenIds.has(w.id)).map(w => w.title),
    changing: then.filter(w => {
      const n = nowById.get(w.id)
      return n && !(n.title === w.title && n.widget_type === w.widget_type && same(n.query_config, w.query_config)
        && same(n.position, w.position) && same(n.display_config, w.display_config))
    }).map(w => w.title),
  }
}
