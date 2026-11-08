import { test, expect, type Page } from '@playwright/test'
import { queryUrl, queryBody, queryReply } from './query-contract'

async function stub(page: Page) {
  const state = { failSeries: false, failGraph: false, intervals: [] as string[] }
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { services: [], nodes: [], edges: [], deploys: [], monitors: [], slos: [], rules: [], endpoints: [], groups: [], funnels: [], views: [], values: [], suggestions: ['payments'] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'service-reader', username: 'reader', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/suggest/service_name') body = ['payments']
    if (path === '/api/v1/services/graph') {
      if (state.failGraph) { await route.fulfill({ status: 503, body: 'unavailable' }); return }
      body = { nodes: [{ service_name: 'payments', request_count: 120, error_count: 6 }], edges: [] }
    }
    if (path === '/api/v1/query/timeseries') {
      const request = queryBody(route.request())
      state.intervals.push(request.interval)
      // Mirror the server whitelist, rather than accepting every client token.
      if (state.failSeries || !['1s', '10s', '1m', '5m', '15m', '1h', '1d'].includes(request.interval)) {
        await route.fulfill({ status: state.failSeries ? 503 : 400, body: 'unavailable' }); return
      }
      body = { buckets: [{ bucket: request.time_range.from, count: 120, error_count: 6, avg_duration_ms: 50, p50_ms: 40, p95_ms: 80, p99_ms: 100 }] }
    }
    if (path === '/api/v1/services/latency-histogram') body = { buckets: [], total: 120, p50_ms: 40, p95_ms: 80, p99_ms: 100 }
    if (path === '/api/v1/services/time-breakdown/timeseries') body = { buckets: [], databases: [], interval: '1m', bucket_secs: 60 }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })
  return state
}

for (const [minutes, interval] of [[15, '1m'], [60, '1m'], [180, '5m'], [1440, '15m'], [10080, '1h']] as const) {
  test(`service overview loads a supported interval for ${minutes}m`, async ({ page }) => {
    const state = await stub(page)
    await page.goto(`/services/payments?t=${minutes}`)
    await expect(page.locator('.svc-stats-row')).toContainText('120')
    await expect(page.locator('.health-badge')).toHaveText('degraded')
    await expect(page.getByText('No service traffic was observed in this window.')).toHaveCount(0)
    expect(state.intervals.length).toBeGreaterThan(0)
    expect(state.intervals.every(value => value === interval)).toBe(true)
  })
}

test('a service query failure is unavailable, not zero traffic, and retry recovers', async ({ page }) => {
  const state = await stub(page)
  state.failSeries = true
  await page.goto('/services/payments?t=60')
  await expect(page.locator('.health-badge')).toHaveText('unavailable')
  await expect(page.locator('.svc-panel > [role="alert"]')).toContainText('Request and latency data could not be loaded')
  await expect(page.locator('.svc-stats-row')).toHaveCount(0)
  await expect(page.getByText('No service traffic was observed in this window.')).toHaveCount(0)
  state.failSeries = false
  await page.getByRole('button', { name: 'Retry service data' }).click()
  await expect(page.locator('.svc-stats-row')).toContainText('120')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a failed service map does not discard successful request data', async ({ page }) => {
  const state = await stub(page)
  state.failGraph = true
  await page.goto('/services/payments?t=60')
  await expect(page.locator('.svc-stats-row')).toContainText('120')
  await expect(page.getByRole('alert')).toContainText('service map could not be loaded')
  await expect(page.locator('.health-badge')).toHaveText('degraded')
})
