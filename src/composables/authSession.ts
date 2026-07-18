type SessionExpiredListener = () => void

const listeners = new Set<SessionExpiredListener>()
let expirationReported = false

/**
 * Subscribe to the single global session-expired signal. The signal is
 * transport-agnostic so the API layer can invalidate auth without importing
 * the router (which would create a useApi -> router -> useAuth cycle).
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function reportSessionExpired(): void {
  // A page can have many concurrent requests. Only redirect once when they all
  // fail after the same cookie expires.
  if (expirationReported) return
  expirationReported = true
  for (const listener of listeners) listener()
}

export function markSessionActive(): void {
  expirationReported = false
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { ignoreUnauthorized?: boolean },
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401 && !options?.ignoreUnauthorized) {
    reportSessionExpired()
  }
  return response
}
