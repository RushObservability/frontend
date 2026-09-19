import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, role = 'admin') {
  const state = {
    defaults: { time_range_minutes: 10080, refresh_interval_secs: 30 },
    saves: [] as Record<string, unknown>[], queries: 0, failSave: false,
  }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { services: [], views: [], channels: [], monitors: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/defaults-test') {
      if (route.request().method() === 'PUT') {
        const data = route.request().postDataJSON()
        state.saves.push(data)
        if (state.failSave) {
          await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Permission denied' }) })
          return
        }
        state.defaults = data.defaults ?? state.defaults
      }
      body = {
        id: 'defaults-test', name: 'Service health', description: 'Operational signals', visibility: 'tenant',
        tags: ['production'], variables: [], defaults: state.defaults,
        widgets: [{ id: 'traffic', title: 'Traffic', widget_type: 'pie',
          query_config: { source: 'metrics', promql: 'traffic', filters: [] },
          position: { col: 1, row: 1, col_span: 12, row_span: 4 }, display_config: { pie_style: 'donut' },
        }],
      }
    }
    if (path.endsWith('/query_range')) {
      state.queries++
      const now = Math.floor(Date.now() / 1000)
      body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: { service: 'payments' }, values: [[now - 60, '20'], [now, '30']] }] } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('saves selected defaults to the dashboard and restores them on a fresh visit', async ({ page }, info) => {
  const state = await stub(page)
  await page.goto('/dashboards/defaults-test')
  await expect(page.getByRole('button', { name: 'Last 7d', exact: true })).toBeVisible()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('30')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save as defaults' })).toBeDisabled()
  await page.getByRole('button', { name: 'Last 7d', exact: true }).click()
  await page.getByRole('button', { name: 'Last 6h', exact: true }).click()
  await page.getByLabel('Auto-refresh interval').selectOption('60')
  await page.screenshot({ path: info.outputPath('dashboard-defaults.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save as defaults' }).click()
  await expect(page.getByRole('status')).toHaveText('Dashboard defaults saved.')
  expect(state.saves[0]).toMatchObject({
    name: 'Service health', description: 'Operational signals', tags: ['production'], variables: [],
    defaults: { time_range_minutes: 360, refresh_interval_secs: 60 },
  })
  await page.goto('/dashboards/defaults-test')
  await expect(page.getByRole('button', { name: 'Last 6h', exact: true })).toBeVisible()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('60')
  await page.reload()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('60')
})

test('URL overrides do not change defaults and TV links use saved polling', async ({ page }) => {
  const state = await stub(page)
  await page.clock.install()
  await page.goto('/dashboards/defaults-test?t=15&refresh=0')
  await expect(page.getByRole('button', { name: 'Last 15m', exact: true })).toBeVisible()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('0')
  await expect(page.locator('.pie-slice')).toHaveCount(1)
  const before = state.queries
  await page.clock.fastForward(35_000)
  expect(state.queries).toBe(before)
  expect(state.saves).toHaveLength(0)
  await page.goto('/dashboards/defaults-test?tv=1')
  await expect(page.locator('.pie-slice')).toHaveCount(1)
  const tvBefore = state.queries
  await page.clock.fastForward(35_000)
  await expect.poll(() => state.queries).toBeGreaterThan(tvBefore)
  await page.getByRole('button', { name: 'Exit TV mode', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Last 7d', exact: true })).toBeVisible()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('30')
})

test('failed saves keep the selection and panels visible, and can be retried', async ({ page }) => {
  const state = await stub(page)
  state.failSave = true
  await page.goto('/dashboards/defaults-test')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByLabel('Auto-refresh interval').selectOption('0')
  await page.getByRole('button', { name: 'Save as defaults' }).click()
  await expect(page.locator('.defaults-error')).toBeVisible()
  await expect(page.locator('.pie-slice')).toHaveCount(1)
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('0')
  expect(state.defaults.refresh_interval_secs).toBe(30)
  state.failSave = false
  await page.getByRole('button', { name: 'Save as defaults' }).click()
  await expect(page.getByRole('status')).toHaveText('Dashboard defaults saved.')
  expect(state.defaults.refresh_interval_secs).toBe(0)
})

test('read-only viewers get defaults but cannot save them', async ({ page }) => {
  await stub(page, 'read')
  await page.goto('/dashboards/defaults-test')
  await expect(page.getByRole('button', { name: 'Last 7d', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit dashboard', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save as defaults' })).toHaveCount(0)
})
