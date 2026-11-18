import { recordOperationalMetric } from './operationalTelemetry'

type Outcome = 'completed' | 'agent_error' | 'http_error' | 'idle_timeout' | 'interrupted' | 'limit_exceeded' | 'cancelled' | 'connection_error'
type Discard = 'malformed' | 'unknown_event' | 'field_truncated' | 'oversized' | 'event_limit'
/** Per-attempt state contains clocks and booleans only, never investigation content. */
export function createInvestigationHealth(now = () => performance.now()) {
  const started = now()
  let ended = false, useful = false
  function finish(outcome: Outcome) {
    if (ended) return
    ended = true
    recordOperationalMetric('frontend_investigation_stream', { outcome }, Math.max(0, now() - started))
  }
  return {
    finish,
    event(type: string) {
      if (ended) return
      if (!useful && (type === 'tool_result' || type === 'summary')) {
        useful = true
        recordOperationalMetric('frontend_investigation_first_response', { kind: type === 'summary' ? 'report' : 'evidence' }, Math.max(0, now() - started))
      }
      if (type === 'done') finish('completed')
      if (type === 'error') finish('agent_error')
    },
    discard(reason: Discard) { recordOperationalMetric('frontend_investigation_discarded', { reason }) },
  }
}
