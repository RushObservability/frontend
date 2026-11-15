import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from './useApi'
import { flushOperationalMetrics, setOperationalMetricSink } from '../lib/operationalTelemetry'
import { sanitizeRumEvent } from '../lib/rumPrivacy'

const sink = vi.fn()
beforeEach(() => { setOperationalMetricSink(sink); flushOperationalMetrics(); sink.mockClear() })
afterEach(() => { flushOperationalMetrics(); setOperationalMetricSink(null); vi.unstubAllGlobals() })

describe('logical API health', () => {
  it('records attempts/retries separately and finishes only after the body is decoded', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(body))
    vi.stubGlobal('fetch', fetchMock)
    let finished = false
    const pending = apiRequest('/services?tenant=private-secret').then(value => { finished = true; return value })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(finished).toBe(false)
    controller.enqueue(new TextEncoder().encode('{"services":[]}')); controller.close()
    await expect(pending).resolves.toEqual({ services: [] })
    flushOperationalMetrics()
    expect(sink.mock.calls.filter(([name]) => name === 'frontend_api_request')).toHaveLength(1)
    expect(sink).toHaveBeenCalledWith('frontend_api_retry', expect.objectContaining({ operation: 'services', outcome: 'http_error', count: 1 }))
    expect(sink).toHaveBeenCalledWith('frontend_api_body', expect.objectContaining({ outcome: 'completed', duration_count: 1 }))
    for (const [name, attributes] of sink.mock.calls) {
      const event = { event_type: 'custom', event_name: name, attributes: JSON.stringify(attributes) }
      expect(sanitizeRumEvent(event, '/services')).toEqual(event)
      expect(JSON.stringify(attributes)).not.toContain('private-secret')
    }
  })
  it('records a decode failure even when the server returns HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>private-secret</html>')))
    await expect(apiRequest('/services')).rejects.toBeInstanceOf(SyntaxError)
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_api_request', expect.objectContaining({ outcome: 'decode_error', status_class: '2xx' }))
    expect(JSON.stringify(sink.mock.calls)).not.toContain('private-secret')
  })
  it('does not call a stream read failure a successful logical request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-secret')) } }))))
    await expect(apiRequest('/services')).rejects.toThrow('private-secret')
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_api_request', expect.objectContaining({ outcome: 'body_error' }))
    expect(sink).toHaveBeenCalledWith('frontend_api_body', expect.objectContaining({ outcome: 'stream_error' }))
  })
})
