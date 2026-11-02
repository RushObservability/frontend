import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, pattern: string, names: string[]) {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let body: unknown = { channels: [], events: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/anomaly-rules') body = { rules: [{
      id: 'rule', name: 'Metric detector', source: 'prometheus', pattern, enabled: true,
      description: '', service_name: '', apm_metric: '', sensitivity: 3, alpha: .3,
      state: 'anomalous', last_triggered_at: new Date().toISOString(), created_at: new Date().toISOString(),
      split_labels: [], notification_channel_ids: [],
    }] }
    if (path === '/prom/api/v1/label/__name__/values') body = { status: 'success', data: names }
    if (path === '/prom/api/v1/query_range') {
      const end = Number(url.searchParams.get('end'))
      body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: {},
        values: Array.from({ length: 22 }, (_, i) => [end - (21 - i) * 15, i >= 20 ? '100' : '1']),
      }] } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('real worker matches normal saved patterns under the production CSP', async ({ page }) => {
  await stub(page, '^(cpu|memory)_.+$', ['cpu_usage', 'memory_bytes', 'requests'])
  await page.goto('/anomaly')
  await expect(page.locator('[data-chart-metric]')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a pathological saved regex times out while the page remains responsive', async ({ page }) => {
  await stub(page, '^(a+)+$', ['a', 'a'.repeat(30) + 'b'])
  await page.goto('/anomaly')
  // A main-thread regex would prevent even this interaction from completing.
  await page.getByRole('button', { name: /All detectors/ }).click({ timeout: 1500 })
  await expect(page.getByRole('button', { name: 'View signal', exact: false })).toBeVisible()
  await page.getByRole('button', { name: /Firing now/ }).first().click()
  await expect(page.getByRole('alert')).toHaveText('Metric pattern matching took too long. Simplify the detector pattern.', { timeout: 6000 })
  await page.getByRole('link', { name: 'Services', exact: true }).click()
  await expect(page).toHaveURL(/\/services$/)
})
