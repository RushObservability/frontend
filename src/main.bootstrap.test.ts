import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  app: { config: {}, use: vi.fn(), mount: vi.fn() },
  sdk: { init: vi.fn(), trackEvent: vi.fn(), flush: vi.fn() },
  sdkLoad: Promise.resolve(),
  releaseSdk: () => {},
  bootstrap: undefined as (() => void) | undefined,
}))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), createApp: () => fixture.app }))
vi.mock('./App.vue', () => ({ default: {} }))
vi.mock('./router', () => ({ default: { getRoutes: () => [], beforeEach: vi.fn(), afterEach: vi.fn(), onError: vi.fn() } }))
vi.mock('@rushobservability/rum-sdk', async () => {
  await fixture.sdkLoad
  return { RushRUM: fixture.sdk }
})

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  fixture.app.config = {}
  fixture.bootstrap = undefined
  fixture.sdkLoad = new Promise<void>(resolve => { fixture.releaseSdk = resolve })
  vi.stubGlobal('queueMicrotask', (callback: () => void) => { fixture.bootstrap = callback })
  vi.stubGlobal('window', new EventTarget())
  vi.stubEnv('VITE_RUM_ENABLED', 'true')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  const metrics = await import('./lib/operationalTelemetry')
  metrics.flushOperationalMetrics(); metrics.setOperationalMetricSink(null)
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks()
})
describe('fatal bootstrap telemetry', () => {
  it.each(['plugin', 'mount'])('delivers the buffered failure when %s throws before the SDK finishes loading', async stage => {
    const error = new Error('private-bootstrap-fixture')
    if (stage === 'plugin') fixture.app.use.mockImplementation(() => { throw error })
    else {
      fixture.app.use.mockImplementation(() => {})
      fixture.app.mount.mockImplementation(() => { throw error })
    }
    await import('./main')
    expect(fixture.bootstrap).toBeTypeOf('function')
    expect(fixture.sdk.init).not.toHaveBeenCalled()
    expect(() => fixture.bootstrap!()).toThrow(error)
    fixture.releaseSdk()
    await vi.waitFor(() => expect(fixture.sdk.init).toHaveBeenCalledTimes(1))
    const metrics = await import('./lib/operationalTelemetry')
    metrics.flushOperationalMetrics()
    expect(fixture.sdk.trackEvent).toHaveBeenCalledWith('frontend_exception', { source: 'bootstrap', stage: 'mount', count: 1 })
    expect(JSON.stringify(fixture.sdk.trackEvent.mock.calls)).not.toContain('private-bootstrap-fixture')
    if (stage === 'plugin') expect(fixture.app.mount).not.toHaveBeenCalled()
  })
})
