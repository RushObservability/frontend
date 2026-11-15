import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOperationalTelemetry } from './operationalTelemetry'

afterEach(() => vi.useRealTimers())
describe('bounded operational telemetry', () => {
  it('buffers before SDK initialization without creating a disabled-collection timer', () => {
    vi.useFakeTimers()
    const metrics = createOperationalTelemetry()
    metrics.record('frontend_api_request', { outcome: 'success' }, 75)
    expect(vi.getTimerCount()).toBe(0)
    const sink = vi.fn()
    metrics.setSink(sink)
    vi.advanceTimersByTime(10_000)
    expect(sink).toHaveBeenCalledWith('frontend_api_request', expect.objectContaining({ count: 1, duration_count: 1, duration_ms_sum: 75, duration_ms_le_100: 1 }))
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds retained series and reports overflow without retaining rejected labels', () => {
    const metrics = createOperationalTelemetry(), sink = vi.fn()
    for (let i = 0; i < 1000; i++) metrics.record('frontend_exception', { stage: `stage_${i}` })
    metrics.record('frontend_exception', { stage: 'https://secret.example/?token=value' })
    metrics.setSink(sink); metrics.flush()
    expect(sink).toHaveBeenCalledTimes(65)
    expect(sink).toHaveBeenLastCalledWith('frontend_telemetry_dropped', { count: 936 })
    metrics.setSink(null)
  })
  it('retains numeric summaries when a sink fails and flushes them after recovery', () => {
    const metrics = createOperationalTelemetry(), sink = vi.fn()
    metrics.record('frontend_api_outage', { reason: 'network' }, 200)
    metrics.setSink(() => { throw new Error('unavailable') }); metrics.flush()
    metrics.setSink(sink); metrics.flush()
    expect(sink).toHaveBeenCalledTimes(1)
    metrics.flush(); expect(sink).toHaveBeenCalledTimes(1)
    metrics.setSink(null)
  })
})
