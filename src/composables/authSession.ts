type SessionExpiredListener = () => void

export interface AuthenticatedFetchOptions {
  ignoreUnauthorized?: boolean
  /** Abort an older request with the same key when a newer one starts. */
  requestKey?: string
  /** Maximum time to wait for response headers on each attempt. */
  timeoutMs?: number
  /** Retries apply only to idempotent requests and transient statuses. */
  retries?: number
  retryDelayMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 1
const DEFAULT_RETRY_DELAY_MS = 150
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const latestRequests = new Map<string, AbortController>()

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

function isIdempotent(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TypeError' || error.name === 'NetworkError'
}

function abortError(): Error {
  const error = new Error('The request was aborted.')
  error.name = 'AbortError'
  return error
}

function waitForRetry(ms: number, signals: Array<AbortSignal | undefined>): Promise<void> {
  const signal = signals.find((candidate) => candidate?.aborted)
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError())
  return new Promise((resolve, reject) => {
    const onAbort = (event: Event) => {
      const source = event.target as AbortSignal
      clearTimeout(timer)
      for (const candidate of signals) candidate?.removeEventListener('abort', onAbort)
      reject(source.reason ?? abortError())
    }
    const timer = setTimeout(() => {
      for (const candidate of signals) candidate?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    for (const candidate of signals) candidate?.addEventListener('abort', onAbort, { once: true })
  })
}

function timeoutError(): Error {
  const error = new Error('The request timed out. Please try again.')
  error.name = 'TimeoutError'
  return error
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: AuthenticatedFetchOptions,
): Promise<Response> {
  // All browser API calls use the session cookie boundary deliberately. Keep
  // this default centralized so one-off fetch callers cannot silently omit
  // credentials or allow sensitive responses to enter the HTTP cache.
  const method = (init?.method || 'GET').toUpperCase()
  const canRetry = isIdempotent(method)
  const retries = canRetry ? Math.max(0, options?.retries ?? DEFAULT_RETRIES) : 0
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
  const requestKey = options?.requestKey
  const latestController = requestKey ? new AbortController() : undefined
  const parentSignal = init?.signal ?? undefined

  if (requestKey) {
    latestRequests.get(requestKey)?.abort(abortError())
    latestRequests.set(requestKey, latestController!)
  }

  try {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController()
      let timedOut = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const onParentAbort = () => controller.abort(parentSignal?.reason)
      const onLatestAbort = () => controller.abort(abortError())

      if (parentSignal?.aborted) controller.abort(parentSignal.reason)
      else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
      if (latestController?.signal.aborted) controller.abort(abortError())
      else latestController?.signal.addEventListener('abort', onLatestAbort, { once: true })
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      }

      let response: Response
      try {
        response = await fetch(input, {
          ...init,
          credentials: init?.credentials ?? 'same-origin',
          cache: init?.cache ?? 'no-store',
          signal: controller.signal,
        })
      } catch (error) {
        if (timer) clearTimeout(timer)
        parentSignal?.removeEventListener('abort', onParentAbort)
        latestController?.signal.removeEventListener('abort', onLatestAbort)
        if (parentSignal?.aborted || latestController?.signal.aborted) throw error
        if ((timedOut || isRetryableError(error)) && attempt < retries) {
          await waitForRetry(retryDelayMs * (attempt + 1), [parentSignal, latestController?.signal])
          continue
        }
        if (timedOut) throw timeoutError()
        throw error
      }

      if (timer) clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
      latestController?.signal.removeEventListener('abort', onLatestAbort)

      // A newer keyed request may have won the race while this response was
      // resolving. Drop the body and do not let the stale response update UI.
      if (parentSignal?.aborted || latestController?.signal.aborted) {
        try { await response.body?.cancel() } catch { /* best effort: release the body */ }
        throw parentSignal?.reason ?? abortError()
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        try { await response.body?.cancel() } catch { /* best effort: release the body */ }
        await waitForRetry(retryDelayMs * (attempt + 1), [parentSignal, latestController?.signal])
        continue
      }

      if (response.status === 401 && !options?.ignoreUnauthorized) {
        reportSessionExpired()
      }
      return response
    }
  } finally {
    if (requestKey && latestRequests.get(requestKey) === latestController) {
      latestRequests.delete(requestKey)
    }
  }
}
