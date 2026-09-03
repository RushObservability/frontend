// Runtime configuration injected by nginx at container start via /runtime-config.js
// (see nginx/nginx.conf / frontend-nginx-configmap.yaml). Values are substituted from
// container env vars at deploy time, so the same prebuilt image can point at a
// different public host without a rebuild. In local dev (Vite) the file is served
// empty, so everything falls back to a VITE_ build var or the current origin.
interface RushRuntimeConfig {
  /** Public base URL (scheme + host, no trailing slash) of the Rush API as seen
   *  from outside the cluster. Used wherever the UI needs to show or reach the API
   *  by its public address — e.g. the CloudWatch ingest endpoint that AWS Firehose
   *  must POST to. May differ from where admins load the UI. */
  apiBaseUrl?: string
  /** Default color theme ('light' | 'dark') for first-time visitors who have no
   *  saved preference. Set via the DEFAULT_THEME deploy env var. */
  defaultTheme?: string
}

const browserWindow = typeof window === 'undefined' ? undefined : window
const runtime = (browserWindow as unknown as { __RUSH_CONFIG__?: RushRuntimeConfig } | undefined)
  ?.__RUSH_CONFIG__

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1'
}

/** Validate and canonicalize an API URL to an exact browser origin. */
export function normalizeApiOrigin(raw: string, uiOrigin: string, production: boolean): string {
  let parsed: URL
  try {
    parsed = new URL(raw || uiOrigin)
  } catch {
    throw new Error('Rush API URL must be a valid absolute origin')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Rush API URL must use HTTP or HTTPS')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Rush API URL must be an origin without credentials, path, query, or fragment')
  }
  const ui = new URL(uiOrigin)
  const isLoopbackHttp = parsed.protocol === 'http:'
    && ui.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname)
    && isLoopbackHostname(ui.hostname)
  if (production && !isLoopbackHttp && (parsed.protocol !== 'https:' || ui.protocol !== parsed.protocol)) {
    throw new Error('Rush API URL must use the frontend HTTPS scheme in production')
  }
  return parsed.origin
}

/** Public base URL of the Rush API (scheme + host, no trailing slash).
 *  Priority: runtime config (deploy-time env) → VITE build var → current origin. */
export function apiBaseUrl(): string {
  const url =
    runtime?.apiBaseUrl ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    browserWindow?.location.origin ||
    'http://localhost'
  return normalizeApiOrigin(
    url,
    browserWindow?.location.origin || url,
    import.meta.env.PROD,
  )
}

/** Default color theme for first-time visitors with no saved preference.
 *  Priority: runtime config (deploy-time DEFAULT_THEME env) → VITE build var →
 *  'light'. Only an explicit 'dark' selects dark; anything else falls back to light. */
export function defaultTheme(): 'light' | 'dark' {
  const t = (
    runtime?.defaultTheme ||
    (import.meta.env.VITE_DEFAULT_THEME as string | undefined) ||
    ''
  ).toLowerCase()
  return t === 'dark' ? 'dark' : 'light'
}
