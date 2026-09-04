import { describe, expect, it, vi } from 'vitest'
import {
  AnalyticsRequestCoordinator,
  analyticsRequestCoordinator,
  analyticsSupersessionKey,
  canonicalizeRequestBody,
  flushAnalyticsRequestMetrics,
  invalidateAnalyticsRequests,
  isIdempotentAnalyticsPost,
  semanticRequestKey,
  setAnalyticsRequestMetricSink,
  type AnalyticsRequestMetric,
  type AnalyticsRequestScope,
} from './analyticsRequestCache'

function scope(overrides: Partial<AnalyticsRequestScope> = {}): AnalyticsRequestScope {
  return {
    userId: 'user-1',
    tenant: 'default',
    method: 'POST',
    route: '/explore/search',
    body: JSON.stringify({ search: 'POST', filters: [{ field: 'service_name', value: 'gateway' }] }),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('analytics request coordinator', () => {
  it('canonicalizes object property order without changing array order', () => {
    expect(canonicalizeRequestBody('{"z":1,"a":{"d":4,"b":2},"list":[3,1]}'))
      .toBe('{"a":{"b":2,"d":4},"list":[3,1],"z":1}')
    expect(semanticRequestKey(scope({ body: '{"b":2,"a":1}' })))
      .toBe(semanticRequestKey(scope({ body: '{"a":1,"b":2}' })))
  })

  it('uses separate supersession lanes for Explore rows and summaries', () => {
    const rows = JSON.stringify({ include_rows: true, include_summary: false })
    const summary = JSON.stringify({ include_rows: false, include_summary: true })
    const combined = JSON.stringify({})

    expect(analyticsSupersessionKey('/explore/search', 'POST', rows)).toBe('POST:/explore/search:rows')
    expect(analyticsSupersessionKey('/explore/search', 'POST', summary)).toBe('POST:/explore/search:summary')
    expect(analyticsSupersessionKey('/explore/search', 'POST', combined)).toBe('POST:/explore/search:combined')
    expect(analyticsSupersessionKey('/query', 'POST', rows)).toBe('POST:/query')
  })

  it('runs Explore rows and summaries concurrently without cancellation', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const rowsResponse = deferred<string>()
    const summaryResponse = deferred<string>()
    const rowsBody = JSON.stringify({ include_rows: true, include_summary: false })
    const summaryBody = JSON.stringify({ include_rows: false, include_summary: true })

    const rows = coordinator.run(
      scope({ body: rowsBody }),
      () => rowsResponse.promise,
      { supersedeKey: analyticsSupersessionKey('/explore/search', 'POST', rowsBody) },
    )
    const summary = coordinator.run(
      scope({ body: summaryBody }),
      () => summaryResponse.promise,
      { supersedeKey: analyticsSupersessionKey('/explore/search', 'POST', summaryBody) },
    )

    rowsResponse.resolve('{"rows":[]}')
    summaryResponse.resolve('{"summary":{"histogram":[]}}')
    await expect(rows).resolves.toContain('rows')
    await expect(summary).resolves.toContain('histogram')
  })

  it('reduces fifty identical simultaneous POST queries to one transport call', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const execute = vi.fn(async () => '{"rows":[]}')
    const requests = Array.from({ length: 50 }, () => coordinator.run(scope(), execute))
    await expect(Promise.all(requests)).resolves.toHaveLength(50)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('isolates identical queries by tenant and user', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const execute = vi.fn(async () => '{}')
    await coordinator.run(scope({ tenant: 'tenant-a' }), execute, { ttlMs: 1_000 })
    await coordinator.run(scope({ tenant: 'tenant-b' }), execute, { ttlMs: 1_000 })
    await coordinator.run(scope({ tenant: 'tenant-a', userId: 'user-2' }), execute, { ttlMs: 1_000 })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('clears only the affected user cache on logout', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const execute = vi.fn(async () => '{}')
    await coordinator.run(scope({ userId: 'user-1' }), execute, { ttlMs: 1_000 })
    await coordinator.run(scope({ userId: 'user-2' }), execute, { ttlMs: 1_000 })
    coordinator.invalidate({ userId: 'user-1' })
    await coordinator.run(scope({ userId: 'user-1' }), execute, { ttlMs: 1_000 })
    await coordinator.run(scope({ userId: 'user-2' }), execute, { ttlMs: 1_000 })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('aborts affected in-flight work when logout clears request state', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    let transportSignal: AbortSignal | undefined
    const pending = coordinator.run(scope(), signal => {
      transportSignal = signal
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    coordinator.invalidate({ userId: 'user-1' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(transportSignal?.aborted).toBe(true)
    expect(coordinator.stats().inFlight).toBe(0)
  })

  it('invalidates cached analytics after a tenant mutation', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const execute = vi.fn(async () => '{}')
    await coordinator.run(scope(), execute, { ttlMs: 1_000 })
    await coordinator.run(scope(), execute, { ttlMs: 1_000 })
    expect(execute).toHaveBeenCalledTimes(1)
    coordinator.invalidate({ userId: 'user-1', tenant: 'default' })
    await coordinator.run(scope(), execute, { ttlMs: 1_000 })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('rejects a superseded search even when the old transport ignores abort', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const oldResponse = deferred<string>()
    const newResponse = deferred<string>()
    const first = coordinator.run(
      scope({ body: '{"search":"old"}' }),
      () => oldResponse.promise,
      { supersedeKey: 'explore' },
    )
    const second = coordinator.run(
      scope({ body: '{"search":"new"}' }),
      () => newResponse.promise,
      { supersedeKey: 'explore' },
    )

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    newResponse.resolve('{"rows":["new"]}')
    await expect(second).resolves.toContain('new')
    oldResponse.resolve('{"rows":["old"]}')
    await Promise.resolve()
  })

  it('keeps a shared transport alive while another identical subscriber remains', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const response = deferred<string>()
    let transportSignal: AbortSignal | undefined
    const execute = vi.fn((signal: AbortSignal) => {
      transportSignal = signal
      return response.promise
    })
    const caller = new AbortController()
    const first = coordinator.run(scope(), execute, { signal: caller.signal })
    const second = coordinator.run(scope(), execute)
    caller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(transportSignal?.aborted).toBe(false)
    response.resolve('{}')
    await expect(second).resolves.toBe('{}')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('allows independent query bodies to run concurrently without a supersession group', async () => {
    const coordinator = new AnalyticsRequestCoordinator()
    const firstResponse = deferred<string>()
    const secondResponse = deferred<string>()
    const first = coordinator.run(scope({ body: '{"search":"first"}' }), () => firstResponse.promise)
    const second = coordinator.run(scope({ body: '{"search":"second"}' }), () => secondResponse.promise)

    secondResponse.resolve('{"rows":["second"]}')
    firstResponse.resolve('{"rows":["first"]}')

    await expect(first).resolves.toContain('first')
    await expect(second).resolves.toContain('second')
  })

  it('returns stale dashboard data while one bounded background refresh runs', async () => {
    let now = 0
    const coordinator = new AnalyticsRequestCoordinator({ now: () => now })
    const execute = vi.fn()
      .mockResolvedValueOnce('{"value":1}')
      .mockResolvedValueOnce('{"value":2}')
    await expect(coordinator.run(scope(), execute, { ttlMs: 10, staleMs: 20 })).resolves.toContain('1')
    now = 15
    await expect(coordinator.run(scope(), execute, { ttlMs: 10, staleMs: 20 })).resolves.toContain('1')
    await Promise.resolve()
    now = 16
    await expect(coordinator.run(scope(), execute, { ttlMs: 10, staleMs: 20 })).resolves.toContain('2')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('bounds cache entries and emits low-cardinality outcome metrics', async () => {
    const metrics: AnalyticsRequestMetric[] = []
    const coordinator = new AnalyticsRequestCoordinator({
      maxEntries: 2,
      maxBytes: 1_000,
      metric: metric => metrics.push(metric),
    })
    const execute = vi.fn(async () => '{"ok":true}')
    for (const search of ['one', 'two', 'three']) {
      await coordinator.run(scope({ body: JSON.stringify({ search }) }), execute, { ttlMs: 1_000 })
    }
    await coordinator.run(scope({ body: '{"search":"three"}' }), execute, { ttlMs: 1_000 })
    expect(coordinator.stats().entries).toBe(2)
    expect(coordinator.stats().bytes).toBeLessThanOrEqual(1_000)
    expect(metrics).toContain('eviction')
    expect(metrics).toContain('hit')
  })

  it('classifies query POSTs without treating mutations as cacheable', () => {
    for (const route of [
      '/query', '/query/count', '/query/timeseries', '/query/group', '/explore/search', '/logs',
      '/logs/context', '/rum/vitals', '/monitors/preview', '/funnels/abc/run',
      '/detection/rules/abc/test', '/anomaly-events/abc/analyze',
    ]) expect(isIdempotentAnalyticsPost(route, 'POST')).toBe(true)
    for (const route of ['/dashboards', '/monitors', '/settings/query-limits', '/auth/logout']) {
      expect(isIdempotentAnalyticsPost(route, 'POST')).toBe(false)
    }
  })

  it('flushes only bounded aggregate counters to the RUM sink', async () => {
    invalidateAnalyticsRequests()
    const sink = vi.fn()
    setAnalyticsRequestMetricSink(sink)
    await analyticsRequestCoordinator.run(scope(), async () => '{}', { ttlMs: 1_000 })
    await analyticsRequestCoordinator.run(scope(), async () => '{}', { ttlMs: 1_000 })
    flushAnalyticsRequestMetrics()
    setAnalyticsRequestMetricSink(null)
    invalidateAnalyticsRequests()

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ hit: 1, miss: 1 }))
    expect(Object.keys(sink.mock.calls[0]![0])).toEqual(['hit', 'dedup', 'cancel', 'miss', 'eviction'])
  })
})
