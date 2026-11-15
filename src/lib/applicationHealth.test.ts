import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installApplicationHealth, vueErrorStage } from './applicationHealth'
import { flushOperationalMetrics, setOperationalMetricSink } from './operationalTelemetry'
import { sanitizeRumEvent } from './rumPrivacy'

const sink = vi.fn()
beforeEach(() => { setOperationalMetricSink(sink); flushOperationalMetrics(); sink.mockClear() })
afterEach(() => { flushOperationalMetrics(); setOperationalMetricSink(null); vi.unstubAllGlobals() })
function fixture() {
  const app = createApp({})
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/dashboards/:id', name: 'dashboard', component: {} },
    { path: '/broken', name: 'broken', component: () => Promise.reject(new Error('Failed to fetch dynamically imported module: private-secret')) },
  ] })
  const health = installApplicationHealth(app, router)
  return { app, router, health }
}
describe('application health instrumentation', () => {
  it('classifies production Vue error codes without exporting the documentation URL', () => {
    expect(vueErrorStage('https://vuejs.org/error-reference/#runtime-1')).toBe('render')
    expect(vueErrorStage('https://vuejs.org/error-reference/#runtime-3')).toBe('watcher')
  })
  it('measures initial and duplicate navigation using route names without IDs', async () => {
    const { router } = fixture()
    await router.push('/dashboards/private-secret')
    await router.push('/dashboards/private-secret')
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_navigation', expect.objectContaining({ route: 'dashboard', outcome: 'success', duration_count: 1 }))
    expect(sink).toHaveBeenCalledWith('frontend_navigation', expect.objectContaining({ outcome: 'duplicated' }))
    expect(JSON.stringify(sink.mock.calls)).not.toContain('private-secret')
  })
  it('records a failed lazy route without its exception text', async () => {
    const { router } = fixture()
    await expect(router.push('/broken')).rejects.toThrow()
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_exception', expect.objectContaining({ source: 'router', stage: 'lazy_chunk' }))
    expect(sink).toHaveBeenCalledWith('frontend_navigation', expect.objectContaining({ route: 'broken', outcome: 'failed' }))
    expect(JSON.stringify(sink.mock.calls)).not.toContain('private-secret')
  })
  it('deduplicates Vue/bootstrap reports and preserves metrics through privacy sanitization', () => {
    const { app, health } = fixture()
    const error = new Error('private-secret')
    app.config.errorHandler!(error, null, 'render function')
    health.bootstrapFailed(error)
    flushOperationalMetrics()
    const exceptions = sink.mock.calls.filter(([name]) => name === 'frontend_exception')
    expect(exceptions).toHaveLength(1)
    const [name, attributes] = exceptions[0]!
    const event = { event_type: 'custom', event_name: name, attributes: JSON.stringify(attributes) }
    expect(sanitizeRumEvent(event, '/settings')).toEqual(event)
    expect(attributes).toMatchObject({ source: 'vue', stage: 'render', count: 1 })
  })
  it('stops early global error capture when SDK hooks take over', () => {
    const browser = new EventTarget(); vi.stubGlobal('window', browser)
    const { health } = fixture()
    browser.dispatchEvent(Object.assign(new Event('error'), { error: new Error('first') }))
    health.rumReady()
    browser.dispatchEvent(Object.assign(new Event('error'), { error: new Error('second') }))
    flushOperationalMetrics()
    expect(sink).toHaveBeenCalledWith('frontend_exception', expect.objectContaining({ source: 'bootstrap', count: 1 }))
  })
})
