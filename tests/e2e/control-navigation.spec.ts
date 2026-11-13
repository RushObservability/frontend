import { test, expect, type Page } from '@playwright/test'

async function stubShell(page: Page, role = 'admin') {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {}
    if (path === '/api/v1/auth/me') body = { user: { id: 'control-nav-test', username: 'tester', role } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/telemetry-quality') body = {
      evaluated_at: '2026-11-12T12:00:00Z', from: '2026-11-11T12:00:00Z', to: '2026-11-12T12:00:00Z', minutes: 1440,
      sample_limit_per_source: 1000, sampling: 'Bounded samples.', sources: [], inventory_available: true, inventory_capped: false,
      partial: false, finding_count: 0, high_impact_findings: 0, assessed_services: 0, unknown_services: 0,
      omitted_findings: 0, omitted_services: 0, rules: [], findings: [], services: [], history: [], history_available: true,
      history_capped: false, scheduled_at: null, cache_hit: false,
      score: { value: null, passed_weight: 0, evaluated_weight: 0, evaluated_checks: 0, not_evaluated_checks: 0 },
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

const labels = ['Noise & waste', 'Telemetry quality', 'Usage', 'Capacity']

test('desktop Control groups the four telemetry pages in a keyboard-accessible submenu', async ({ page }) => {
  await stubShell(page)
  await page.goto('/services')
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  const control = sidebar.locator('.app-navigation-group').filter({ has: page.getByRole('heading', { name: 'Control', exact: true }) })
  const observe = sidebar.locator('.app-navigation-group').filter({ has: page.getByRole('heading', { name: 'Observe', exact: true }) })
  const toggle = control.getByRole('button', { name: 'Telemetry management', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  for (const label of labels) await expect(observe.getByRole('link', { name: label, exact: true })).toHaveCount(0)
  await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const submenu = control.getByRole('group', { name: 'Telemetry management', exact: true })
  await expect(submenu.getByRole('link')).toHaveText(labels)
  await expect(control.getByRole('link', { name: 'Audit', exact: true })).toBeVisible()
  await expect(control.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await toggle.press('Space')
  await expect(submenu).toBeHidden()
})

test('opening a telemetry page expands its parent and marks the current link', async ({ page }) => {
  await stubShell(page)
  await page.goto('/telemetry-quality')
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  await expect(sidebar.getByRole('button', { name: 'Telemetry management', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(sidebar.getByRole('link', { name: 'Telemetry quality', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('link', { name: 'Noise & waste', exact: true })).not.toHaveAttribute('aria-current', 'page')
})

test('viewer submenu retains quality, noise and usage while hiding administrative pages', async ({ page }) => {
  await stubShell(page, 'viewer')
  await page.goto('/services')
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  await sidebar.getByRole('button', { name: 'Telemetry management', exact: true }).click()
  const submenu = sidebar.getByRole('group', { name: 'Telemetry management', exact: true })
  await expect(submenu.getByRole('link')).toHaveText(labels.slice(0, 3))
  for (const label of ['Capacity', 'Audit', 'Settings']) await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(0)
})

test('phone drawer preserves the submenu, active route and close-on-navigation behavior', async ({ page }) => {
  await stubShell(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/services')
  await page.locator('.mobile-navigation').getByRole('button', { name: 'More', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigate', exact: true })
  const toggle = drawer.getByRole('button', { name: 'Telemetry management', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  const submenu = drawer.getByRole('group', { name: 'Telemetry management', exact: true })
  await expect(submenu.getByRole('link')).toHaveText(labels)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await submenu.getByRole('link', { name: 'Telemetry quality', exact: true }).click()
  await expect(page).toHaveURL(/\/telemetry-quality/)
  await expect(drawer).toBeHidden()
  await page.locator('.mobile-navigation').getByRole('button', { name: 'More', exact: true }).click()
  await expect(drawer.getByRole('button', { name: 'Telemetry management', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.getByRole('link', { name: 'Telemetry quality', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
})

test('command search still includes collapsed telemetry destinations', async ({ page }) => {
  await stubShell(page)
  await page.goto('/services')
  await page.getByRole('button', { name: 'Open global search', exact: true }).click()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  const search = palette.getByRole('combobox', { name: 'Search commands', exact: true })
  await search.fill('Noise')
  await expect(palette.getByRole('option', { name: /Noise & waste/ })).toBeVisible()
  await search.fill('Telemetry quality')
  await expect(palette.getByRole('option', { name: /Telemetry quality/ })).toBeVisible()
})

test('Settings app navigation exposes the same Control submenu', async ({ page }) => {
  await stubShell(page)
  await page.goto('/settings#general')
  const settings = page.getByRole('navigation', { name: 'Settings navigation', exact: true })
  await settings.getByRole('button', { name: 'App navigation', exact: true }).click()
  await settings.getByRole('button', { name: 'Telemetry management', exact: true }).click()
  const submenu = settings.getByRole('group', { name: 'Telemetry management', exact: true })
  await expect(submenu.getByRole('link')).toHaveText(labels)
  await submenu.getByRole('link', { name: 'Telemetry quality', exact: true }).click()
  await expect(page).toHaveURL(/\/telemetry-quality/)
  await expect(page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Telemetry management', exact: true })).toHaveAttribute('aria-expanded', 'true')
})
