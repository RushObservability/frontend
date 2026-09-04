import { describe, expect, it } from 'vitest'
import source from './SignalTimelinePanel.vue?raw'

describe('SignalTimelinePanel', () => {
  it('separates normal traffic from errors without relying on color alone', () => {
    expect(source).toContain('timeline-bar--normal')
    expect(source).toContain('timeline-bar--error')
    expect(source).toContain('repeating-linear-gradient')
    expect(source).toContain('Error / 5xx')
  })

  it('supports inspection, zoom, and comparison interactions', () => {
    expect(source).toContain('@keydown.left.prevent="moveKeyboardHover(-1)"')
    expect(source).toContain("emit('rangeSelect', { startIndex, endIndex, compare })")
    expect(source).toContain('Drag to zoom. Hold Shift while dragging to compare a window.')
    expect(source).toContain('timeline-tooltip')
  })

  it('adapts its language to logs and traces', () => {
    expect(source).toContain("props.signal === 'logs' ? 'Log volume' : 'Trace volume'")
    expect(source).toContain("props.signal === 'logs' ? 'logs' : 'spans'")
  })
})
