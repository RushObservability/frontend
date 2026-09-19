import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Widget } from '../types'
import { useWidgetData } from './useWidgetData'

const api = vi.hoisted(() => ({
  queryTimeseries: vi.fn(),
  countLogs: vi.fn(),
  groupLogs: vi.fn(),
  queryGroup: vi.fn(),
  promQueryRange: vi.fn(),
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

  it('passes histogram queries through the numeric time-series data path', async () => {
    api.queryTimeseries.mockResolvedValue({
      grouped: false,
      buckets: [{ bucket: '2026-09-17 00:30:00', count: 4, error_count: 0 }],
    })
    const panel = widget('spans')
    panel.widget_type = 'histogram'
    panel.query_config.queries = [{ ref_id: 'A', source: 'spans', filters: [] }]
    const data = await useWidgetData().fetchWidgetData(panel)
    expect(data.type).toBe('histogram')
    expect(data.series?.[0]?.points).toEqual([[Date.parse('2026-09-17T00:30:00Z') / 1000, 4]])
  })

  it('uses grouped counts for log and span pies and preserves metric series', async () => {
    api.groupLogs.mockResolvedValue({ groups: [{ key: 'ERROR', count: 4 }] })
    api.queryGroup.mockResolvedValue({ groups: [{ key: 'payments', count: 7 }] })
    const logPanel = widget('logs')
    logPanel.widget_type = 'pie'
    const spanPanel = widget('spans')
    spanPanel.widget_type = 'pie'
    expect((await useWidgetData().fetchWidgetData(logPanel)).groups).toEqual([{ key: 'ERROR', count: 4 }])
    expect((await useWidgetData().fetchWidgetData(spanPanel)).groups).toEqual([{ key: 'payments', count: 7 }])
    api.promQueryRange.mockResolvedValue({ result: [{ metric: { service: 'payments' }, values: [[1, '10'], [2, '25']] }] })
    spanPanel.query_config.source = 'metrics'
    spanPanel.query_config.promql = 'sum(rate(requests_total[5m])) by (service)'
    expect((await useWidgetData().fetchWidgetData(spanPanel)).series?.[0]?.points).toEqual([[1, 10], [2, 25]])
  })
})
