import { test, expect, type Page } from '@playwright/test'

// Use the same router navigation as a router-link, without a document reload.
async function navigate(page: Page, path: string) {
  await page.evaluate(async target => {
    const host = document.querySelector('#app') as Element & {
      __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } } }
    }
    await host.__vue_app__.config.globalProperties.$router.push(target)
  }, path)
}

async function stub(page: Page) {
  const reads: string[] = []
  const writes: Array<{ id: string; body: Record<string, unknown> }> = []
  let held: string | null = null
  let release = () => {}
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { deploys: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    const match = path.match(/^\/api\/v1\/dashboards\/(one|two)$/)
    if (match) {
      const id = match[1]!
      if (route.request().method() === 'GET') {
        reads.push(id)
        if (held === id) await new Promise<void>(resolve => { release = resolve })
      } else writes.push({ id, body: route.request().postDataJSON() })
      body = {
        id, name: `Dashboard ${id}`, description: `Description ${id}`,
        visibility: id === 'one' ? 'private' : 'tenant', tags: [id], variables: [], widgets: [],
        defaults: { time_range_minutes: 60, refresh_interval_secs: 0 },
      }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return { reads, writes, hold: (id: string) => { held = id }, release: () => { held = null; release() } }
}

test('resource navigation reloads dashboard identity and saves only its own fields', async ({ page }) => {
  const state = await stub(page)
  await page.goto('/dashboards/one')
  await expect(page.getByRole('heading', { name: 'Dashboard one', exact: true })).toBeVisible()
  await navigate(page, '/dashboards/two')
  await expect(page.getByRole('heading', { name: 'Dashboard two', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click()
  await page.getByLabel('Auto-refresh interval').selectOption('30')
  await page.getByRole('button', { name: 'Save as defaults', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0]).toMatchObject({ id: 'two', body: {
    name: 'Dashboard two', description: 'Description two', visibility: 'tenant', tags: ['two'],
  } })
  // Refresh/query URL changes keep the current page mounted.
  expect(state.reads).toEqual(['one', 'two'])
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Dashboard one', exact: true })).toBeVisible()
  expect(state.reads).toEqual(['one', 'two', 'one'])
})

test('a late response from a previous dashboard cannot replace the new page', async ({ page }) => {
  const state = await stub(page)
  state.hold('one')
  await page.goto('/dashboards/one')
  await expect.poll(() => state.reads).toContain('one')
  await navigate(page, '/dashboards/two')
  await expect(page.getByRole('heading', { name: 'Dashboard two', exact: true })).toBeVisible()
  const oldResponse = page.waitForResponse('**/api/v1/dashboards/one')
  state.release()
  await oldResponse
  await expect(page.getByRole('heading', { name: 'Dashboard two', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard one', exact: true })).toHaveCount(0)
})
