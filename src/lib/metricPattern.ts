const MAX_WORKERS = 2
const MATCH_TIMEOUT_MS = 2000
const pending: Array<() => void> = []
let active = 0

function drain() {
  while (active < MAX_WORKERS && pending.length) pending.shift()!()
}

/** A saved JavaScript regex must never execute on the UI thread. */
export function matchMetricNames(pattern: string, names: string[], limit: number, signal?: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let started = false
    let finished = false
    const finish = (error?: unknown, matches: string[] = []) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker?.terminate()
      if (started) active--
      else {
        const index = pending.indexOf(start)
        if (index >= 0) pending.splice(index, 1)
      }
      queueMicrotask(drain)
      if (error) reject(error)
      else resolve(matches)
    }
    const onAbort = () => finish(signal?.reason ?? new DOMException('Metric matching cancelled', 'AbortError'))
    const start = () => {
      started = true
      active++
      timer = setTimeout(() => finish(new Error('Metric pattern matching took too long. Simplify the detector pattern.')), MATCH_TIMEOUT_MS)
      try {
        worker = new Worker(new URL('../workers/metricPattern.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ names?: string[]; error?: string }>) => {
          if (event.data.error) finish(new Error(event.data.error))
          else finish(undefined, event.data.names ?? [])
        }
        worker.onerror = event => { event.preventDefault(); finish(new Error('Metric pattern matching is unavailable. Try again.')) }
        worker.onmessageerror = () => finish(new Error('Metric pattern matching returned an invalid result.'))
        // Vue's reactive arrays are proxies and cannot be structured-cloned.
        worker.postMessage({ pattern, names: [...names], limit })
      } catch { finish(new Error('Metric pattern matching is unavailable. Try again.')) }
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.push(start)
    drain()
  })
}
