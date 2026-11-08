import { test, expect, type Page } from '@playwright/test'
import { queryUrl, queryReply } from './query-contract'

async function stub(page: Page) {
  const diagnoses: Record<string, unknown>[] = []
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { services: [], views: [], buckets: [], groups: [], values: [], deploys: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/explore/search') body = { signal: route.request().postDataJSON().signal, rows: [], count: { value: 0, kind: 'exact' }, summary: { histogram: [], facets: { services: [], methods: [], statuses: [] }, groups: [] }, errors: {} }
    if (path === '/api/v1/explore/diagnose') {
      diagnoses.push(route.request().postDataJSON())
      body = { code: 'filter_excludes_data', message: 'Removing the service_name filter matches 50 records in the same time range.', complete: true, checked_filters: 1, suggestions: ['payments'] }
    }
    if (path === '/api/v1/dashboards/empty') body = { id: 'empty', name: 'CPU', description: '', visibility: 'tenant', tags: [], variables: [], widgets: [{ id: 'cpu', title: 'CPU usage', widget_type: 'timeseries', query_config: { source: 'metrics', promql: 'cpu_usage', filters: [] }, position: { col: 1, row: 1, col_span: 12, row_span: 3 }, display_config: {} }] }
    if (path.endsWith('/query_range')) body = { status: 'success', data: { resultType: 'matrix', result: [] } }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })
  return diagnoses
}

for (const mode of ['logs', 'spans']) {
  test(`explains empty ${mode} only on request, with the selected scope`, async ({ page }, info) => {
    const calls = await stub(page)
    await page.goto(`/?mode=${mode}&q=service_name%3Dpayment&t=60`)
    const action = page.getByRole('button', { name: 'Explain missing data' })
    await expect(action).toBeVisible()
    expect(calls).toHaveLength(0)
    await action.click()
    await expect(page.getByText('Removing the service_name filter matches 50 records in the same time range.')).toBeVisible()
    expect(calls[0]?.signal).toBe(mode)
    expect(calls[0]?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'service_name', value: 'payment' })]))
    await page.screenshot({ path: info.outputPath(`diagnosis-${mode}.png`), fullPage: true })
    await page.goto(`/?mode=${mode}&t=15`)
    await expect(page.getByRole('button', { name: 'Explain missing data' })).toBeVisible()
    await expect(page.getByText('Removing the service_name filter matches 50 records in the same time range.')).toHaveCount(0)
  })
}

test('empty metric panels diagnose the actual query and captured absolute range', async ({ page }) => {
  const calls = await stub(page)
  await page.goto('/dashboards/empty?t=15')
  await page.getByRole('button', { name: 'Explain missing data' }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ signal: 'metrics', promql: 'cpu_usage', filters: [] })
  const range = calls[0]?.time_range as { from: string; to: string }
  expect(Date.parse(range.to) - Date.parse(range.from)).toBe(15 * 60_000)
})

test('the metrics browser diagnoses the expression that produced the empty result', async ({ page }) => {
  const calls = await stub(page)
  await page.goto('/metrics-browser?q=rate(cpu_usage%5B1m%5D)&t=60')
  await page.getByRole('button', { name: 'Explain missing data' }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ signal: 'metrics', promql: 'rate(cpu_usage[1m])' })
})

for (const mode of ['logs', 'spans']) {
  test(`empty ${mode} diagnostics keep the submitted query while the editor changes`, async ({ page }) => {
    const calls = await stub(page)
    await page.goto(`/?mode=${mode}&q=service_name%3Dmissing&t=15`)
    const diagnose = page.getByRole('button', { name: 'Explain missing data' })
    await expect(diagnose).toBeVisible()
    await page.getByRole('textbox', { name: 'Search traces and logs' }).fill('service_name=payments')
    await diagnose.click()
    await expect.poll(() => calls.length).toBe(1)
    expect(calls[0]).toMatchObject({ signal: mode, filters: [{ field: 'service_name', op: '=', value: 'missing' }] })
    const range = calls[0]?.time_range as { from: string; to: string }
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(900_000)
  })
}
