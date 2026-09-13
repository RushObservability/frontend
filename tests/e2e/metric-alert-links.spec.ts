import { test, expect, type Page } from '@playwright/test'

const metric = {
  __name__: 'rush_audit_outbox_events',
  instance: 'unknown',
  service_name: 'wide-self-metrics',
}
const selector = 'rush_audit_outbox_events{instance="unknown", service_name="wide-self-metrics"}'

async function stubMetricAlertApi(page: Page, series = metric) {
  const state = { previews: [] as Record<string, any>[], saves: [] as Record<string, any>[] }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { channels: [], monitors: [], services: [], views: [], suggestions: [], values: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'test-user', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/monitors/preview') {
      state.previews.push(route.request().postDataJSON())
      body = { current_value: null, timeseries: [], series: [], simulated_events: [] }
    }
    if (path === '/api/v1/monitors' && route.request().method() === 'POST') {
      state.saves.push(route.request().postDataJSON())
      body = { id: 'test-alert' }
    }
    if (path.startsWith('/prom/api/v1/')) {
      body = { status: 'success', data: [] }
      if (path.endsWith('/query_range')) {
        const now = Math.floor(Date.now() / 1000)
        body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: series, values: [[now - 60, '1'], [now, '2']] }] } }
      }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

async function openMetricQuery(page: Page, expression: string) {
  // /metrics is also the dev proxy's scrape endpoint; reach the UI through its router.
  await page.goto('/alerts/new')
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  await page.getByPlaceholder('Enter a PromQL expression...', { exact: true }).fill(expression)
  await page.getByRole('button', { name: 'Execute', exact: true }).click()
}

test('Alert from series opens the metric alert form with the exact series selector', async ({ page }, testInfo) => {
  const state = await stubMetricAlertApi(page)
  await openMetricQuery(page, 'rush_audit_outbox_events')
  await page.locator('.metric-series-action').click()
  await expect(page).toHaveURL(/\/alerts\/new\?/)
  await expect(page.getByRole('heading', { name: 'New alert', exact: true })).toBeVisible()
  await expect(page.locator('.mf-expr-container input')).toHaveValue(selector)
  await expect(page.getByRole('button', { name: 'Visual builder', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('promql')).toBe(selector)
  await expect.poll(() => state.previews.at(-1)?.query_config?.expression).toBe(selector)
  expect(state.saves).toHaveLength(0)
  await page.reload()
  await expect(page.locator('.mf-expr-container input')).toHaveValue(selector)
  await page.screenshot({ path: testInfo.outputPath('metric-alert-form.png'), fullPage: true, animations: 'disabled' })
  await page.getByPlaceholder('High latency on checkout service', { exact: true }).fill('Audit outbox backlog')
  await page.locator('#monitor-alert-threshold').fill('10')
  await page.getByRole('button', { name: 'Save alert', exact: true }).click()
  await expect.poll(() => state.saves.length).toBe(1)
  expect(state.saves[0]).toMatchObject({ type: 'metric', query_config: { expression: selector }, critical: 10 })
})

test('old metric alert bookmarks redirect without losing the PromQL', async ({ page }) => {
  await stubMetricAlertApi(page)
  await page.goto(`/alerts/rules/add?${new URLSearchParams({ promql: selector, signal: 'metrics' })}`)
  await expect(page).toHaveURL(/\/alerts\/new\?/)
  await expect(page.locator('.mf-expr-container input')).toHaveValue(selector)
})

test('the query alert action preserves expressions containing operators and quoted labels', async ({ page }) => {
  await stubMetricAlertApi(page)
  const expression = 'sum(rate(http_requests_total{service_name="a&b", route=~"/api/.+"}[5m])) > 0'
  await openMetricQuery(page, expression)
  await page.getByTitle('Create alert from this query', { exact: true }).click()
  await expect(page.locator('.mf-expr-container input')).toHaveValue(expression)
})

test('series selectors escape label values and retain counter rate defaults', async ({ page }) => {
  const service = 'a"b\\c\nnext'
  await stubMetricAlertApi(page, { ...metric, __name__: 'requests_total', service_name: service })
  await openMetricQuery(page, 'requests_total')
  await page.locator('.metric-series-action').click()
  await expect(page.locator('.mf-expr-container input')).toHaveValue(`rate(requests_total{instance="unknown", service_name=${JSON.stringify(service)}}[5m])`)
})

test('a new alert without a metric link still opens the empty visual builder', async ({ page }) => {
  await stubMetricAlertApi(page)
  await page.goto('/alerts/new')
  await expect(page.getByRole('heading', { name: 'New alert', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit expression', exact: true })).toBeVisible()
  await expect(page.locator('.mf-expr-readonly')).toHaveText('Configure below...')
})
