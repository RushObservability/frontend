import { describe, expect, it } from 'vitest'
import source from './SignalTimelinePanel.vue?raw'

describe('SignalTimelinePanel', () => {
  it('separates normal traffic from errors without relying on color alone', () => {
    expect(source).toContain('timeline-bar--normal')
    expect(source).toContain('timeline-bar--error')
    // Errors are solid and anchored at the base of each bar, so position as
    // well as color distinguishes them from normal traffic.
    expect(source.indexOf('timeline-bar timeline-bar--normal')).toBeLessThan(source.indexOf('timeline-bar timeline-bar--error'))
    expect(source).toContain('background: var(--error)')
    expect(source).toContain('Error / 5xx')
  })

  it('supports inspection, zoom, and comparison interactions', () => {
    expect(source).toContain('@keydown.left.prevent="moveKeyboardHover(-1)"')
    expect(source).toContain("emit('rangeSelect', { startIndex, endIndex, compare })")
    expect(source).toContain('Drag to zoom. Hold Shift while dragging to compare a window.')
    expect(source).toContain('timeline-readout')
  })

  it('adapts its language to logs and traces', () => {
    expect(source).toContain("props.signal === 'logs' ? 'Log volume' : props.resultLabel === 'spans' ? 'Span volume' : 'Trace volume'")
    expect(source).toContain("props.resultLabel ?? (props.signal === 'logs' ? 'events' : 'spans')")
  })

  it('puts the bucket details after the time axis and clears keyboard inspection on exit', () => {
    expect(source.indexOf('class="timeline-readout"')).toBeGreaterThan(source.indexOf('class="timeline-x-axis"'))
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('@keydown.esc.prevent="hoveredIndex = null"')
    expect(source).toContain('@blur="hoveredIndex = null"')
  })
})
