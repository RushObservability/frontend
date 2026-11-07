import { test, expect } from '@playwright/test'
import { queryUrl, queryReply } from './query-contract'

test('duplicate metric panels both render and keep refreshing', async ({ page }) => {
  await page.clock.install()
  let queries = 0
  await page.route('**/api/v1/**', async route => {
    const url = queryUrl(route.request())
    const path = url.pathname
    let body: unknown = { deploys: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/duplicates') body = {
      id: 'duplicates', name: 'Duplicate queries', visibility: 'tenant', variables: [],
      defaults: { time_range_minutes: 60, refresh_interval_secs: 30 },
      widgets: ['one', 'two'].map((id, i) => ({ id, title: id, widget_type: 'timeseries',
        query_config: { source: 'metrics', promql: 'cpu' }, display_config: {},
        position: { col: 1 + i * 6, row: 1, col_span: 6, row_span: 3 },
      })),
    }
    if (path === '/prom/api/v1/query_range') {
      queries++
      // Both panel subscriptions must be present before the shared read settles.
      await new Promise(resolve => setTimeout(resolve, 50))
      const end = Number(url.searchParams.get('end'))
      body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: { __name__: 'cpu' }, values: [[end - 60, '1'], [end, '2']] }] } }
    }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })
  await page.goto('/dashboards/duplicates')
  await expect(page.locator('.ts-legend')).toHaveCount(2)
  expect(queries).toBe(1)
  for (let refresh = 1; refresh <= 3; refresh++) {
    await page.clock.fastForward(31_000)
    await expect.poll(() => queries).toBe(refresh + 1)
    await expect(page.locator('.ts-legend')).toHaveCount(2)
  }
  await expect(page.getByText('Panel unavailable', { exact: true })).toHaveCount(0)
})
