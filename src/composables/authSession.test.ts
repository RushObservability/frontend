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

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
  })

  it('preserves an explicit credential policy for non-browser callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authenticatedFetch('/api/v1/ingest', { credentials: 'include', cache: 'reload' })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ingest', {
      credentials: 'include',
      cache: 'reload',
    })
  })
})
