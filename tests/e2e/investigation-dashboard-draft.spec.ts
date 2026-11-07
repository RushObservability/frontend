import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, role = 'admin', emptyMetric = false) {
  const state = { generations: [] as Record<string, unknown>[], saves: [] as Record<string, any>[], previewRanges: [] as Record<string, any>[] }
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    let body: unknown = { sessions: [], templates: [], services: [], views: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/investigate') {
      const stream = [{ type: 'session_created', session_id: 'session-1' }, { type: 'summary', text: 'Payments latency rose after deployment.', kind: 'final' }, { type: 'done', session_id: 'session-1', rounds: 1 }].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
      await route.fulfill({ contentType: 'text/event-stream', body: stream }); return
    }
    if (path.endsWith('/dashboard-draft')) {
      state.generations.push(route.request().postDataJSON())
      body = { time_range: { from: '2026-11-06T12:00:00Z', to: '2026-11-06T13:00:00Z' }, draft: {
        format_version: 'v1', exported_at: '', dashboard: { name: 'Payments investigation', description: 'Latency and CPU', visibility: 'private', tags: ['investigation'] }, widgets: [
          { title: 'Request latency', widget_type: 'timeseries', query_config: { source: 'spans', filters: [], aggregation: 'p95_ms' }, position: { col: 1, row: 1, col_span: 6, row_span: 3 }, display_config: { unit: 'ms' } },
          { title: 'CPU usage', widget_type: 'timeseries', query_config: { source: 'metrics', promql: 'cpu_usage', filters: [] }, position: { col: 7, row: 1, col_span: 6, row_span: 3 }, display_config: {} },
        ],
      } }
    }
    if (path === '/api/v1/query/timeseries') {
      state.previewRanges.push(route.request().postDataJSON().time_range)
      body = { grouped: false, buckets: [{ bucket: '2026-11-06 12:30:00', count: 100, error_count: 2, avg_duration_ms: 10, p50_ms: 8, p95_ms: 30, p99_ms: 40 }] }
    }
    if (path.endsWith('/query_range')) body = { status: 'success', data: { resultType: 'matrix', result: emptyMetric ? [] : [{ metric: { __name__: 'cpu_usage' }, values: [[1793968200, '2']] }] } }
    if (path === '/api/v1/dashboards/import') { state.saves.push(route.request().postDataJSON()); body = { id: 'saved' } }
    if (path === '/api/v1/dashboards/saved') body = { id: 'saved', name: 'Saved dashboard', visibility: 'private', tags: [], variables: [], widgets: [] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('generates, previews and explicitly saves a private dashboard', async ({ page }, info) => {
  const state = await stub(page)
  await page.goto('/investigate?q=Investigate%20payments')
  await page.getByRole('button', { name: 'Build dashboard from investigation' }).click()
  await page.getByLabel('What should it show?').fill('Payments latency and CPU')
  expect(state.saves).toHaveLength(0)
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save private dashboard' })
  await expect(save).toBeEnabled()
  expect(state.generations).toEqual([{ instructions: 'Payments latency and CPU', time_range_minutes: 60 }])
  expect(state.previewRanges[0]).toEqual({ from: '2026-11-06T12:00:00.000Z', to: '2026-11-06T13:00:00.000Z' })
  expect(state.saves).toHaveLength(0)
  await page.getByLabel('Dashboard name').fill('Payments watch')
  await save.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('dashboard-draft.png'), fullPage: true })
  await save.click()
  await expect(page).toHaveURL(/\/dashboards\/saved/)
  expect(state.saves[0]?.dashboard).toMatchObject({ name: 'Payments watch', visibility: 'private' })
  expect(state.saves[0]?.widgets).toHaveLength(2)
})

test('requires excluding empty panels before saving and keeps the remaining panels', async ({ page }) => {
  const state = await stub(page, 'admin', true)
  await page.goto('/investigate?q=Investigate%20payments')
  await page.getByRole('button', { name: 'Build dashboard from investigation' }).click()
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
  await expect(page.getByText('No samples in the preview range. Exclude this panel or try a wider range.')).toBeVisible()
  const save = page.getByRole('button', { name: 'Save private dashboard' })
  await expect(save).toBeDisabled()
  await page.locator('.draft-panel').filter({ hasText: 'CPU usage' }).getByRole('button', { name: 'Exclude panel' }).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page).toHaveURL(/\/dashboards\/saved/)
  expect(state.saves[0]?.widgets).toHaveLength(1)
  expect(state.saves[0]?.widgets[0].title).toBe('Request latency')
})

test('viewers cannot generate or save dashboards', async ({ page }) => {
  const state = await stub(page, 'viewer')
  await page.goto('/investigate?q=Investigate%20payments')
  await expect(page.getByText('Payments latency rose after deployment.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build dashboard from investigation' })).toHaveCount(0)
  expect(state.generations).toHaveLength(0)
  expect(state.saves).toHaveLength(0)
})

test('draft controls and save remain reachable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 })
  await stub(page)
  await page.goto('/investigate?q=Investigate%20payments')
  await page.getByRole('button', { name: 'Build dashboard from investigation' }).click()
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save private dashboard' })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page).toHaveURL(/\/dashboards\/saved/)
})
