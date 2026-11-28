import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('explore export job polling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stops polling the job once the caller aborts', async () => {
    const job = { state: 'running', status_url: '/api/v1/exports/00000000-0000-0000-0000-000000000001' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 202 }))
      .mockImplementation(async () => new Response(JSON.stringify(job), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { useApi } = await import('./useApi')
    const controller = new AbortController()

    const exported = useApi().exportExplore({
      signal: 'logs',
      time_range: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
      filters: [],
      limit: 10,
      format: 'csv',
    }, controller.signal)
    const outcome = exported.then(() => 'resolved', (error: Error) => error.name)

    await vi.advanceTimersByTimeAsync(2_000)
    const callsBeforeAbort = fetchMock.mock.calls.length
    expect(callsBeforeAbort).toBeGreaterThan(1)

    controller.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await outcome).toBe('AbortError')
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(callsBeforeAbort + 1)
  })
})
