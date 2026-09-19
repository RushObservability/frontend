import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, options: { slowLabels?: boolean; failNames?: boolean } = {}) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { services: [], views: [], channels: [], monitors: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/demo') body = { id: 'demo', name: 'Metrics demo', visibility: 'tenant', variables: [], widgets: [] }
    if (path.startsWith('/prom/api/v1/')) {
      body = { status: 'success', data: [] }
      if (path.endsWith('/__name__/values')) {
        if (options.failNames) return route.fulfill({ status: 500, body: '{}' })
        body = { status: 'success', data: ['http_requests_total', 'http_duration_seconds_bucket'] }
      }
      if (path.endsWith('/labels')) {
        if (options.slowLabels) await new Promise(resolve => setTimeout(resolve, 500))
        body = { status: 'success', data: ['__name__', 'service_name', 'env'] }
      }
      if (path.endsWith('/service_name/values')) body = { status: 'success', data: ['payments', 'payments worker'] }
      if (path.endsWith('/query_range')) body = { status: 'success', data: { resultType: 'matrix', result: [] } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}
async function dashboard(page: Page) {
  await page.goto('/dashboards/demo')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByRole('button', { name: '+ Add panel', exact: true }).click()
  await page.locator('.we-source-toggle').getByRole('button', { name: 'Metrics', exact: true }).click()
  return page.getByRole('combobox', { name: 'Query expression' })
}

test('dashboard completes metrics, functions and quoted label values using keyboard and pointer', async ({ page }, info) => {
  await stub(page)
  const editor = await dashboard(page)
  await editor.fill('sum(rate(http_req')
  await expect(page.getByRole('option', { name: 'http_requests_total metric', exact: true })).toBeVisible()
  await editor.press('Tab')
  await expect(editor).toHaveValue('sum(rate(http_requests_total')
  await editor.fill('inc')
  await page.getByRole('option', { name: 'increase() function', exact: true }).click()
  await expect(editor).toHaveValue('increase(')
  await editor.fill('http_requests_total{ser')
  await expect(page.getByRole('option', { name: 'service_name label', exact: true })).toBeVisible()
  await editor.press('Enter')
  await expect(editor).toHaveValue('http_requests_total{service_name')
  await editor.fill('http_requests_total{service_name="pay"}')
  await editor.press('ArrowLeft')
  await editor.press('ArrowLeft')
  await expect(page.getByRole('option', { name: 'payments value', exact: true })).toBeVisible()
  await editor.press('Enter')
  await expect(editor).toHaveValue('http_requests_total{service_name="payments"}')
  await editor.fill('http_')
  await expect(page.getByRole('listbox')).toBeVisible()
  const menu = await page.getByRole('listbox').boundingBox()
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({ path: info.outputPath('dashboard-query-completion.png'), fullPage: true })
  await editor.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(editor).toBeVisible()
})

test('Metrics uses the same editor and Ctrl+Enter executes instead of accepting a suggestion', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboards/demo')
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  const editor = page.getByRole('combobox', { name: 'Query expression' })
  await editor.fill('http_req')
  await expect(page.getByRole('option', { name: 'http_requests_total metric', exact: true })).toBeVisible()
  await editor.press('Tab')
  await expect(editor).toHaveValue('http_requests_total')
  await editor.fill('rate')
  await expect(page.getByRole('option', { name: 'rate() function', exact: true })).toBeVisible()
  const request = page.waitForRequest(r => r.url().includes('/prom/api/v1/query_range?'))
  await editor.press('Control+Enter')
  expect(new URL((await request).url()).searchParams.get('query')).toBe('rate')
  await expect(editor).toHaveValue('rate')
})

test('late label responses cannot reopen suggestions after Escape', async ({ page }) => {
  await stub(page, { slowLabels: true })
  const editor = await dashboard(page)
  const request = page.waitForRequest(r => new URL(r.url()).pathname === '/prom/api/v1/labels')
  await editor.fill('http_requests_total{ser')
  await request
  await editor.press('Escape')
  await page.waitForTimeout(650)
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(editor).toBeVisible()
})

test('function suggestions remain usable when metric discovery fails', async ({ page }) => {
  await stub(page, { failNames: true })
  const editor = await dashboard(page)
  await editor.fill('inc')
  await expect(page.getByRole('option', { name: 'increase() function', exact: true })).toBeVisible()
  await editor.press('Tab')
  await expect(editor).toHaveValue('increase(')
})

test('dashboard suggestions fit on mobile and support arrow-key selection', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  const editor = await dashboard(page)
  await editor.fill('http_')
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2)
  const menu = await page.getByRole('listbox').boundingBox()
  expect(menu!.x).toBeGreaterThanOrEqual(0)
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath('dashboard-query-mobile.png'), fullPage: true })
  await editor.press('ArrowDown')
  await editor.press('Enter')
  await expect(editor).toHaveValue('http_requests_total')
})

test('changing the dashboard query discards an in-flight suggestion response', async ({ page }) => {
  await stub(page, { slowLabels: true })
  const editor = await dashboard(page)
  const request = page.waitForRequest(r => new URL(r.url()).pathname === '/prom/api/v1/labels')
  await editor.fill('http_requests_total{ser')
  await request
  await page.getByRole('button', { name: '+ Add query', exact: true }).click()
  await page.waitForTimeout(650)
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('Ctrl+Space opens suggestions in an empty query and blur closes them', async ({ page }) => {
  await stub(page)
  const editor = await dashboard(page)
  await editor.focus()
  await editor.press('Control+Space')
  await expect(page.getByRole('option', { name: 'http_requests_total metric', exact: true })).toBeVisible()
  await page.getByPlaceholder('Name this panel').click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('Metrics natural-language mode does not show PromQL suggestions', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboards/demo')
  await page.getByRole('link', { name: 'Metrics', exact: true }).click()
  const editor = page.getByRole('combobox', { name: 'Query expression' })
  await editor.fill('http_requests_total')
  await page.getByTitle('AI: describe in plain English', { exact: true }).click()
  await editor.fill('inc')
  await expect(editor).toHaveAttribute('placeholder', 'Describe what you want to query... (Enter to apply, Esc to cancel)')
  await page.waitForTimeout(200)
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await editor.press('Escape')
  await expect(editor).toHaveValue('http_requests_total')
})
