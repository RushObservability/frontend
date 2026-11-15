import { describe, expect, it } from 'vitest'
import config from '../../vite.config'
import nginx from '../../nginx/nginx.conf?raw'
import entrypoint from '../../docker-entrypoint.sh?raw'
import useApiSource from '../../src/composables/useApi.ts?raw'

describe('metrics endpoint routing', () => {
  it('proxies the exact scrape URL without intercepting the Metrics UI', () => {
    const proxies = Object.keys(config.server?.proxy || {})
    const isProxied = (url: string) => proxies.some(key => key.startsWith('^') ? new RegExp(key).test(url) : url.startsWith(key))
    expect(isProxied('/metrics')).toBe(true)
    expect(isProxied('/metrics?format=prometheus')).toBe(true)
    expect(isProxied('/metrics-browser')).toBe(false)
    expect(isProxied('/metrics-browser?q=http_requests_total&t=180')).toBe(false)
    expect(isProxied('/metrics-browser/')).toBe(false)
  })

  it('keeps nginx scrape routing exact so UI links use the SPA fallback', () => {
    expect(nginx).toContain('location = /metrics {')
    expect(nginx).not.toMatch(/location\s+\/metrics\s*\{/)
    expect(nginx).toContain('try_files $uri $uri/ /index.html;')
  })

  it('drops the unauthenticated /metrics proxy unless the image is told to keep it', () => {
    const block = nginx.match(/# BEGIN query-api metrics proxy\n([\s\S]*?)# END query-api metrics proxy/)
    expect(block?.[1]).toContain('location = /metrics {')
    expect(nginx.replace(block![0], '')).not.toMatch(/location\s*=?\s*\/metrics\b/)
    expect(entrypoint).toContain(': "${PROXY_QUERY_API_METRICS:=false}"')
    expect(entrypoint).toContain("false) METRICS_PROXY_SED='/# BEGIN query-api metrics proxy/,/# END query-api metrics proxy/d' ;;")
    expect(entrypoint).toContain('sed -e "${METRICS_PROXY_SED}"')
  })

  it('reads capacity metrics from the admin-only API route, not the scrape URL', () => {
    expect(useApiSource).toContain('authenticatedFetch(`${API_BASE}/system/metrics`')
    expect(useApiSource).not.toContain("authenticatedFetch('/metrics'")
  })
})
