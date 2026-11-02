import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchMetricNames } from './metricPattern'

class FakeWorker {
  static workers: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.workers.push(this) }
  complete(names: string[]) { this.onmessage?.({ data: { names } } as MessageEvent) }
}

describe('bounded metric pattern workers', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWorker.workers = []; vi.stubGlobal('Worker', FakeWorker) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('returns matches and terminates the worker after success', async () => {
    const result = matchMetricNames('cpu.*', ['cpu_total', 'memory'], 20)
    expect(FakeWorker.workers[0]!.postMessage).toHaveBeenCalledWith({ pattern: 'cpu.*', names: ['cpu_total', 'memory'], limit: 20 })
    FakeWorker.workers[0]!.complete(['cpu_total'])
    await expect(result).resolves.toEqual(['cpu_total'])
    expect(FakeWorker.workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('terminates a stuck regex and rejects within the time budget', async () => {
    const result = matchMetricNames('^(a+)+$', ['a'.repeat(30) + 'b'], 20)
    const rejected = expect(result).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    expect(FakeWorker.workers[0]!.terminate).toHaveBeenCalledOnce()
  })

  it('runs at most two workers and cancels queued and active jobs', async () => {
    const active = new AbortController(), queued = new AbortController()
    const a = matchMetricNames('a', ['a'], 20, active.signal)
    const b = matchMetricNames('b', ['b'], 20)
    const c = matchMetricNames('c', ['c'], 20, queued.signal)
    const aRejected = expect(a).rejects.toMatchObject({ name: 'AbortError' })
    const cRejected = expect(c).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.workers).toHaveLength(2)
    queued.abort(); active.abort()
    await Promise.all([aRejected, cRejected])
    FakeWorker.workers[1]!.complete(['b'])
    await b
    expect(FakeWorker.workers).toHaveLength(2)
    expect(FakeWorker.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
  })

  it('releases capacity after a worker error', async () => {
    const a = matchMetricNames('a', ['a'], 20)
    const b = matchMetricNames('b', ['b'], 20)
    const c = matchMetricNames('c', ['c'], 20)
    const rejected = expect(a).rejects.toThrow('unavailable')
    FakeWorker.workers[0]!.onerror?.({ preventDefault() {} } as ErrorEvent)
    await rejected
    await Promise.resolve()
    expect(FakeWorker.workers).toHaveLength(3)
    FakeWorker.workers[1]!.complete(['b']); FakeWorker.workers[2]!.complete(['c'])
    await Promise.all([b, c])
  })
})
