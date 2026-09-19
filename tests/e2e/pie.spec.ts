import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page) {
  const now = Math.floor(Date.now() / 1000)
  const widgets = ['donut', 'pie'].map((style, i) => ({
    id: `pie-${i}`, title: i ? 'Traffic by service' : 'Request share', widget_type: 'pie',
    query_config: { source: 'metrics', promql: `traffic_${i}`, filters: [], time_range_minutes: 60 },
    display_config: { pie_style: style, pie_calculation: 'last', unit: 'req/s' },
    position: { col: i * 6 + 1, row: 1, col_span: 6, row_span: 4 },
  })) as any[]
  const saves: any[] = []
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { services: [], views: [], channels: [], monitors: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/pie-test') body = {
      id: 'pie-test', name: 'Service traffic', visibility: 'tenant', variables: [],
      // Isolate the panel's narrow layout from dashboard grid positioning.
      widgets: (page.viewportSize()?.width ?? 1600) < 600 ? widgets.slice(0, 1) : widgets,
    }
    if (path === '/api/v1/dashboards/pie-test/widgets' && route.request().method() === 'POST') {
      body = { ...route.request().postDataJSON(), id: 'created-pie' }
      widgets.push(body)
      saves.push(body)
    }
    if (path === '/api/v1/dashboards/pie-test/widgets/pie-0' && route.request().method() === 'PUT') {
      Object.assign(widgets[0], route.request().postDataJSON())
      body = widgets[0]
      saves.push(body)
    }
    if (path.startsWith('/prom/api/v1/')) {
      body = { status: 'success', data: [] }
      if (path.endsWith('/query_range')) body = { status: 'success', data: { resultType: 'matrix', result:
        [['checkout', 480], ['payments', 280], ['catalog', 160], ['notifications', 80]].map(([service, count]) => ({
          metric: { service }, values: [[now - 60, String(Number(count) / 2)], [now, String(count)]],
        })),
      } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return saves
}

test('pie and donut share readable legends, accessible highlighting, and responsive circles', async ({ page }, info) => {
  await stub(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/dashboards/pie-test')
  await expect(page.locator('.pie-slice')).toHaveCount(8)
  await expect(page.locator('.pie-center')).toHaveCount(1)
  await expect(page.locator('.pie-center strong')).toHaveText('1,000')
  const legend = page.getByRole('button', { name: /Highlight.*payments/ }).first()
  await legend.focus()
  await expect(page.locator('.pie-center-label')).toContainText('payments')
  await expect(page.locator('.pie-slice--muted')).toHaveCount(3)
  await legend.press('Enter')
  await expect(legend).toHaveAttribute('aria-pressed', 'true')
  await legend.press('Escape')
  await expect(legend).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: info.outputPath('pie-light.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.screenshot({ path: info.outputPath('pie-dark.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  await expect(page.locator('.pie-center')).toBeVisible()
  await expect(page.locator('.pie-legend').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('pie-mobile.png'), fullPage: true, animations: 'disabled' })
})

test('pie settings save, reload, and also work when adding a new panel', async ({ page }) => {
  const saves = await stub(page)
  await page.goto('/dashboards/pie-test')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByTitle('Edit panel', { exact: true }).first().click()
  const editor = page.getByRole('dialog', { name: 'Edit panel', exact: true })
  await editor.getByRole('tab', { name: 'Panel', exact: true }).click()
  await editor.getByLabel('Pie style').selectOption('pie')
  await editor.getByLabel('Value per series').selectOption('sum')
  await editor.getByLabel('Slice order').selectOption('ascending')
  await editor.getByLabel('Legend position').selectOption('bottom')
  await expect(editor.locator('.pie-slice')).toHaveCount(4)
  await expect(editor.locator('.pie-center')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Apply changes' }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0].display_config).toMatchObject({ pie_style: 'pie', pie_calculation: 'sum', pie_sort: 'ascending', pie_legend_position: 'bottom', unit: 'req/s' })
  await page.reload()
  await expect(page.locator('.pie-widget--bottom')).toHaveCount(1)
  await expect(page.locator('.pie-center')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByRole('button', { name: '+ Add panel', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add panel', exact: true })
  await add.getByRole('tab', { name: 'Panel', exact: true }).click()
  await add.getByRole('button', { name: /Pie chart Compare shares/ }).click()
  await add.getByLabel('Panel title').fill('New donut')
  await add.getByRole('tab', { name: 'Query', exact: true }).click()
  await add.locator('.we-source-toggle').getByRole('button', { name: 'Metrics', exact: true }).click()
  await add.getByRole('combobox', { name: 'Query expression' }).fill('traffic_new')
  await expect(add.locator('.pie-slice')).toHaveCount(4)
  await add.getByRole('button', { name: 'Add to dashboard', exact: true }).click()
  await expect.poll(() => saves.length).toBe(2)
  expect(saves[1]).toMatchObject({ widget_type: 'pie', display_config: { pie_style: 'donut', pie_calculation: 'last' } })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'New donut', exact: true })).toBeVisible()
})
