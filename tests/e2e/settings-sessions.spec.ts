import { test, expect, type Page } from '@playwright/test'

async function stubSettingsApi(page: Page, role: 'admin' | 'read' | 'write', denySessions = false) {
  const state = { sessionRequests: 0 }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {
      keys: [], groups: [], users: [], links: [], channels: [], skills: [],
      values: [], providers: [], mappings: [], sessions: [],
    }
    if (path === '/api/v1/auth/me') {
      body = { user: { id: 'test-user', username: 'tester', role } }
    }
    if (path === '/api/v1/tenants') {
      body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    }
    if (path === '/api/v1/auth/admin/sessions') {
      state.sessionRequests++
      if (denySessions) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Admin access required' }) })
        return
      }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

async function openSettings(page: Page, hash: string) {
  // License loading happens after the mount-time session load decision.
  const mounted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/license')
  await page.goto(`/settings${hash}`)
  await mounted
}

for (const hash of ['', '#general', '#users', '#not-a-settings-tab']) {
  test(`admin session loading does not depend on the URL hash: ${hash || 'none'}`, async ({ page }) => {
    const state = await stubSettingsApi(page, 'admin')
    await openSettings(page, hash)
    await expect.poll(() => state.sessionRequests).toBe(1)

    await page.getByRole('link', { name: 'Users', exact: true }).click()
    const inventory = page.locator('.session-inventory-card')
    await expect(inventory.getByText('No active sessions.', { exact: true })).toBeVisible()
    expect(state.sessionRequests).toBe(1)

    await inventory.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect.poll(() => state.sessionRequests).toBe(2)
  })
}

for (const role of ['read', 'write'] as const) {
  test(`${role} users cannot request the admin session inventory through a hash`, async ({ page }) => {
    const state = await stubSettingsApi(page, role)
    for (const hash of ['#users', '#general']) {
      await page.goto(`/settings${hash}`)
      await expect(page).toHaveURL(url => url.pathname === '/' && url.hash === '')
      await expect(page.getByRole('textbox', { name: 'Search traces and logs' })).toBeVisible()
      await expect(page.locator('.session-inventory-card')).toHaveCount(0)
      expect(state.sessionRequests).toBe(0)
    }
  })
}

test('server denial is shown without rendering session data', async ({ page }) => {
  const state = await stubSettingsApi(page, 'admin', true)
  await openSettings(page, '#users')
  const inventory = page.locator('.session-inventory-card')
  await expect(inventory.locator('.error-row')).toContainText('You do not have permission to perform this action.')
  await expect(inventory.locator('.session-grid')).toHaveCount(0)
  expect(state.sessionRequests).toBe(1)
})
