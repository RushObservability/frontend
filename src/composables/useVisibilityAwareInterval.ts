import { onBeforeUnmount, onMounted } from 'vue'

type PollCallback = () => void | Promise<void>

/**
 * Runs a polling callback only while the document is visible. Returning to a
 * tab triggers one immediate refresh, then resumes the normal interval.
 */
export function useVisibilityAwareInterval(callback: PollCallback, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null
  let active = false
  let currentIntervalMs = intervalMs

  const clear = () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const run = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    void Promise.resolve(callback()).catch(() => {
      // Individual views own their visible error state. Polling is best-effort
      // and must not create unhandled promise rejections in the app shell.
    })
  }

  const schedule = () => {
    clear()
    if (!active || (typeof document !== 'undefined' && document.hidden)) return
    timer = setInterval(run, currentIntervalMs)
  }

  const onVisibilityChange = () => {
    if (!active) return
    if (document.hidden) {
      clear()
    } else {
      schedule()
      run()
    }
  }

  const start = () => {
    active = true
    schedule()
  }

  const stop = () => {
    active = false
    clear()
  }

  const setIntervalMs = (value: number) => {
    currentIntervalMs = Math.max(1, value)
    if (active) schedule()
  }

  onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { start, stop, setIntervalMs }
}
