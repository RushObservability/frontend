import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInvestigationHealth } from './investigationHealth'
import { flushOperationalMetrics, setOperationalMetricSink } from './operationalTelemetry'
import { sanitizeRumEvent } from './rumPrivacy'
const sink = vi.fn()
beforeEach(() => { setOperationalMetricSink(sink); flushOperationalMetrics(); sink.mockClear() })
afterEach(() => { flushOperationalMetrics(); setOperationalMetricSink(null) })
describe('investigation stream health', () => {
  it('measures first evidence separately from initial thinking and records one completion', () => {
    let now = 0; const health = createInvestigationHealth(() => now)
    health.event('session_created'); now = 100; health.event('thinking_delta')
    now = 500; health.event('tool_result'); now = 800; health.event('summary')
    now = 1000; health.event('done'); health.finish('interrupted'); health.finish('cancelled')
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_investigation_first_response', expect.objectContaining({ kind: 'evidence', count: 1, duration_ms_sum: 500 }))
    expect(sink).toHaveBeenCalledWith('frontend_investigation_stream', expect.objectContaining({ outcome: 'completed', count: 1, duration_ms_sum: 1000 }))
    expect(sink).toHaveBeenCalledTimes(2)
  })
  it.each(['agent_error', 'http_error', 'idle_timeout', 'interrupted', 'limit_exceeded', 'cancelled', 'connection_error'] as const)('keeps terminal outcome %s when cleanup runs', outcome => {
    const health = createInvestigationHealth()
    health.finish(outcome); health.finish('interrupted')
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith('frontend_investigation_stream', expect.objectContaining({ outcome, count: 1 }))
  })
  it('preserves bounded discard counts through the production privacy scrubber', () => {
    const health = createInvestigationHealth()
    health.discard('malformed'); health.discard('malformed'); health.discard('field_truncated'); health.event('error')
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_investigation_discarded', { reason: 'malformed', count: 2 })
    for (const [name, attributes] of sink.mock.calls) {
      const event = { event_type: 'custom', event_name: name, attributes: JSON.stringify(attributes) }
      expect(sanitizeRumEvent(event, '/investigate')).toEqual(event)
    }
  })
})
