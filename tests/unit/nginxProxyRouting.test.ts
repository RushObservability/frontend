import { describe, expect, it } from 'vitest'
import nginx from '../../nginx/nginx.conf?raw'

describe('nginx backend proxy routing', () => {
  it('keeps backend prefixes ahead of the static asset regex', () => {
    // A plain prefix location loses to a matching regex location, so
    // /api/v1/services/web.js would be served from disk instead of query-api.
    expect(nginx).toMatch(/location ~\* \\\.\(js\|css/)
    for (const prefix of ['/api/', '/auth/', '/prom/']) {
      expect(nginx).toContain(`location ^~ ${prefix} {`)
      expect(nginx).not.toContain(`location ${prefix} {`)
    }
  })

  it('forwards the raw request URI for backend prefixes', () => {
    // A URI part on proxy_pass makes nginx forward the decoded, normalized path,
    // so an encoded "/" or ".." inside one path segment reaches a different route.
    const proxyPassIn = (location: string) => {
      const start = nginx.indexOf(`location ${location} {`)
      expect(start).toBeGreaterThan(-1)
      return nginx.slice(start, nginx.indexOf('\n    }', start)).match(/proxy_pass\s+([^;]+);/)?.[1]
    }
    for (const prefix of ['/api/', '/auth/', '/prom/']) {
      expect(proxyPassIn(`^~ ${prefix}`)).toBe('http://${QUERY_API_HOST}')
    }
    // The exact match keeps its URI so query-api always receives /metrics.
    expect(proxyPassIn('= /metrics')).toBe('http://${QUERY_API_HOST}/metrics')
  })
})
