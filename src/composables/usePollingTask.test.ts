import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PollingScheduler } from './usePollingTask'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

describe('polling scheduler lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never overlaps slow refreshes', async () => {
    const scheduler = new PollingScheduler({ random: () => 0.5 })
    const pending = deferred()
    const run = vi.fn(() => pending.promise)
    const task = scheduler.register({ category: 'dashboard', intervalMs: 1_000, immediate: true, run })

    task.start()
    await settle()
    expect(run).toHaveBeenCalledTimes(1)

    task.refreshNow()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)

    pending.resolve()
    await settle()
    await vi.advanceTimersByTimeAsync(999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('aborts and schedules no requests after unmount or logout', async () => {
    const scheduler = new PollingScheduler()
    let signal: AbortSignal | undefined
    const run = vi.fn(({ signal: taskSignal }: { signal: AbortSignal }) => {
      signal = taskSignal
      return new Promise<void>(() => {})
    })
    const unmounted = scheduler.register({ category: 'slo_detail', intervalMs: 1_000, immediate: true, run })

    unmounted.start()
    await settle()
    scheduler.unregister(unmounted)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)

    const logoutRun = vi.fn(async () => {})
    const logoutTask = scheduler.register({ category: 'slo_list', intervalMs: 1_000, run: logoutRun })
    logoutTask.start()
    scheduler.stopAll()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logoutRun).not.toHaveBeenCalled()

    const afterLogin = vi.fn(async () => {})
    scheduler.register({ category: 'capacity', intervalMs: 1_000, immediate: true, run: afterLogin }).start()
    await settle()
    expect(afterLogin).toHaveBeenCalledTimes(1)
  })

  it('pauses hidden and offline tasks and performs one immediate refresh on resume', async () => {
    const scheduler = new PollingScheduler()
    const run = vi.fn(async () => {})
    const task = scheduler.register({ category: 'capacity', intervalMs: 1_000, run })

    scheduler.setVisible(false)
    task.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).not.toHaveBeenCalled()

    scheduler.setVisible(true)
    await settle()
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.setOnline(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    scheduler.setOnline(true)
    await settle()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('honors Retry-After and resets backoff after success', async () => {
    const scheduler = new PollingScheduler({ random: () => 0.5 })
    const run = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { retryAfterMs: 30_000 }))
      .mockResolvedValue(undefined)
    const task = scheduler.register({ category: 'explore_live', intervalMs: 10_000, immediate: true, run })

    task.start()
    await settle()
    expect(task.state.value.backoffMs).toBe(30_000)
    expect(task.state.value.consecutiveFailures).toBe(1)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(run).toHaveBeenCalledTimes(2)
    expect(task.state.value.consecutiveFailures).toBe(0)
    expect(task.state.value.backoffMs).toBeNull()
  })
})
