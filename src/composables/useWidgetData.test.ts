import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Widget } from '../types'
import { useWidgetData } from './useWidgetData'

const api = vi.hoisted(() => ({
  queryTimeseries: vi.fn(),
  countLogs: vi.fn(),
  groupLogs: vi.fn(),
  queryGroup: vi.fn(),
  promQueryRange: vi.fn(),
  logPatterns: vi.fn(),
  scatterPoints: vi.fn(),
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
  it('fetches tenant-filtered patterns with the captured range, variables and cancellation', async () => {
    api.logPatterns.mockResolvedValue({ patterns: [], total: 42 })
    const panel = widget('logs'); panel.widget_type = 'log-patterns'
    panel.query_config.filters = [{ field: 'service_name', op: '=', value: '$service' }]
    const controller = new AbortController(), range = { from: '2026-11-07T13:00:00Z', to: '2026-11-07T14:00:00Z' }
    const data = await useWidgetData().fetchWidgetData(panel, { service: 'payments' }, undefined, controller.signal, range)
    expect(api.logPatterns).toHaveBeenCalledWith({ time_range: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() }, filters: [{ field: 'service_name', op: '=', value: 'payments' }], limit: 10 }, controller.signal)
    expect(data.pattern_total).toBe(42)
  })
  it('preserves paired scatter fields and rejects unsupported metrics sources', async () => {
    api.scatterPoints.mockResolvedValue({ points: [], truncated: true })
    const panel = widget('spans'); panel.widget_type = 'scatter'; panel.query_config.x_field = 'attributes.bytes'; panel.query_config.y_field = 'duration_ms'
    const data = await useWidgetData().fetchWidgetData(panel)
    expect(api.scatterPoints).toHaveBeenCalledWith(expect.objectContaining({ source: 'spans', x_field: 'attributes.bytes', y_field: 'duration_ms', limit: 500 }), undefined)
    expect(data.truncated).toBe(true)
    panel.query_config.source = 'metrics'
    await expect(useWidgetData().fetchWidgetData(panel)).rejects.toThrow('event fields')
  })
  it('keeps the actual PromQL step so timeline gaps are not forward-filled indefinitely', async () => {
    api.promQueryRange.mockResolvedValue({ result: [{ metric: { service_name: 'payments' }, values: [[10, '0'], [20, '1']] }] })
    const panel = widget('spans'); panel.widget_type = 'state-timeline'; panel.query_config.source = 'metrics'; panel.query_config.promql = 'up'
    const data = await useWidgetData().fetchWidgetData(panel)
    expect(data.step_secs).toBe(14); expect(data.series?.[0]?.points[0]).toEqual([10, 0]); expect(data.time_domain).toBeDefined()
  })
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
