import { test, expect, type Page } from '@playwright/test'
import { queryUrl, queryReply } from './query-contract'

async function stub(page: Page) {
  const requests: URL[] = [], aborted: string[] = []
  let release = () => {}
  page.on('requestfailed', request => {
    if (queryUrl(request).pathname === '/prom/api/v1/query_range') aborted.push(queryUrl(request).searchParams.get('query')!)
  })
  await page.route('**/api/v1/**', async route => {
    const url = queryUrl(route.request()), path = url.pathname
    let body: unknown = { services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path.startsWith('/prom/')) body = { status: 'success', data: [] }
    if (path.endsWith('/query_range') || path === '/prom/api/v1/query') {
      requests.push(url)
      const expression = url.searchParams.get('query')!
      const range = path.endsWith('/query_range')
      if (range && expression === 'old_cpu') await new Promise<void>(resolve => { release = resolve })
      const end = Number(url.searchParams.get('end') || Date.now() / 1000)
      body = { status: 'success', data: { resultType: range ? 'matrix' : 'vector', result: [{ metric: { __name__: expression },
        ...(range ? { values: [[end - 60, '1'], [end, '2']] } : { value: [end, '2'] }),
      }] } }
    }
    try { await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) }) } catch { /* cancelled request */ }
  })
  return { requests, aborted, release: () => release() }
}

async function startOldQuery(page: Page, state: Awaited<ReturnType<typeof stub>>) {
  await page.goto('/metrics-browser')
  const editor = page.getByRole('combobox', { name: 'Query expression' })
  await editor.fill('old_cpu')
  await editor.press('Control+Enter')
  await expect.poll(() => state.requests.length).toBe(1)
  return editor
}

test('a newer keyboard execution owns data, errors, busy state, and URL', async ({ page }) => {
  const state = await stub(page)
  const editor = await startOldQuery(page, state)
  await editor.fill('new_cpu')
  await editor.press('Control+Enter')
  await expect(page.locator('.ts-legend')).toContainText('new_cpu')
  await expect.poll(() => state.aborted).toContain('old_cpu')
  state.release()
  await page.waitForTimeout(100)
  await expect(page.locator('.ts-legend')).toContainText('new_cpu')
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled()
  expect(new URL(page.url()).searchParams.get('q')).toBe('new_cpu')
  await expect(page.getByText('The request was aborted.', { exact: true })).toHaveCount(0)
})

test('clear cancels a pending read and cannot resurrect its results', async ({ page }) => {
  const state = await stub(page)
  const editor = await startOldQuery(page, state)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect.poll(() => state.aborted).toContain('old_cpu')
  state.release()
  await page.waitForTimeout(100)
  await expect(editor).toHaveValue('')
  await expect(page.locator('.ts-legend')).toHaveCount(0)
})

test('switching query tabs during a pending request starts the selected query type', async ({ page }) => {
  const state = await stub(page)
  await startOldQuery(page, state)
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect.poll(() => state.requests.some(url => url.pathname === '/prom/api/v1/query')).toBe(true)
  await expect.poll(() => state.aborted).toContain('old_cpu')
  state.release()
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled()
  await expect(page.locator('.ts-legend')).toHaveCount(0)
})

test('leaving Metrics cancels its pending query', async ({ page }) => {
  const state = await stub(page)
  await startOldQuery(page, state)
  await page.getByRole('link', { name: 'Services', exact: true }).click()
  await expect.poll(() => state.aborted).toContain('old_cpu')
  state.release()
  await expect(page).toHaveURL(/\/services$/)
})
