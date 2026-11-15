interface RuntimeRumConfig { enabled?: unknown; endpoint?: unknown; appName?: unknown; environment?: unknown }
interface BuildRumConfig { VITE_RUM_ENABLED?: string; VITE_RUM_ENDPOINT?: string; VITE_RUM_APP_NAME?: string; VITE_RUM_APP_VERSION?: string; VITE_RUM_BUILD_VERSION?: string; VITE_RUM_ENVIRONMENT?: string; MODE?: string }

/** RUM accepts public metadata only. An invalid deployment config disables collection. */
export function readRumConfiguration(
  runtime: RuntimeRumConfig | undefined = (globalThis as typeof globalThis & { window?: { __RUSH_CONFIG__?: { rum?: RuntimeRumConfig } } }).window?.__RUSH_CONFIG__?.rum,
  build: BuildRumConfig = import.meta.env,
) {
  const endpoint = runtime?.endpoint ?? build.VITE_RUM_ENDPOINT ?? '/api/v1/rum/ingest'
  const appName = runtime?.appName ?? build.VITE_RUM_APP_NAME ?? 'rush-ui'
  const environment = runtime?.environment ?? build.VITE_RUM_ENVIRONMENT ?? build.MODE ?? 'production'
  const validPath = typeof endpoint === 'string' && /^\/(?!\/)[A-Za-z0-9_./-]*$/.test(endpoint)
    && !endpoint.split('/').some(segment => segment === '.' || segment === '..')
  const safeName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
  return {
    enabled: (runtime?.enabled === undefined ? build.VITE_RUM_ENABLED === 'true' : runtime.enabled === true)
      && validPath && safeName(appName) && safeName(environment),
    endpoint: validPath ? endpoint : '/api/v1/rum/ingest',
    appName: safeName(appName) ? appName : 'rush-ui',
    appVersion: build.VITE_RUM_APP_VERSION || build.VITE_RUM_BUILD_VERSION || 'unknown',
    environment: safeName(environment) ? environment : 'production',
  }
}
