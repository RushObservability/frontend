import { describe, expect, it } from 'vitest'
import { draftWidgets, previewHasData } from './dashboardDraft'
import type { DashboardExport } from '../types'

function draft(): DashboardExport {
  return { format_version: 'v1', exported_at: '', dashboard: { name: 'Payments', description: '', visibility: 'private', tags: [] }, widgets: [{ title: 'Latency', widget_type: 'timeseries', query_config: { source: 'spans', filters: [], aggregation: 'p95_ms' }, position: {}, display_config: {} }] }
}

describe('investigation dashboard drafts', () => {
  it('keeps unsaved panel identities stable and uses supported sources', () => {
    const panels = draftWidgets(draft())
    expect(panels[0]?.id).toBe('draft-0')
    expect(panels[0]?.query_config.aggregation).toBe('p95_ms')
    expect(panels[0]?.dashboard_id).toBe('')
  })
  it('rejects malformed or non-private proposals', () => {
    const response = draft()
    response.dashboard.visibility = 'global'
    expect(() => draftWidgets(response)).toThrow()
    response.dashboard.visibility = 'private'
    response.widgets[0]!.query_config.source = 'sql'
    expect(() => draftWidgets(response)).toThrow()
  })
  it('accepts real zero measurements but not absent or nonfinite samples', () => {
    expect(previewHasData({ type: 'counter', count: 0 })).toBe(true)
    expect(previewHasData({ type: 'timeseries', series: [{ name: 'cpu', points: [[1, 0]] }] })).toBe(true)
    expect(previewHasData({ type: 'timeseries', series: [{ name: 'cpu', points: [[1, NaN]] }] })).toBe(false)
    expect(previewHasData({ type: 'counter' })).toBe(false)
    expect(previewHasData({ type: 'table', rows: [] })).toBe(false)
  })
})
