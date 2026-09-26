// OpenTelemetry and Datadog ingest store a failed span's status as
// STATUS_CODE_ERROR. Rows written by older versions may say ERROR.

/** True when a span's status says it failed. */
export function isErrorStatus(status: string | null | undefined): boolean {
  if (!status) return false
  const normalized = status.toUpperCase()
  return normalized === 'STATUS_CODE_ERROR' || normalized === 'ERROR'
}

/** A failed span: failed status or HTTP 5xx, the same rule the Services page uses. */
export function isErrorSpan(span: { status?: string | null; http_status_code?: number | null }): boolean {
  return isErrorStatus(span.status) || (span.http_status_code ?? 0) >= 500
}
