import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, nativeFullscreen: boolean | 'real' = false) {
  const requests = { dashboard: 0, queries: 0 }
  await page.addInitScript(({ nativeFullscreen }) => {
    if (nativeFullscreen === 'real') return
    let element: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => element })
    Element.prototype.requestFullscreen = async () => {
      if (!nativeFullscreen) throw new DOMException('Fullscreen denied', 'NotAllowedError')
      element = document.documentElement
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    document.exitFullscreen = async () => {
      element = null
      document.dispatchEvent(new Event('fullscreenchange'))
    }
  }, { nativeFullscreen })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { services: [], views: [], channels: [], monitors: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/tv-test') {
      requests.dashboard++
      body = {
        id: 'tv-test', name: 'Service health', visibility: 'tenant',
        variables: [{ name: 'service', type: 'static', options: ['payments', 'checkout'], default: 'checkout' }],
        widgets: ['payments', 'checkout'].map((service, index) => ({
          id: service, title: `${service} traffic`, widget_type: 'pie',
          query_config: { source: 'metrics', promql: `traffic_${service}`, filters: [], time_range_minutes: 60 },
          display_config: { pie_style: 'donut', unit: 'req/s' },
          position: { col: index * 6 + 1, row: 1, col_span: 6, row_span: 4 },
        })),
      }
    }
    if (path.endsWith('/query_range')) {
      requests.queries++
      const now = Math.floor(Date.now() / 1000)
      body = { status: 'success', data: { resultType: 'matrix', result:
        [['success', 480], ['errors', 20]].map(([status, count]) => ({
          metric: { service: status }, values: [[now - 60, String(count)], [now, String(count)]],
        })),
      } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return requests
}

test('TV mode hides navigation and controls, keeps filters and polling, and exits with Escape', async ({ page }, info) => {
  const requests = await stub(page)
  await page.clock.install()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/dashboards/tv-test?t=360&var-service=payments')
  await expect(page.locator('.pie-slice')).toHaveCount(4)
  await page.getByLabel('Auto-refresh interval').selectOption('30')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  const before = requests.queries
  await page.getByRole('button', { name: 'TV mode', exact: true }).click()
  await expect(page).toHaveURL(/tv=1/)
  await expect(page.locator('.topbar')).toHaveCount(0)
  await expect(page.locator('.app-navigation')).toHaveCount(0)
  await expect(page.locator('.dashboard-header, .dashboard-control-deck, .dash-var-bar, .edit-mode-bar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Exit TV mode', exact: true })).toBeFocused()
  await expect(page.locator('.pie-slice')).toHaveCount(4)
  expect(requests.dashboard).toBe(1)
  expect(requests.queries).toBe(before)
  const bounds = await page.locator('.widget-grid').boundingBox()
  expect(bounds!.width).toBe(1568)
  expect(bounds!.height).toBeGreaterThan(900)
  await page.screenshot({ path: info.outputPath('tv-light.png'), fullPage: true })
  await page.setViewportSize({ width: 2560, height: 1440 })
  expect((await page.locator('.widget-grid').boundingBox())!.width).toBe(2528)
  await page.clock.fastForward(35_000)
  await expect.poll(() => requests.queries).toBeGreaterThan(before)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/tv=1/)
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.app-navigation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'TV mode', exact: true })).toBeFocused()
  await expect(page.getByLabel('Auto-refresh interval')).toHaveValue('30')
  await expect(page.locator('.dash-var-select')).toHaveValue('payments')
  expect(new URL(page.url()).searchParams.get('t')).toBe('360')
})

test('native fullscreen exit restores the dashboard and query parameters', async ({ page }) => {
  await stub(page, true)
  await page.goto('/dashboards/tv-test?t=360&var-service=payments')
  await page.getByRole('button', { name: 'TV mode', exact: true }).click()
  await expect(page).toHaveURL(/tv=1/)
  await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.evaluate(() => document.exitFullscreen())
  await expect(page).not.toHaveURL(/tv=1/)
  await expect(page.locator('.topbar')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('var-service')).toBe('payments')
})

test('TV links reload without automatic fullscreen and fit narrow screens without overlapping panels', async ({ page }, info) => {
  await stub(page, true)
  await page.goto('/dashboards/tv-test?tv=1&t=360&var-service=payments')
  await page.reload()
  await expect(page.locator('.pie-slice')).toHaveCount(4)
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect(page.locator('.topbar')).toHaveCount(0)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: info.outputPath('tv-dark.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const panels = page.locator('.widget-cell')
  const first = await panels.nth(0).boundingBox()
  const second = await panels.nth(1).boundingBox()
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: info.outputPath('tv-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Exit TV mode', exact: true }).click()
  await expect(page).not.toHaveURL(/tv=1/)
  await expect(page.locator('.topbar')).toBeVisible()
  await page.goto('/dashboards?tv=1')
  await expect(page.locator('.topbar')).toBeVisible()
})

test('browser fullscreen exits on button press and when navigating away', async ({ page }) => {
  await stub(page, 'real')
  await page.goto('/dashboards/tv-test')
  await page.getByRole('button', { name: 'TV mode', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.getByRole('button', { name: 'Exit TV mode', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect(page.locator('.topbar')).toBeVisible()
  await page.getByRole('button', { name: 'TV mode', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog')
  await palette.getByRole('combobox').fill('Dashboards')
  await palette.getByRole('option', { name: /Dashboards/ }).click()
  await expect(page).toHaveURL(/\/dashboards$/)
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect(page.locator('.topbar')).toBeVisible()
})
