import { test, expect, type Page } from '@playwright/test'
import { queryUrl, queryBody, queryReply } from './query-contract'

async function stub(page: Page) {
  const requests: Array<{ filters: Array<{ value: string }>; time_range: { from: string; to: string } }> = []
  let hold = false
  let release = () => {}
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { deploys: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/scope') body = {
      id: 'scope', name: 'Request scope', visibility: 'tenant',
      defaults: { time_range_minutes: 60, refresh_interval_secs: 0 },
      variables: [{ name: 'svc', type: 'static', options: ['A', 'B'], default: 'A' }],
      widgets: [{ id: 'count', title: 'Requests $svc', widget_type: 'counter',
        query_config: { source: 'spans', filters: [{ field: 'service_name', op: '=', value: '$svc' }] },
        position: { col: 1, row: 1, col_span: 6, row_span: 3 }, display_config: {},
      }],
    }
    if (path === '/api/v1/query/count') {
      const query = queryBody(route.request())
      requests.push(query)
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      body = [{ bucket: '2026-11-01 00:00:00', count: query.filters[0].value === 'B' ? 222 : 111 }]
    }
    try { await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) }) } catch { /* superseded read */ }
  })
  return { requests, holdNext: () => { hold = true }, release: () => release() }
}

test('a variable change supersedes pending initial data and rejects a late old result', async ({ page }) => {
  const state = await stub(page)
  state.holdNext()
  await page.goto('/dashboards/scope')
  await expect.poll(() => state.requests.length).toBe(1)
  await page.locator('select.dash-var-select').selectOption('B')
  await expect(page.getByText('222', { exact: true })).toBeVisible()
  expect(state.requests.map(q => q.filters[0]!.value)).toEqual(['A', 'B'])
  state.release()
  await page.waitForTimeout(100)
  await expect(page.getByText('Requests B', { exact: true })).toBeVisible()
  await expect(page.getByText('111', { exact: true })).toHaveCount(0)
})

test('a time change is queried even while the initial widgets are pending', async ({ page }) => {
  const state = await stub(page)
  state.holdNext()
  await page.goto('/dashboards/scope')
  await expect.poll(() => state.requests.length).toBe(1)
  await page.locator('.tp-trigger').click()
  await page.getByRole('button', { name: 'Last 6h', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  const range = state.requests[1]!.time_range
  expect(Date.parse(range.to) - Date.parse(range.from)).toBe(360 * 60_000)
  state.release()
  await expect(page.getByText('111', { exact: true })).toBeVisible()
})
