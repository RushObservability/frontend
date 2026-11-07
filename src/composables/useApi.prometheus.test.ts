import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'
import { useTenant } from './useTenant'
import { setStorageUserId } from './storageScope'
import { invalidateAnalyticsRequests } from '../lib/analyticsRequestCache'

function pendingFetch() {
  const calls: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = []
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    calls.push({ signal, resolve })
  }))
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch, respond: (index = 0) => calls[index]!.resolve(new Response(JSON.stringify({ version: 'v1', signal: 'metrics', operation: 'range', data: { data: { resultType: 'matrix', result: [] } } }))) }
}

describe('shared Prometheus reads', () => {
  beforeEach(() => {
    invalidateAnalyticsRequests()
    setStorageUserId('prom-user')
    useTenant().activeTenant.value = 'default'
  })
  afterEach(() => { invalidateAnalyticsRequests(); setStorageUserId(null); vi.unstubAllGlobals() })

  it('shares one transport without cancelling duplicate dashboard panels', async () => {
    const pending = pendingFetch()
    const api = useApi()
    const a = api.promQueryRange('cpu', 0, 60, 15, 'dashboard')
    const b = api.promQueryRange('cpu', 0, 60, 15, 'dashboard')
    expect(pending.fetch).toHaveBeenCalledTimes(1)
    expect(pending.calls[0]!.signal.aborted).toBe(false)
    pending.respond()
    await expect(Promise.all([a, b])).resolves.toHaveLength(2)
    // Results are not retained after the shared read settles.
    const next = api.promQueryRange('cpu', 0, 60, 15, 'dashboard')
    expect(pending.fetch).toHaveBeenCalledTimes(2)
    pending.respond(1)
    await next
  })

  it('cancels only the departing subscriber until every subscriber leaves', async () => {
    const pending = pendingFetch()
    const first = new AbortController(), second = new AbortController()
    const api = useApi()
    const a = api.promQueryRange('cpu', 0, 60, 15, 'dashboard', first.signal)
    const b = api.promQueryRange('cpu', 0, 60, 15, 'dashboard', second.signal)
    first.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending.calls[0]!.signal.aborted).toBe(false)
    second.abort()
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending.calls[0]!.signal.aborted).toBe(true)
    const retry = api.promQueryRange('cpu', 0, 60, 15, 'dashboard')
    expect(pending.fetch).toHaveBeenCalledTimes(2)
    pending.respond(1)
    await retry
  })

  it('keeps different tenants and expressions independent', async () => {
    const pending = pendingFetch()
    const api = useApi()
    const controller = new AbortController()
    const a = api.promQueryRange('cpu', 0, 60, 15, undefined, controller.signal)
    const b = api.promQueryRange('memory', 0, 60, 15, undefined, controller.signal)
    useTenant().activeTenant.value = 'other'
    const c = api.promQueryRange('cpu', 0, 60, 15, undefined, controller.signal)
    expect(pending.fetch).toHaveBeenCalledTimes(3)
    expect(pending.calls.every(call => !call.signal.aborted)).toBe(true)
    for (let i = 0; i < 3; i++) pending.respond(i)
    await Promise.all([a, b, c])
  })
})
