import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Widget } from '../types'
import { useWidgetData } from './useWidgetData'

const api = vi.hoisted(() => ({
  queryTimeseries: vi.fn(),
  countLogs: vi.fn(),
}))
vi.mock('./useApi', () => ({ useApi: () => api }))

function widget(source: 'spans' | 'logs'): Widget {
  return {
    id: 'widget', dashboard_id: 'dashboard', title: 'Requests', widget_type: 'timeseries',
    query_config: { source, time_range_minutes: 60, filters: [] },
    position: { col: 0, row: 0, col_span: 1, row_span: 1 },
    display_config: {}, created_at: '', updated_at: '',
  }
}

describe('dashboard bucket times', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T01:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('plots grouped span buckets inside the requested window', async () => {
    api.queryTimeseries.mockResolvedValue({
      grouped: true,
      buckets: [{ bucket: '2026-09-17 00:30:00', group_key: 'gateway', count: 4, error_count: 0 }],
    })
    const data = await useWidgetData().fetchWidgetData(widget('spans'))
    expect(data.series?.[0]?.points).toEqual([[Date.parse('2026-09-17T00:30:00Z') / 1000, 4]])
    expect(data.series?.[0]?.points[0]?.[0]).toBeGreaterThan(data.time_domain!.from)
    expect(data.series?.[0]?.points[0]?.[0]).toBeLessThan(data.time_domain!.to)
  })

  it('normalizes log buckets the same way', async () => {
    api.countLogs.mockResolvedValue([{ bucket: '2026-09-17 00:30:00', count: 5 }])
    const panel = widget('logs')
    panel.query_config.queries = [{ ref_id: 'A', source: 'logs', filters: [] }]
    const data = await useWidgetData().fetchWidgetData(panel)
    expect(data.series?.[0]?.points).toEqual([[Date.parse('2026-09-17T00:30:00Z') / 1000, 5]])
  })
})
