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
})
