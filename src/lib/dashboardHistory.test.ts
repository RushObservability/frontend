import { describe, expect, it } from 'vitest'
import { restorePreview, versionReasonLabel } from './dashboardHistory'
import type { DashboardVersion, DashboardWithWidgets, Widget } from '../types'

const panel = (id: string, title: string, position: Record<string, number> = { col: 1, row: 1 }) => ({
  id, title, widget_type: 'timeseries', query_config: { source: 'spans' }, position, display_config: {},
})

function version(name: string, widgets: ReturnType<typeof panel>[]): DashboardVersion {
  return {
    id: 'v1', dashboard_id: 'd', reason: 'dashboard.update', created_by: 'u', created_by_name: 'alice',
    created_at: '2026-11-07 04:29:33',
    snapshot: { dashboard: { name, description: '', visibility: 'tenant', tags: [] }, widgets },
  }
}

function current(name: string, widgets: ReturnType<typeof panel>[]): DashboardWithWidgets {
  return {
    id: 'd', name, description: '', tenant_id: 'default', owner_id: 'u', visibility: 'tenant', tags: [],
    variables: [], created_at: '', updated_at: '',
    widgets: widgets.map(w => ({ ...w, dashboard_id: 'd', created_at: '', updated_at: '' }) as unknown as Widget),
  }
}

describe('restorePreview', () => {
  it('lists panels that come back, go away and change, and a rename', () => {
    const preview = restorePreview(
      version('Original', [panel('a', 'Errors'), panel('b', 'Latency', { col: 1, row: 2 })]),
      current('Renamed', [panel('b', 'Latency', { col: 7, row: 2 }), panel('c', 'Throughput')]),
    )
    expect(preview).toEqual({
      renamedTo: 'Original',
      returning: ['Errors'],
      removing: ['Throughput'],
      changing: ['Latency'],
    })
  })

  it('reports nothing when only JSON key order differs', () => {
    const preview = restorePreview(
      version('Same', [panel('a', 'Errors', { col: 1, row: 1 })]),
      current('Same', [panel('a', 'Errors', { row: 1, col: 1 })]),
    )
    expect(preview).toEqual({ renamedTo: null, returning: [], removing: [], changing: [] })
  })
})

describe('versionReasonLabel', () => {
  it('names known edits and falls back to the raw reason', () => {
    expect(versionReasonLabel('dashboard_widget.delete')).toBe('Removed a panel')
    expect(versionReasonLabel('something.new')).toBe('something.new')
  })
})
