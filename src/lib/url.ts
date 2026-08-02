import type { LocationQuery } from 'vue-router'

/** Return a query object without mutating the router's current query state. */
export function withoutQueryParameter(query: LocationQuery, parameter: string): LocationQuery {
  const next = { ...query }
  delete next[parameter]
  return next
}

