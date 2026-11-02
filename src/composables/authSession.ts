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
let sessionGeneration = 0
let sessionController = new AbortController()
const sessionChangeListeners = new Set<() => void>()

export function getSessionGeneration(): number { return sessionGeneration }

export function onSessionChanged(listener: () => void): () => void {
  sessionChangeListeners.add(listener)
  return () => sessionChangeListeners.delete(listener)
}

/** Invalidate work belonging to the previous browser identity, even on re-login. */
export function advanceSessionGeneration(): number {
  sessionGeneration++
  const previous = sessionController
  sessionController = new AbortController()
  previous.abort(abortError())
  for (const listener of sessionChangeListeners) listener()
  return sessionGeneration
}

export function assertCurrentSession(generation: number): void {
  if (generation !== sessionGeneration) throw abortError()
}

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
  advanceSessionGeneration()
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

/** Keep cancellation and keyed ownership until the response body ends. */
function responseWithLifecycle(response: Response, signal: AbortSignal, release: () => void): Response {
  if (!response.body) { release(); return response }
  const reader = response.body.getReader()
  let finished = false
  let bodyController: ReadableStreamDefaultController<Uint8Array>
  const releaseReader = () => { try { reader.releaseLock() } catch { /* an abort may still be settling */ } }
  const finish = () => {
    if (finished) return
    finished = true
    signal.removeEventListener('abort', onAbort)
    release()
  }
  const onAbort = () => {
    if (finished) return
    const reason = signal.reason ?? abortError()
    bodyController.error(reason)
    finish()
    void reader.cancel(reason).catch(() => {}).finally(releaseReader)
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    },
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (finished) { releaseReader(); return }
        if (chunk.done) { controller.close(); finish(); releaseReader() }
        else controller.enqueue(chunk.value)
      } catch (error) {
        if (!finished) controller.error(error)
        finish()
        releaseReader()
      }
    },
    async cancel(reason) {
      finish()
      try { await reader.cancel(reason) } finally { releaseReader() }
    },
  })
  const metadata = (wrapped: Response): Response => {
    const clone = wrapped.clone.bind(wrapped)
    Object.defineProperties(wrapped, {
      url: { value: response.url }, type: { value: response.type }, redirected: { value: response.redirected },
      clone: { value: () => metadata(clone()) },
    })
    return wrapped
  }
  return metadata(new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }))
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: AuthenticatedFetchOptions,
): Promise<Response> {
  const generation = getSessionGeneration()
  const sessionSignal = sessionController.signal
  const method = (init?.method || 'GET').toUpperCase()
  const canRetry = isIdempotent(method)
  const retries = canRetry ? Math.max(0, options?.retries ?? DEFAULT_RETRIES) : 0
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
  const requestKey = options?.requestKey
  const latestController = requestKey ? new AbortController() : undefined
  const parentSignal = init?.signal ?? undefined
  const release = () => {
    if (requestKey && latestRequests.get(requestKey) === latestController) latestRequests.delete(requestKey)
  }
  let bodyOwnsRequest = false

  if (requestKey) {
    latestRequests.get(requestKey)?.abort(abortError())
    latestRequests.set(requestKey, latestController!)
  }

  try {
    for (let attempt = 0; ; attempt++) {
      assertCurrentSession(generation)
      const timeoutController = new AbortController()
      // Native signal composition keeps cancellation connected to the fetch
      // body without retaining manual listeners on a long-lived session signal.
      const signal = AbortSignal.any([sessionSignal, parentSignal, latestController?.signal, timeoutController.signal]
        .filter((candidate): candidate is AbortSignal => candidate !== undefined))
      let timedOut = false
      const timer = timeoutMs > 0 ? setTimeout(() => {
        timedOut = true
        timeoutController.abort()
      }, timeoutMs) : undefined

      let response: Response
      try {
        response = await fetch(input, {
          ...init,
          credentials: init?.credentials ?? 'same-origin',
          cache: init?.cache ?? 'no-store',
          signal,
        })
      } catch (error) {
        if (timer) clearTimeout(timer)
        assertCurrentSession(generation)
        if (parentSignal?.aborted || latestController?.signal.aborted) throw error
        if ((timedOut || isRetryableError(error)) && attempt < retries) {
          await waitForRetry(retryDelayMs * (attempt + 1), [parentSignal, latestController?.signal, sessionSignal])
          continue
        }
        if (timedOut) throw timeoutError()
        throw error
      }

      // This deadline covers headers only. SSE readers own their idle deadline.
      if (timer) clearTimeout(timer)
      if (signal.aborted) {
        try { await response.body?.cancel() } catch { /* release a raced response */ }
        assertCurrentSession(generation)
        if (timedOut && attempt < retries) {
          await waitForRetry(retryDelayMs * (attempt + 1), [parentSignal, latestController?.signal, sessionSignal])
          continue
        }
        throw timedOut ? timeoutError() : parentSignal?.reason ?? abortError()
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        try { await response.body?.cancel() } catch { /* release the retry body */ }
        await waitForRetry(retryDelayMs * (attempt + 1), [parentSignal, latestController?.signal, sessionSignal])
        continue
      }
      if (response.status === 401 && !options?.ignoreUnauthorized) reportSessionExpired()
      const wrapped = responseWithLifecycle(response, signal, release)
      bodyOwnsRequest = true
      return wrapped
    }
  } finally {
    if (!bodyOwnsRequest) release()
  }
}
