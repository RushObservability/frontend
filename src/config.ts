// Runtime configuration injected by nginx at container start via /runtime-config.js
// (see nginx.conf / frontend-nginx-configmap.yaml). Values are substituted from
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

const runtime = (window as unknown as { __RUSH_CONFIG__?: RushRuntimeConfig }).__RUSH_CONFIG__

/** Public base URL of the Rush API (scheme + host, no trailing slash).
 *  Priority: runtime config (deploy-time env) → VITE build var → current origin. */
export function apiBaseUrl(): string {
  const url =
    runtime?.apiBaseUrl ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    window.location.origin
  return url.replace(/\/+$/, '') // trim trailing slashes
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
