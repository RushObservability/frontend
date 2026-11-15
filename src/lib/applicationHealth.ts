import type { App } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'
import { recordOperationalMetric } from './operationalTelemetry'

const errors = new WeakSet<object>()
const instrumentedRouters = new WeakSet<Router>()
function exception(error: unknown, source: string, stage: string) {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    if (errors.has(error)) return
    errors.add(error)
  }
  recordOperationalMetric('frontend_exception', { source, stage })
}

export function vueErrorStage(info: string): string {
  const code = info.match(/#runtime-(\d+)$/)?.[1]
  if (code === '0' || /setup/.test(info)) return 'setup'
  if (code === '1' || /render/.test(info)) return 'render'
  if (['2', '3', '4'].includes(code || '') || /watch/.test(info)) return 'watcher'
  if (['5', '6'].includes(code || '') || /event/.test(info)) return 'event'
  return 'other'
}

/** Called before authentication guards so their latency and failures are included. */
export function installRouterHealth(router: Router, now = () => performance.now()) {
  if (instrumentedRouters.has(router)) return
  instrumentedRouters.add(router)
  const started = new WeakMap<object, number>()
  const finished = new WeakSet<object>()
  const routeNames = new Set(router.getRoutes().map(route => route.name).filter((name): name is string => typeof name === 'string' && /^[a-zA-Z0-9_.:-]{1,64}$/.test(name)))
  const routeName = (route: RouteLocationNormalized) => typeof route.name === 'string' && routeNames.has(route.name) ? route.name : 'other'
  function navigation(to: RouteLocationNormalized, outcome: string) {
    if (finished.has(to)) return
    finished.add(to)
    const start = started.get(to)
    recordOperationalMetric('frontend_navigation', { route: routeName(to), outcome }, start === undefined ? undefined : Math.max(0, now() - start))
  }
  router.beforeEach(to => { started.set(to, now()) })
  router.afterEach((to, _from, failure) => navigation(to, failure ? failure.type === 16 ? 'duplicated' : 'cancelled' : to.redirectedFrom ? 'redirected' : 'success'))
  router.onError((error, to) => {
    const message = error instanceof Error ? error.message : ''
    exception(error, 'router', /chunk|dynamically imported|module script/i.test(message) ? 'lazy_chunk' : 'other')
    navigation(to, 'failed')
  })
}

/** Register before app.use(router) and mount so early framework failures are measured. */
export function installApplicationHealth(app: App, router: Router) {
  installRouterHealth(router)
  const previousHandler = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    const stage = vueErrorStage(info)
    exception(error, 'vue', stage)
    previousHandler?.(error, instance, info)
  }
  const onEarlyError = (event: ErrorEvent) => exception(event.error, 'bootstrap', 'other')
  const onEarlyRejection = (event: PromiseRejectionEvent) => exception(event.reason, 'bootstrap', 'other')
  if (typeof window !== 'undefined') {
    window.addEventListener('error', onEarlyError)
    window.addEventListener('unhandledrejection', onEarlyRejection)
  }
  return {
    bootstrapFailed: (error: unknown) => exception(error, 'bootstrap', 'mount'),
    // Browser-global errors after this point are owned by the SDK's default hooks.
    rumReady() {
      if (typeof window === 'undefined') return
      window.removeEventListener('error', onEarlyError)
      window.removeEventListener('unhandledrejection', onEarlyRejection)
    },
  }
}
