import { test, expect, type Page } from '@playwright/test'

async function stubApi(page: Page) {
  const state = { down: true, probeCount: 0, failOnce: false, status: 503, ordinaryFailure: false }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const probe = path === '/api/v1/auth/me' && route.request().headers().accept === 'application/json'
    if (probe) {
      state.probeCount++
      const fails = state.down || (state.failOnce && state.probeCount === 1)
      await route.fulfill({ status: fails ? state.status : 401, body: '' })
      return
    }
    let body: unknown = { services: [], views: [], channels: [], series: [], values: [], keys: [], groups: [], users: [], links: [], skills: [], providers: [], mappings: [], sessions: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'api-test', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (state.ordinaryFailure && path === '/api/v1/profiles/series') {
      await route.fulfill({ status: 503, body: 'Unavailable' })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('shows on login, traps keyboard focus, and closes automatically on recovery', async ({ page }, info) => {
  const state = await stubApi(page)
  await page.goto('/login')
  await page.getByLabel('Username').fill('saved-name')
  const dialog = page.getByRole('dialog', { name: 'API unavailable' })
  await expect(dialog).toBeVisible()
  expect(state.probeCount).toBeGreaterThanOrEqual(2)
  await expect(dialog.getByRole('button', { name: 'Keep viewing' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Retry now' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Keep viewing' })).toBeFocused()
  await page.screenshot({ path: info.outputPath('api-unavailable-desktop.png'), animations: 'disabled' })
  state.down = false
  await expect(dialog).not.toBeVisible({ timeout: 8_000 })
  await expect(page.getByLabel('Username')).toHaveValue('saved-name')
  await expect(page.getByLabel('Username')).toBeFocused()
  await expect(page).toHaveURL(/\/login$/)
})

test('retry recovers in place on an authenticated page', async ({ page }) => {
  const state = await stubApi(page)
  await page.goto('/profiles?service=articles')
  const dialog = page.getByRole('dialog', { name: 'API unavailable' })
  await expect(dialog).toBeVisible()
  state.down = false
  await dialog.getByRole('button', { name: 'Retry now' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/\/profiles\?service=articles/)
})

test('mobile notice fits the viewport and Escape dismisses it for the current outage', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await stubApi(page)
  await page.goto('/login')
  const dialog = page.getByRole('dialog', { name: 'API unavailable' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('api-unavailable-mobile.png'), animations: 'disabled' })
  const before = state.probeCount
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => state.probeCount, { timeout: 8_000 }).toBeGreaterThan(before)
  await expect(dialog).not.toBeVisible()
})

test('a transient probe failure does not open the dialog', async ({ page }) => {
  const state = await stubApi(page)
  state.down = false
  state.failOnce = true
  await page.goto('/login')
  await expect.poll(() => state.probeCount).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('dialog', { name: 'API unavailable' })).not.toBeVisible()
})

test('an individual failed query does not make the API unavailable', async ({ page }) => {
  const state = await stubApi(page)
  state.down = false
  state.ordinaryFailure = true
  await page.goto('/profiles')
  await expect(page.getByRole('dialog', { name: 'API unavailable' })).not.toBeVisible()
  await expect.poll(() => state.probeCount).toBeGreaterThan(0)
  await expect(page).toHaveURL(/\/profiles/)
})

test('browser offline state is explained and recovers when the network returns', async ({ page, context }) => {
  const state = await stubApi(page)
  state.down = false
  await page.goto('/login')
  await expect.poll(() => state.probeCount).toBeGreaterThan(0)
  await context.setOffline(true)
  const dialog = page.getByRole('dialog', { name: 'API unavailable' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Your browser is offline.')
  await context.setOffline(false)
  await expect(dialog).not.toBeVisible()
})

test('detects an outage while an authenticated page is already open', async ({ page }) => {
  const state = await stubApi(page)
  state.down = false
  await page.goto('/profiles?service=articles')
  await expect.poll(() => state.probeCount).toBeGreaterThan(0)
  state.down = true
  const dialog = page.getByRole('dialog', { name: 'API unavailable' })
  await expect(dialog).toBeVisible({ timeout: 22_000 })
  await dialog.getByRole('button', { name: 'Keep viewing' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/\/profiles\?service=articles/)
})

test('shows the outage even when all API requests fail on initial load', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 502, body: 'Bad gateway' }))
  await page.goto('/services')
  await expect(page.getByRole('dialog', { name: 'API unavailable' })).toBeVisible()
})
