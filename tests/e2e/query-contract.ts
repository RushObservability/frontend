import type { Request, Route } from '@playwright/test'
import registry from '../../contracts/query-v1.json' with { type: 'json' }

/** Let page fixtures describe data by operation while exercising the real v1 transport. */
export function queryUrl(request: Request): URL {
  const url = new URL(request.url())
  if (url.pathname !== registry.endpoint) return url
  const query = request.postDataJSON()
  const route = registry.routes.find(r => r.operation === query.operation
    && (r.signal === query.signal || r.signal === 'dynamic'))
  if (!route) throw new Error(`Unexpected query contract operation: ${query.operation}`)
  url.pathname = route.path
  if (query.signal === 'metrics') {
    url.searchParams.set('query', query.options.query)
    url.searchParams.set('time', String(Date.parse(query.time_range.to) / 1000))
    url.searchParams.set('start', String(Date.parse(query.time_range.from) / 1000))
    url.searchParams.set('end', String(Date.parse(query.time_range.to) / 1000))
    if (query.options.step) url.searchParams.set('step', query.options.step)
  }
  return url
}

export function queryBody(request: Request): Record<string, any> {
  const body = request.postDataJSON()
  if (new URL(request.url()).pathname !== registry.endpoint) return body
  return { time_range: body.time_range, filters: body.filters, search: body.search,
    ...body.options, ...(body.operation === 'scatter' ? { source: body.signal } : { signal: body.signal }) }
}

export function queryReply(route: Route, data: unknown): string {
  if (new URL(route.request().url()).pathname !== registry.endpoint) return JSON.stringify(data)
  const request = route.request().postDataJSON()
  return JSON.stringify({ version: 'v1', signal: request.signal, operation: request.operation, data,
    meta: { partial: false, warnings: [], time_range: request.time_range, request_id: 'browser-test', elapsed_ms: 1 } })
}
