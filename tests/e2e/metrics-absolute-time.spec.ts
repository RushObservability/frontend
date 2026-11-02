import { test, expect, type Page } from '@playwright/test'

test.use({ timezoneId: 'UTC' })
async function stub(page: Page) {
  const queries: URL[] = []
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as any).__sharedUrl = text },
    } })
  })
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    let body: unknown = { services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/dashboards/relative') body = { id: 'relative', name: 'Relative dashboard', variables: [], widgets: [], visibility: 'tenant' }
    if (path.startsWith('/prom/')) body = { status: 'success', data: [] }
    if (path === '/prom/api/v1/label/__name__/values') body = { status: 'success', data: ['cpu'] }
    if (path.endsWith('/query_range') || path === '/prom/api/v1/query') {
      queries.push(url)
      const end = Number(url.searchParams.get('end') || url.searchParams.get('time') || Date.now() / 1000)
      const range = path.endsWith('/query_range')
      body = { status: 'success', data: { resultType: range ? 'matrix' : 'vector', result: [{ metric: { __name__: 'cpu' },
        ...(range ? { values: [[end - 60, '1'], [end, '2']] } : { value: [end, '2'] }),
      }] } }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return queries
}

async function chooseRange(page: Page, day: string) {
  await page.locator('.tp-trigger').click()
  await page.locator('input[type=datetime-local]').nth(0).fill(`${day}T10:00`)
  await page.locator('input[type=datetime-local]').nth(1).fill(`${day}T12:00`)
  await page.getByRole('button', { name: 'Apply range', exact: true }).click()
}

test('custom dates and equal-duration changes query their exact historical windows', async ({ page }) => {
  const queries = await stub(page)
  await page.goto('/metrics-browser?q=cpu')
  await expect(page.locator('.ts-legend')).toHaveCount(1)
  for (const [index, day] of ['2026-10-01', '2026-10-02'].entries()) {
    await chooseRange(page, day)
    await expect.poll(() => queries.length).toBe(index + 2)
    expect(Number(queries.at(-1)!.searchParams.get('start'))).toBe(Date.parse(`${day}T10:00Z`) / 1000)
    expect(Number(queries.at(-1)!.searchParams.get('end'))).toBe(Date.parse(`${day}T12:00Z`) / 1000)
    await expect(page.locator('.ts-legend')).toHaveCount(1)
  }
})

test('absolute bounds survive share links, reloads, instant queries, and query history', async ({ page }) => {
  const queries = await stub(page)
  const from = '2026-10-01T10:00:00.000Z', to = '2026-10-01T12:00:00.000Z'
  await page.goto(`/metrics-browser?${new URLSearchParams({ q: 'cpu', from, to, tab: 'table' })}`)
  await expect.poll(() => queries.length).toBe(1)
  expect(queries[0]!.searchParams.get('time')).toBe(String(Date.parse(to) / 1000))
  await page.getByTitle('Copy shareable link', { exact: true }).click()
  const shared = new URL(await page.evaluate(() => (window as any).__sharedUrl))
  expect(shared.searchParams.get('from')).toBe(from)
  expect(shared.searchParams.get('to')).toBe(to)
  await page.reload()
  await expect.poll(() => queries.length).toBe(2)
  expect(queries[1]!.searchParams.get('time')).toBe(String(Date.parse(to) / 1000))
  // Selecting a relative preset clears custom bounds, then history restores them.
  await page.locator('.tp-trigger').click()
  await page.getByRole('button', { name: 'Last 1h', exact: true }).click()
  await expect.poll(() => queries.length).toBe(3)
  await page.locator('.qh-trigger').click()
  await page.locator('.qh-item').last().click()
  await expect.poll(() => queries.length).toBe(4)
  expect(queries.at(-1)!.searchParams.get('time')).toBe(String(Date.parse(to) / 1000))
})

test('invalid absolute links fail visibly without silently querying the present', async ({ page }) => {
  const queries = await stub(page)
  await page.goto('/metrics-browser?q=cpu&from=bad&to=2026-10-01T12:00:00Z')
  await expect(page.getByText('Choose a valid time range.', { exact: true })).toBeVisible()
  expect(queries).toEqual([])
})

test('metric browse cards refetch their sparklines for a changed absolute window', async ({ page }) => {
  const queries = await stub(page)
  await page.goto(`/metrics-browser?${new URLSearchParams({ mode: 'explore', from: '2026-10-01T10:00Z', to: '2026-10-01T12:00Z' })}`)
  await expect.poll(() => queries.length).toBe(1)
  expect(Number(queries[0]!.searchParams.get('end'))).toBe(Date.parse('2026-10-01T12:00Z') / 1000)
  await chooseRange(page, '2026-10-02')
  await expect.poll(() => queries.length).toBe(2)
  expect(Number(queries[1]!.searchParams.get('start'))).toBe(Date.parse('2026-10-02T10:00Z') / 1000)
  expect(Number(queries[1]!.searchParams.get('end'))).toBe(Date.parse('2026-10-02T12:00Z') / 1000)
})

test('relative-only pages offer presets without an unsupported custom-date control', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboards/relative')
  await page.locator('.tp-trigger').click()
  await expect(page.locator('input[type=datetime-local]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Last 6h', exact: true })).toBeVisible()
})
