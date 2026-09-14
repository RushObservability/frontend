import { test, expect, type Page } from '@playwright/test'

async function stubUsers(page: Page, count = 86, failGroups = false) {
  const state = {
    users: Array.from({ length: count }, (_, i) => ({
      id: String(i), username: i === 0 ? 'admin@example.com' : `demo-user-${String(i).padStart(3, '0')}`,
      display_name: i === 85 ? 'Alex Chen' : `Demo Person ${i}`, enabled: i % 2 === 0,
      tenant_id: 'default', created_at: '2026-09-13T12:00:00Z',
    })),
    failGroups,
  }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let body: unknown = { keys: [], groups: [], users: [], links: [], channels: [], skills: [], values: [], providers: [], mappings: [], sessions: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: '0', username: 'admin@example.com', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/users') body = { users: state.users }
    if (path === '/api/v1/groups') body = { groups: [
      { id: 'admins', name: 'Administrators', permissions: ['admin'] },
      { id: 'writers', name: 'Developers', permissions: ['write'] },
      { id: 'viewers', name: 'Viewers', permissions: ['read'] },
    ].map(group => ({ ...group, scopes: ['all'], tenant_ids: ['default'], description: '', system: true, created_at: '' })) }
    const membership = path.match(/^\/api\/v1\/users\/(\d+)\/groups$/)
    if (membership) {
      if (state.failGroups) {
        await route.fulfill({ status: 503, body: 'Group lookup unavailable' })
        return
      }
      body = { group_ids: [membership[1] === '0' ? 'admins' : Number(membership[1]) % 2 === 0 ? 'writers' : 'viewers'] }
    }
    const deletion = path.match(/^\/api\/v1\/users\/(\d+)$/)
    if (deletion && method === 'DELETE') {
      state.users = state.users.filter(user => user.id !== deletion[1])
      body = {}
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/settings#users')
  await expect(page.getByText('Loading users…', { exact: true })).toHaveCount(0)
  if (count) await expect(page.locator('#user-directory-table tbody tr')).toHaveCount(Math.min(count, 25))
  return state
}

test('paginates all users and searches beyond the current page', async ({ page }) => {
  await stubUsers(page)
  const rows = page.locator('#user-directory-table tbody tr')
  const footer = page.locator('.user-directory-footer')
  await expect(footer).toContainText('1–25 of 86 users')
  await expect(page.getByRole('button', { name: 'Previous page of users' })).toBeDisabled()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next page of users' }).click()
  await expect(rows).toHaveCount(11)
  await expect(footer).toContainText('76–86 of 86 users')
  await expect(page.getByRole('button', { name: 'Next page of users' })).toBeDisabled()
  const search = page.getByRole('searchbox', { name: 'Search users' })
  await search.fill('ALEX CHEN')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('demo-user-085')
  await expect(footer).toContainText('Page 1 of 1')
  await search.fill('admin@EXAMPLE.com')
  await expect(rows).toContainText('admin@example.com')
  await search.fill('does-not-exist')
  await expect(page.getByText('No matching users', { exact: true })).toBeVisible()
  await expect(footer).toContainText('0–0 of 0 users')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Rows per page').selectOption('50')
  await expect(rows).toHaveCount(50)
  await page.getByRole('button', { name: 'Next page of users' }).click()
  await expect(rows).toHaveCount(36)
  await page.getByLabel('Rows per page').selectOption('100')
  await expect(rows).toHaveCount(86)
  await expect(footer).toContainText('Page 1 of 1')
})

test('combines group search, role, and status filters', async ({ page }) => {
  await stubUsers(page)
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByLabel('Status', { exact: true }).selectOption('disabled')
  await page.getByRole('searchbox', { name: 'Search users' }).fill('Viewers demo-user')
  await expect(page.locator('.user-directory-footer')).toContainText('1–25 of 43 users')
  await page.getByLabel('Status', { exact: true }).selectOption('enabled')
  await expect(page.getByText('No matching users', { exact: true })).toBeVisible()
})

test('deleting the only row on the last page returns to a valid page', async ({ page }) => {
  await stubUsers(page, 26)
  await page.getByRole('button', { name: 'Next page of users' }).click()
  const rows = page.locator('#user-directory-table tbody tr')
  await expect(rows).toHaveCount(1)
  await rows.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('.delete-modal').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(rows).toHaveCount(25)
  await expect(page.locator('.user-directory-footer')).toContainText('Page 1 of 1')
})

test('failed group loading is visible and can be retried', async ({ page }) => {
  const state = await stubUsers(page, 2, true)
  await expect(page.getByText('Some user groups could not be loaded.', { exact: false })).toBeVisible()
  await expect(page.locator('#user-directory-table tbody tr').first()).toContainText('Unavailable')
  state.failGroups = false
  await page.getByRole('button', { name: 'Retry user group loading', exact: true }).click()
  await expect(page.getByText('Some user groups could not be loaded.', { exact: false })).toHaveCount(0)
  await expect(page.locator('#user-directory-table tbody tr').first()).toContainText('Admin')
})

for (const width of [1280, 390]) {
  test(`user search and pagination fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await stubUsers(page)
    const card = page.locator('#panel-users > .section-card').first()
    await card.screenshot({ path: testInfo.outputPath(`users-${width}.png`), animations: 'disabled' })
    for (const selector of ['.user-directory-toolbar', '.user-directory-footer']) {
      const control = page.locator(selector)
      expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      const box = await control.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
  })
}
