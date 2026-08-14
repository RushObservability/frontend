import type { LocationQuery } from 'vue-router'

/**
 * Read a one-time SSO setup token exclusively from a URL fragment.
 * Fragments are not included in browser HTTP requests, proxy logs, or Referer
 * headers. Requiring the leading `#` also prevents callers from accidentally
 * passing a query string to this credential parser.
 */
export function setupTokenFromFragment(hash: string): string {
  if (!hash.startsWith('#')) return ''
  return new URLSearchParams(hash.slice(1)).get('token') || ''
}

/** Return a query object without mutating the router's current query state. */
export function withoutQueryParameter(query: LocationQuery, parameter: string): LocationQuery {
  const next = { ...query }
  delete next[parameter]
  return next
}
