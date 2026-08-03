import { test, expect, type Page } from '@playwright/test'

async function stubAuthenticatedShell(page: Page, tenantNames = ['default']) {
  await page.route('**/api/v1/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }))
  // Register the specific route last: Playwright evaluates page routes in
  // reverse registration order, so this identity response wins over the
  // generic API stub above.
  await page.route('**/api/v1/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'e2e-user', username: 'e2e', display_name: 'E2E User', role: 'admin' },
    }),
  }))
  await page.route('**/api/v1/tenants', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tenants: tenantNames.map((name) => ({ id: name, name, enabled: true })),
    }),
  }))
}

test('login form exposes labels, validation, and an assertive error', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: /rush observability/i })).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()

  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Username and password are required.')
})

test('protected redirects remove sensitive query values', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, body: '' }))

  await page.goto('/services?secret=must-not-leak&service=payments')

  await expect(page).toHaveURL(/\/login\?redirect=\/services$/)
  expect(page.url()).not.toContain('must-not-leak')
  expect(page.url()).not.toContain('payments')
})

test('authenticated shell provides a skip link and reduced-motion behavior', async ({ page }) => {
  await stubAuthenticatedShell(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/services')

  const skipLink = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skipLink).toBeAttached()
  await skipLink.focus()
  await expect(skipLink).toBeFocused()
  await expect(page.locator('main#main-content')).toHaveAttribute('tabindex', '-1')

  const transitionDuration = await skipLink.evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001)
  await expect(page.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeVisible()
})

test('shell navigation stays scrollable on a phone-sized viewport', async ({ page }) => {
  await stubAuthenticatedShell(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/services')

  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.sidebar-nav')).toHaveCSS('overflow-x', 'auto')
  await expect(page.locator('.main')).toBeVisible()
})

test('SSO status exposes a labeled provider link on the login page', async ({ page }) => {
  await page.route('**/api/v1/sso/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ enabled: true, provider_name: 'Okta' }),
  }))
  await page.goto('/login')

  const ssoLink = page.getByRole('link', { name: 'Sign in with Okta' })
  await expect(ssoLink).toHaveAttribute('href', '/auth/sso/login')
})

test('tenant switcher exposes its menu and persists the selected tenant', async ({ page }) => {
  await stubAuthenticatedShell(page, ['default', 'customer-a'])
  await page.goto('/services')

  const switcher = page.getByRole('button', { name: /default/i }).filter({ has: page.locator('.tenant-name') })
  await expect(switcher).toHaveAttribute('aria-expanded', 'false')
  await switcher.click()
  await expect(page.getByRole('menu', { name: 'Tenants' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'customer-a' })).toBeVisible()

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.getByRole('menuitem', { name: 'customer-a' }).click(),
  ])
  await expect(page.getByRole('button', { name: /customer-a/i }).filter({ has: page.locator('.tenant-name') })).toBeVisible()
})

test('investigation form is labeled and can complete a streamed result', async ({ page }) => {
  await stubAuthenticatedShell(page)
  await page.route('**/api/v1/investigate', route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: [
      'data: {"type":"session_created","session_id":"e2e-session"}',
      'data: {"type":"summary","text":"The service is healthy.","kind":"final"}',
      'data: {"type":"done","rounds":1,"prompt_tokens":10,"completion_tokens":5}',
      '',
    ].join('\n\n'),
  }))
  await page.goto('/investigate')

  const question = page.getByLabel('Ask a question about your system')
  await expect(question).toBeVisible()
  await question.fill('Why is the checkout service slow?')
  await page.getByRole('button', { name: 'Start Investigation' }).click()

  await expect(page.getByText('Investigation complete', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('The service is healthy.')).toBeVisible()
})
