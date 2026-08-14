import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authenticatedFetch,
  markSessionActive,
  onSessionExpired,
} from './authSession'

describe('authenticatedFetch', () => {
  beforeEach(() => markSessionActive())
  afterEach(() => vi.unstubAllGlobals())

  it('reports one session expiration for a burst of unauthorized requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    const listener = vi.fn()
    const stop = onSessionExpired(listener)

    await Promise.all([
      authenticatedFetch('/api/v1/dashboards'),
      authenticatedFetch('/api/v1/features'),
    ])

    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not expire the current session for an expected login failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    const listener = vi.fn()
    const stop = onSessionExpired(listener)

    await authenticatedFetch('/api/v1/auth/login', {}, { ignoreUnauthorized: true })

    expect(listener).not.toHaveBeenCalled()
    stop()
  })

  it('defaults browser API requests to same-origin credentials and no-store', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authenticatedFetch('/api/v1/auth/me')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }))
  })

  it('preserves an explicit credential policy for non-browser callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authenticatedFetch('/api/v1/ingest', { credentials: 'include', cache: 'reload' })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ingest', expect.objectContaining({
      credentials: 'include',
      cache: 'reload',
      signal: expect.any(AbortSignal),
    }))
  })

  it('retries transient idempotent failures but never retries a POST', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authenticatedFetch('/api/v1/services', {}, { retryDelayMs: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await authenticatedFetch('/api/v1/services', { method: 'POST' }, { retryDelayMs: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels an older keyed request when a newer request supersedes it', async () => {
    const firstSignal: { value?: AbortSignal } = {}
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo, init?: RequestInit) => {
        firstSignal.value = init?.signal ?? undefined
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          void resolve
        })
      })
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = authenticatedFetch('/api/v1/services', {}, { requestKey: 'services', retries: 0 })
    await authenticatedFetch('/api/v1/services', {}, { requestKey: 'services', retries: 0 })
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(firstSignal.value?.aborted).toBe(true)
  })
})
