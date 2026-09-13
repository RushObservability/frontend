import { computed, readonly, ref } from 'vue'

// Use the app's /api proxy, not nginx's own health route or the public ingest URL.
// With no cookie, query-api returns 401 without renewing a user's session.
export const API_AVAILABILITY_PATH = '/api/v1/auth/me'
const HEALTHY_INTERVAL_MS = 15_000
const RETRY_INTERVAL_MS = 5_000
const CONFIRM_DELAY_MS = 2_000
const TIMEOUT_MS = 4_000

export function createApiAvailabilityMonitor() {
  const unavailable = ref(false)
  const checking = ref(false)
  const offline = ref(false)
  const dismissed = ref(false)
  let failures = 0
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let pending: Promise<void> | undefined

  function markUnavailable() {
    if (!unavailable.value) dismissed.value = false
    unavailable.value = true
  }

  function schedule(delay: number) {
    clearTimeout(timer)
    if (active && !offline.value) timer = setTimeout(() => { void check() }, delay)
  }

  function check(): Promise<void> {
    if (!active) return Promise.resolve()
    if (pending) return pending
    clearTimeout(timer)
    offline.value = typeof navigator !== 'undefined' && navigator.onLine === false
    if (offline.value) {
      markUnavailable()
      return Promise.resolve()
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return Promise.resolve()

    const current = new AbortController()
    controller = current
    checking.value = true
    // Keep the timeout active through body parsing, not only response headers.
    const timeout = setTimeout(() => current.abort(), TIMEOUT_MS)
    pending = Promise.resolve().then(async () => {
      let reachable = false
      try {
        const response = await fetch(API_AVAILABILITY_PATH, {
          credentials: 'omit', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json' }, signal: current.signal,
        })
        // Authentication, permissions and rate limits are not service outages.
        if ([401, 403, 429].includes(response.status)) {
          reachable = true
          await response.body?.cancel()
        } else if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const body = await response.json()
          // Reject an SPA fallback or an unrelated proxy response with HTTP 200.
          reachable = typeof body?.user?.id === 'string'
        } else {
          await response.body?.cancel()
        }
      } catch {
        // Network errors, blocked requests, redirects and timeouts share one UI.
        // Never expose server response bodies or exception details in the dialog.
      } finally {
        clearTimeout(timeout)
        if (!active || controller !== current) return
        controller = undefined
        pending = undefined
        checking.value = false
        if (reachable) {
          failures = 0
          unavailable.value = false
          dismissed.value = false
        } else if (++failures >= 2) {
          markUnavailable()
        }
        schedule(failures === 1 ? CONFIRM_DELAY_MS : unavailable.value ? RETRY_INTERVAL_MS : HEALTHY_INTERVAL_MS)
      }
    })
    return pending
  }

  function onConnectionChange() {
    // Drop an in-flight probe so it cannot override an offline/online event.
    controller?.abort()
    controller = undefined
    pending = undefined
    checking.value = false
    void check()
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void check()
  }

  function start() {
    if (active) return
    active = true
    window.addEventListener('online', onConnectionChange)
    window.addEventListener('offline', onConnectionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void check()
  }

  function stop() {
    active = false
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    pending = undefined
    checking.value = false
    window.removeEventListener('online', onConnectionChange)
    window.removeEventListener('offline', onConnectionChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    unavailable: readonly(unavailable), checking: readonly(checking), offline: readonly(offline),
    open: computed(() => unavailable.value && !dismissed.value),
    dismiss: () => { dismissed.value = true },
    check, start, stop,
  }
}
