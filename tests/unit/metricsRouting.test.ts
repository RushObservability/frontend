import { describe, expect, it } from 'vitest'
import config from '../../vite.config'
import nginx from '../../nginx/nginx.conf?raw'

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
})
