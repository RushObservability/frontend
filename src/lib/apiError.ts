/**
 * Convert an HTTP status into UI-safe copy without trusting the response body.
 * Backend bodies can contain stack traces, SQL, internal paths, or provider
 * details, so callers should never display them directly in the browser.
 */
export function safeApiErrorMessage(status: number, operation = 'Request'): string {
  switch (status) {
    case 400:
      return `${operation} was not accepted. Check the submitted values and try again.`
    case 401:
      return 'Session expired. Sign in again.'
    case 403:
      return 'You do not have permission to perform this action.'
    case 404:
      return 'The requested resource was not found.'
    case 409:
      return `${operation} conflicts with an existing resource.`
    case 413:
      return `${operation} is too large. Reduce the request and try again.`
    case 429:
      return 'Too many requests. Wait a moment and try again.'
    default:
      if (status >= 500) return `${operation} service is temporarily unavailable. Try again shortly.`
      return `${operation} failed (${status}). Please try again.`
  }
}

/**
 * The message of a 4xx `{error: {code, message}}` envelope, else undefined.
 * query-api builds that envelope only from fixed public copy, such as a PromQL
 * limit, so it is safe to show. Other bodies and every 5xx keep the copy above.
 */
export function publicApiErrorMessage(status: number, body: string): string | undefined {
  if (status < 400 || status >= 500) return undefined
  try {
    const error = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown } } | null)?.error
    if (typeof error?.code === 'string' && typeof error.message === 'string'
      && error.message.trim() && error.message.length <= 300) return error.message
  } catch { /* not an envelope */ }
  return undefined
}
