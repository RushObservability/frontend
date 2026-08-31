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
