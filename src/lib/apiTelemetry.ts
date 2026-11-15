import { recordOperationalMetric } from './operationalTelemetry'

const FAMILIES = new Set(['auth', 'query', 'explore', 'logs', 'traces', 'profiles', 'rum', 'services', 'dashboards', 'notebooks', 'monitors', 'anomalies', 'anomaly-events', 'slos', 'slo', 'integrations', 'settings', 'system', 'tenants', 'users', 'groups', 'roles', 'apikeys', 'export', 'exports', 'investigate', 'sessions', 'suggest', 'stats', 'bubbleup', 'features', 'license', 'retention'])
export function apiOperation(input: RequestInfo | URL): string | null {
  try {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://rush.invalid').pathname
    if (/\/rum\/(?:ingest|replay\/ingest)\/?$/.test(path)) return null
    if (path.startsWith('/prom/')) return 'prometheus'
    const family = path.replace(/^\/api\/v1\//, '/').split('/')[1] || ''
    return FAMILIES.has(family) ? family : 'other'
  } catch { return 'other' }
}
export const apiMethod = (method?: string) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes((method || 'GET').toUpperCase()) ? (method || 'GET').toUpperCase() : 'OTHER'
export const statusClass = (status?: number) => status && status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : 'none'
export function requestOutcome(error: unknown): string {
  const value = error as { name?: string; status?: number; apiDecodeFailure?: boolean; apiBodyFailure?: boolean } | null
  if (value?.name === 'AbortError') return 'cancelled'
  if (value?.name === 'TimeoutError') return 'timeout'
  if (value?.status) return 'http_error'
  if (value?.apiBodyFailure) return 'body_error'
  if (value?.name === 'SyntaxError' || value?.apiDecodeFailure) return 'decode_error'
  if (value?.name === 'TypeError' || value?.name === 'NetworkError') return 'network_error'
  return 'other_error'
}
export function recordApiMetric(name: string, operation: string | null, method: string, outcome: string, durationMs?: number, status?: number, cancellation = 'none') {
  if (operation === null) return
  recordOperationalMetric(name, { operation, method: apiMethod(method), outcome, status_class: statusClass(status), cancel_reason: cancellation }, durationMs)
}
