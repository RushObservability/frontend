import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page) {
  const state = { queries: 0, notifications: [] as unknown[] }
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let body: unknown = { channels: [], events: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/anomaly-rules') body = { rules: [{
      id: 'rule', name: 'CPU anomaly', source: 'prometheus', pattern: '^cpu$', enabled: true,
      description: '', service_name: '', apm_metric: '', sensitivity: 3, alpha: .3,
      state: 'anomalous', last_triggered_at: new Date().toISOString(), created_at: new Date().toISOString(),
      split_labels: [], notification_channel_ids: ['production'],
    }] }
    if (path === '/api/v1/channels') body = { channels: [{ id: 'production', name: 'Production channel', channel_type: 'webhook' }] }
    if (path === '/prom/api/v1/label/__name__/values') body = { status: 'success', data: ['cpu'] }
    if (path === '/prom/api/v1/query_range') {
      state.queries++
      const end = Number(url.searchParams.get('end'))
      body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: {},
        values: Array.from({ length: 22 }, (_, i) => [end - (21 - i) * 15, i >= 20 ? '100' : '1']),
      }] } }
    }
    if (path === '/api/v1/channels/production/notify') {
      state.notifications.push(route.request().postDataJSON())
      body = {}
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('viewing, reloading and polling a firing anomaly sends no notifications', async ({ page }) => {
  await page.clock.install()
  const state = await stub(page)
  await page.goto('/anomaly')
  await expect(page.locator('[data-chart-metric]')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('[data-chart-metric]')).toHaveCount(1)
  const before = state.queries
  await page.clock.fastForward(31_000)
  await expect.poll(() => state.queries).toBeGreaterThan(before)
  await expect(page.locator('[data-chart-metric]')).toHaveCount(1)
  expect(state.notifications).toEqual([])
})

test('an explicit manual send still notifies the chosen channel once', async ({ page }) => {
  const state = await stub(page)
  await page.goto('/anomaly')
  await expect(page.locator('[data-chart-metric]')).toHaveCount(1)
  await page.getByRole('button', { name: /All detectors/ }).click()
  await page.getByRole('button', { name: /View signal/ }).click()
  expect(state.notifications).toEqual([])
  await page.getByTitle('Send alert', { exact: true }).click()
  await page.getByRole('button', { name: /Production channel/ }).click()
  await expect.poll(() => state.notifications.length).toBe(1)
  expect(state.notifications[0]).toMatchObject({ monitor: 'CPU anomaly', metric: 'cpu' })
})
