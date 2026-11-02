import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedFetch, advanceSessionGeneration } from '../../src/composables/authSession'

describe('authenticated response body lifecycle with real HTTP streams', () => {
  let server: Server, origin: string, closed: number
  beforeEach(async () => {
    closed = 0
    server = createServer((req, res) => {
      let timer: ReturnType<typeof setTimeout>
      res.on('close', () => { closed++; clearTimeout(timer) })
      if (req.url === '/late-headers') {
        timer = setTimeout(() => res.end('late'), 1000)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Probe': 'preserved' })
      res.write('first')
      timer = setTimeout(() => res.end('last'), req.url === '/short' ? 20 : 400)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    origin = `http://127.0.0.1:${address.port}`
  })
  afterEach(async () => {
    advanceSessionGeneration()
    vi.restoreAllMocks()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('caller cancellation after headers rejects body reads and closes HTTP', async () => {
    const controller = new AbortController()
    const response = await authenticatedFetch(`${origin}/stream`, { signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(closed).toBe(1))
  })

  it('session replacement cancels an already-open response body', async () => {
    const response = await authenticatedFetch(`${origin}/stream`)
    const reader = response.body!.getReader()
    await reader.read()
    advanceSessionGeneration()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(closed).toBe(1))
  })

  it('keyed supersession owns the body as well as the header request', async () => {
    const response = await authenticatedFetch(`${origin}/stream`, {}, { requestKey: 'body-key' })
    const reader = response.body!.getReader()
    await reader.read()
    const next = await authenticatedFetch(`${origin}/stream`, {}, { requestKey: 'body-key' })
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    await next.body!.cancel()
    await vi.waitFor(() => expect(closed).toBe(2))
  })

  it('releases a completed key and preserves response metadata and clones', async () => {
    const nativeFetch = globalThis.fetch
    const signals: AbortSignal[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      signals.push(init!.signal!)
      return nativeFetch(input, init)
    })
    const response = await authenticatedFetch(`${origin}/short`, {}, { requestKey: 'completed' })
    expect(response.url).toBe(`${origin}/short`)
    expect(response.headers.get('X-Probe')).toBe('preserved')
    const clone = response.clone()
    expect(clone.url).toBe(response.url)
    expect(await Promise.all([response.text(), clone.text()])).toEqual(['firstlast', 'firstlast'])
    const next = await authenticatedFetch(`${origin}/stream`, {}, { requestKey: 'completed' })
    expect(signals[0]!.aborted).toBe(false)
    await next.body!.cancel()
  })

  it('keeps the header deadline separate from long-running body consumption', async () => {
    const response = await authenticatedFetch(`${origin}/stream`, {}, { timeoutMs: 200, retries: 0 })
    await expect(response.text()).resolves.toBe('firstlast')
    await expect(authenticatedFetch(`${origin}/late-headers`, {}, { timeoutMs: 30, retries: 0 })).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
