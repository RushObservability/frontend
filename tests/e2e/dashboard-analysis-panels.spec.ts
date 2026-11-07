import { expect, test, type Page } from '@playwright/test'
import { queryUrl, queryBody, queryReply } from './query-contract'

async function stub(page: Page) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  let saved: Record<string, unknown> | undefined
  const trace = 'a'.repeat(32), now = Date.now() / 1000
  const widgets = [
    { id: 'patterns', title: 'Recurring log patterns', widget_type: 'log-patterns', query_config: { source: 'logs', filters: [], time_range_minutes: 60, limit: 10 }, position: { col: 1, row: 1, col_span: 12, row_span: 3 }, display_config: {} },
    { id: 'states', title: 'Service availability', widget_type: 'state-timeline', query_config: { source: 'metrics', filters: [], promql: 'up', time_range_minutes: 60 }, position: { col: 1, row: 4, col_span: 6, row_span: 4 }, display_config: { states: [{ value: 0, label: 'Offline', color: 'red' }, { value: 1, label: 'Ready', color: 'green' }] } },
    { id: 'scatter', title: 'Payload versus latency', widget_type: 'scatter', query_config: { source: 'spans', filters: [], x_field: 'attributes.bytes', y_field: 'duration_ms', time_range_minutes: 60, limit: 500 }, position: { col: 7, row: 4, col_span: 6, row_span: 4 }, display_config: { x_label: 'Payload', y_label: 'Duration', x_unit: 'bytes', unit: 'ms' } },
  ]
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { services: [], deploys: [], values: [], views: [], buckets: [], groups: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/panels') body = { id: 'panels', name: 'Service operations', description: '', visibility: 'private', tags: [], variables: [], widgets }
    if (path === '/api/v1/logs/patterns') {
      calls.push({ path, body: queryBody(route.request()) })
      body = { total: 100, patterns: [{ service: 'payments', severity: 'WARN', template: 'Retrying request N', example: 'Retrying request 3', trace_id: trace, last_seen: new Date().toISOString(), count: 25, total_count: 100, buckets: [[now - 1800, 10], [now - 1200, 15]] }] }
    }
    if (path === '/api/v1/query/scatter') {
      calls.push({ path, body: queryBody(route.request()) })
      body = { points: [{ x: 438, y: 1260, timestamp: new Date().toISOString(), trace_id: trace, span_id: 'b'.repeat(16), service: 'payments', label: 'POST /charge', error: 1 }, { x: 0, y: 0, timestamp: new Date().toISOString(), trace_id: '', span_id: '', service: 'payments', label: 'GET /status', error: 0 }], truncated: true }
    }
    if (path.endsWith('/query_range')) body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: { __name__: 'up', service_name: 'payments' }, values: [[now - 1800, '0'], [now - 1786, '0'], [now - 900, '1']] }] } }
    if ((path.endsWith('/widgets/states') && route.request().method() === 'PUT') || (path.endsWith('/widgets') && route.request().method() === 'POST')) { saved = route.request().postDataJSON(); body = { ...widgets[1], ...saved } }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })
  return { calls, saved: () => saved }
}

test('patterns expand, timeline gaps remain visible, and scatter points link to their trace', async ({ page }, info) => {
  const { calls } = await stub(page)
  await page.goto('/dashboards/panels?t=60')
  await expect(page.getByRole('heading', { name: 'Recurring log patterns' })).toBeVisible()
  await page.getByRole('button', { name: /Retrying request N/ }).click()
  await expect(page.getByText('Retrying request 3', { exact: true })).toBeVisible()
  await expect(page.getByText('25.0%')).toBeVisible()
  const offline = page.getByRole('button', { name: /payments.*Offline/ }).first()
  await offline.click()
  await expect(page.locator('.state-detail')).toContainText('Offline')
  expect(await offline.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.locator('.state-segment.missing').first()).toBeVisible()
  const plot = page.getByRole('group', { name: /Scatter plot/ })
  await plot.focus(); await plot.press('ArrowRight')
  await expect(page.getByRole('link', { name: 'View trace' })).toHaveAttribute('href', /\/trace\/a{32}/)
  const link = await page.getByRole('link', { name: 'View trace' }).boundingBox()
  const panel = await page.locator('.widget-wrap').filter({ has: page.getByRole('heading', { name: 'Payload versus latency' }) }).boundingBox()
  expect(link!.y + link!.height).toBeLessThanOrEqual(panel!.y + panel!.height)
  await expect(page.getByText('latest points · result capped')).toBeVisible()
  expect(calls.find(c => c.path.endsWith('/scatter'))?.body).toMatchObject({ source: 'spans', x_field: 'attributes.bytes', y_field: 'duration_ms', limit: 500 })
  await page.screenshot({ path: info.outputPath('analysis-panels.png'), fullPage: true })
})

test('state mappings can be edited and saved with the existing dashboard editor', async ({ page }) => {
  const data = await stub(page)
  await page.goto('/dashboards/panels')
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  const card = page.locator('.widget-wrap').filter({ has: page.getByRole('heading', { name: 'Service availability' }) })
  await card.getByTitle('Edit panel', { exact: true }).click()
  await page.getByRole('tab', { name: 'Panel', exact: true }).click()
  await expect(page.getByLabel('State 1 name')).toHaveValue('Offline')
  await page.getByLabel('State 1 name').fill('Down')
  await page.getByRole('button', { name: 'Apply changes' }).click()
  await expect.poll(() => data.saved()).toMatchObject({ widget_type: 'state-timeline', display_config: { states: [{ value: 0, label: 'Down', color: 'red' }, { value: 1, label: 'Ready', color: 'green' }] } })
})

test('panels reflow on mobile without overflowing the dashboard', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await stub(page)
  await page.goto('/dashboards/panels')
  await expect(page.getByRole('heading', { name: 'Payload versus latency' })).toBeVisible()
  await expect(page.locator('.scatter-point')).toHaveCount(1)
  const timeline = await page.locator('.widget-cell').filter({ has: page.getByRole('heading', { name: 'Service availability' }) }).boundingBox()
  const scatter = await page.locator('.widget-cell').filter({ has: page.getByRole('heading', { name: 'Payload versus latency' }) }).boundingBox()
  expect(scatter!.y).toBeGreaterThanOrEqual(timeline!.y + timeline!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('analysis-panels-mobile.png'), fullPage: true })
})

for (const [label, type, source] of [['Log patterns', 'log-patterns', 'logs'], ['State timeline', 'state-timeline', 'metrics'], ['Scatter plot', 'scatter', 'spans']] as const) {
  test(`creates a ${label} panel with a supported source and saved configuration`, async ({ page }) => {
    const data = await stub(page)
    await page.goto('/dashboards/panels')
    await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
    await page.getByRole('button', { name: '+ Add panel', exact: true }).click()
    await page.getByRole('tab', { name: 'Panel', exact: true }).click()
    await page.locator('.we-viz-card').filter({ hasText: label }).click()
    await page.getByRole('button', { name: 'Add to dashboard', exact: true }).click()
    await expect.poll(() => data.saved()).toMatchObject({ widget_type: type, query_config: { source } })
    if (type === 'state-timeline') expect(data.saved()).toMatchObject({ display_config: { states: expect.arrayContaining([expect.objectContaining({ value: 0, label: 'Unavailable' })]) } })
    if (type === 'scatter') expect(data.saved()).toMatchObject({ query_config: { x_field: 'attributes.http.request.body.size', y_field: 'duration_ms', limit: 500 } })
  })
}
