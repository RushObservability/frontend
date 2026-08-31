import { describe, expect, it } from 'vitest'
import { defaultPanelCaption, formatPanelRange, formatPanelSource } from './panelPresentation'

describe('panel presentation helpers', () => {
  it('formats dashboard ranges as compact panel context', () => {
    expect(formatPanelRange(30)).toBe('30m')
    expect(formatPanelRange(360)).toBe('6h')
    expect(formatPanelRange(1440)).toBe('1d')
    expect(formatPanelRange(10080)).toBe('7d')
  })

  it('shows every visible data source once', () => {
    expect(formatPanelSource({ source: 'metrics' })).toBe('Metrics')
    expect(formatPanelSource({
      source: 'spans',
      queries: [
        { ref_id: 'A', source: 'metrics', filters: [] },
        { ref_id: 'B', source: 'logs', filters: [] },
        { ref_id: 'C', source: 'metrics', filters: [] },
        { ref_id: 'D', source: 'spans', filters: [], hidden: true },
      ],
    })).toBe('Metrics + Logs')
    expect(formatPanelSource({
      queries: [{ ref_id: 'A', source: 'metrics', filters: [], hidden: true }],
    })).toBe('Metrics')
  })

  it('provides useful default captions for every panel type', () => {
    expect(defaultPanelCaption('timeseries')).toContain('Trend')
    expect(defaultPanelCaption('counter')).toContain('Current value')
    expect(defaultPanelCaption('bar')).toContain('ranked')
    expect(defaultPanelCaption('table')).toContain('records')
  })
})
