import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_AVAILABILITY_PATH, createApiAvailabilityMonitor } from './apiAvailability'

describe('API availability', () => {
  let monitor: ReturnType<typeof createApiAvailabilityMonitor>
  let page: EventTarget & { visibilityState: string }
  let network: { onLine: boolean }
  let browser: EventTarget
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    browser = new EventTarget()
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    network = { onLine: true }
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', page)
    vi.stubGlobal('navigator', network)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset().mockImplementation(async () => new Response('', { status: 401 }))
    monitor = createApiAvailabilityMonitor()
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([401, 403, 429])('treats HTTP %s as reachable without sending session credentials', async status => {
    fetchMock.mockImplementation(async () => new Response('', { status }))
    monitor.start()
    await monitor.check()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(monitor.open.value).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(API_AVAILABILITY_PATH, expect.objectContaining({
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    }))
  })

  it('requires two failed probes, retries automatically, and clears on recovery', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }))
    monitor.start()
    await monitor.check()
    expect(monitor.open.value).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(monitor.open.value).toBe(true)
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(monitor.unavailable.value).toBe(false)
    expect(monitor.open.value).toBe(false)
  })

  it('does not show the modal for a transient failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network error'))
    monitor.start()
    await monitor.check()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(monitor.open.value).toBe(false)
    expect(monitor.unavailable.value).toBe(false)
  })

  it.each(['html', 'invalid JSON', 'wrong JSON'])('rejects a 200 %s fallback', async kind => {
    fetchMock.mockImplementation(async () => new Response(kind === 'wrong JSON' ? '{}' : '<html>Frontend</html>', {
      headers: { 'content-type': kind === 'html' ? 'text/html' : 'application/json' },
    }))
    monitor.start()
    await monitor.check()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(monitor.open.value).toBe(true)
  })

  it('accepts an API identity response', async () => {
    fetchMock.mockImplementation(async () => Response.json({ user: { id: 'test' } }))
    monitor.start()
    await monitor.check()
    expect(monitor.unavailable.value).toBe(false)
  })

  it('times out hung requests and aborts them', async () => {
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    monitor.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(monitor.open.value).toBe(true)
    expect(monitor.checking.value).toBe(false)
  })

  it('keeps a dismissal for one outage and shows a new outage after recovery', async () => {
    fetchMock.mockRejectedValue(new TypeError('Offline'))
    monitor.start()
    await monitor.check()
    await vi.advanceTimersByTimeAsync(2_000)
    monitor.dismiss()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(monitor.open.value).toBe(false)
    expect(monitor.unavailable.value).toBe(true)
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 401 }))
    await monitor.check()
    await vi.advanceTimersByTimeAsync(17_000)
    expect(monitor.open.value).toBe(true)
  })

  it('responds to offline/online events without fetching while offline', async () => {
    network.onLine = false
    monitor.start()
    expect(monitor.open.value).toBe(true)
    expect(monitor.offline.value).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    network.onLine = true
    browser.dispatchEvent(new Event('online'))
    await monitor.check()
    expect(monitor.open.value).toBe(false)
  })

  it('skips hidden tabs and checks on visibility restoration', async () => {
    page.visibilityState = 'hidden'
    monitor.start()
    expect(fetchMock).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    await monitor.check()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates retries and ignores late results after stopping', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise(done => { resolve = done }))
    monitor.start()
    const first = monitor.check()
    expect(monitor.check()).toBe(first)
    await vi.advanceTimersByTimeAsync(0)
    monitor.stop()
    resolve(new Response('', { status: 502 }))
    await first
    await vi.advanceTimersByTimeAsync(60_000)
    browser.dispatchEvent(new Event('online'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(monitor.checking.value).toBe(false)
    expect(monitor.open.value).toBe(false)
  })
})
