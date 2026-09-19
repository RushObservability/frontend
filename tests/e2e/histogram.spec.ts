import { test, expect } from '@playwright/test'

test('histogram uses unscaled chart typography and responsive numeric bucket ticks', async ({ page }, info) => {
  const now = Math.floor(Date.now() / 1000)
  const values = Array.from({ length: 221 }, (_, i) => [now - 3300 + i * 15, String(1.04 + i / 1000)])
  const widgets = ['histogram', 'timeseries'].map((type, i) => ({
    id: type, title: type === 'histogram' ? 'Value distribution' : 'Time series reference', widget_type: type,
    query_config: { source: 'metrics', promql: `example_metric_${type}` },
    display_config: { histogram_bucket_count: 22, unit: '' },
    position: { col: 1, row: 1 + i * 4, col_span: 12, row_span: 4 },
  }))
  const saves: Record<string, any>[] = []
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { services: [], views: [], channels: [], monitors: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/histogram-test') body = {
      id: 'histogram-test', name: 'Histogram typography', visibility: 'tenant', variables: [],
      widgets,
    }
    if (path === '/api/v1/dashboards/histogram-test/widgets/histogram' && route.request().method() === 'PUT') {
      const saved = route.request().postDataJSON()
      saves.push(saved)
      Object.assign(widgets[0]!, saved)
      body = widgets[0]
    }
    if (path.startsWith('/prom/api/v1/')) body = {
      status: 'success', data: { resultType: 'matrix', result: [{ metric: { __name__: 'example_metric' }, values }] },
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/dashboards/histogram-test')
  const axis = page.locator('.histogram-axis--bottom')
  await expect(axis.first()).toHaveText('1.04')
  await expect(axis.last()).toHaveText('1.26')
  const wideCount = await axis.count()
  expect(wideCount).toBeGreaterThan(8)
  const fonts = () => page.evaluate(() => {
    const style = (selector: string) => {
      const el = document.querySelector(selector)!
      const css = getComputedStyle(el)
      return { font: css.fontSize, family: css.fontFamily, height: el.getBoundingClientRect().height }
    }
    return { histogram: style('.histogram-axis--bottom'), timeseries: style('.ts-axis-label--bottom') }
  })
  const initial = await fonts()
  expect(initial.histogram).toEqual(initial.timeseries)
  await expect(page.locator('.histogram-svg text')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('histogram-wide.png'), fullPage: true })
  await page.locator('.histogram-plot').evaluate(el => { (el as HTMLElement).style.minHeight = '500px' })
  expect((await fonts()).histogram).toEqual(initial.histogram)
  await page.locator('.histogram-plot').evaluate(el => { (el as HTMLElement).style.minHeight = '' })
  await page.setViewportSize({ width: 600, height: 950 })
  await expect.poll(() => axis.count()).toBeLessThan(wideCount)
  await expect(axis.first()).toHaveText('1.04')
  await expect(axis.last()).toHaveText('1.26')
  await expect(axis.first()).toBeInViewport()
  const boxes = await axis.evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right }
  }))
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left).toBeGreaterThan(boxes[i - 1]!.right)
  await page.screenshot({ path: info.outputPath('histogram-narrow.png'), fullPage: true })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByTitle('Edit panel', { exact: true }).first().click()
  const editor = page.getByRole('dialog', { name: 'Edit panel', exact: true })
  await editor.getByRole('tab', { name: 'Panel', exact: true }).click()
  await editor.getByLabel('X-axis unit', { exact: true }).fill('events/s')
  await expect(editor.locator('.histogram-axis--bottom').first()).toHaveText('1.04 events/s')
  await editor.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]!.display_config.unit).toBe('events/s')
  await page.reload()
  await expect(axis.first()).toHaveText('1.04 events/s')
  await expect(page.locator('.histogram-axis--left').first()).toHaveText('0')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByTitle('Edit panel', { exact: true }).first().click()
  await editor.getByRole('tab', { name: 'Panel', exact: true }).click()
  await expect(editor.getByLabel('X-axis unit', { exact: true })).toHaveValue('events/s')
  await editor.getByLabel('X-axis unit', { exact: true }).fill('')
  await editor.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => saves.length).toBe(2)
  expect(saves[1]!.display_config).not.toHaveProperty('unit')
  await page.reload()
  await expect(axis.first()).toHaveText('1.04')
})
