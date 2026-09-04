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

test('phone navigation keeps primary destinations visible and exposes the full menu', async ({ page }) => {
  await stubAuthenticatedShell(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/services')

  await expect(page.locator('.topbar')).toBeVisible()
  const mobileNavigation = page.getByRole('navigation', { name: 'Primary navigation' })
    .filter({ has: page.getByRole('button', { name: 'More' }) })
  await expect(mobileNavigation).toBeVisible()
  await expect(mobileNavigation.getByRole('link', { name: 'Explore' })).toBeVisible()
  await expect(mobileNavigation.getByRole('link', { name: 'Services' })).toHaveAttribute('aria-current', 'page')

  await mobileNavigation.getByRole('button', { name: 'More' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigate' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(page.locator('.main')).toBeVisible()
})

test('command palette is an accessible combobox and returns focus when closed', async ({ page }) => {
  await stubAuthenticatedShell(page)
  await page.goto('/services')

  const openSearch = page.getByRole('button', { name: 'Open global search' })
  await openSearch.click()

  const palette = page.getByRole('dialog', { name: 'Command palette' })
  const search = palette.getByRole('combobox', { name: 'Search commands' })
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('aria-controls')
  await expect(palette.getByRole('option', { name: /Services/ })).toHaveAttribute('aria-selected', 'false')

  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  await expect(openSearch).toBeFocused()
})

test('SSO status exposes a labeled provider link on the login page', async ({ page }) => {
  await page.route('**/api/v1/sso/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ enabled: true, provider_name: 'Okta' }),
  }))
  await page.goto('/login')

  const ssoLink = page.getByRole('link', { name: 'Sign in with Okta' })
  await expect(ssoLink).toHaveAttribute('href', '/auth/sso/login?redirect=%2F')
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

test('saved SRE investigation opens its transcript without rerunning', async ({ page }) => {
  await stubAuthenticatedShell(page)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '')
  let investigationRequests = 0

  await page.route('**/api/v1/sessions?limit=8', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessions: [{
        id: 'saved-session',
        tenant_id: 'default',
        title: 'Checkout latency',
        status: 'completed',
        template_id: '',
        created_by: 'e2e-user',
        created_at: twoHoursAgo,
        updated_at: twoHoursAgo,
      }],
    }),
  }))
  await page.route('**/api/v1/sessions/saved-session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      session: {
        id: 'saved-session',
        tenant_id: 'default',
        title: 'Checkout latency',
        status: 'completed',
        template_id: '',
        created_by: 'e2e-user',
        created_at: twoHoursAgo,
        updated_at: twoHoursAgo,
      },
      turns: [
        {
          id: 'turn-user',
          session_id: 'saved-session',
          turn_index: 0,
          role: 'user',
          content: 'Why is checkout slow?',
          tool_calls: '[]',
          report_kind: '',
          created_at: twoHoursAgo,
        },
        {
          id: 'turn-assistant',
          session_id: 'saved-session',
          turn_index: 1,
          role: 'assistant',
          content: 'Database saturation was the cause.',
          tool_calls: JSON.stringify([
            { type: 'tool_call', name: 'search_logs', args: { service: 'checkout' } },
            { type: 'tool_result', name: 'search_logs', data: 'Found three timeout errors.' },
          ]),
          report_kind: 'final',
          created_at: twoHoursAgo,
        },
      ],
    }),
  }))
  await page.route('**/api/v1/investigate', route => {
    investigationRequests += 1
    return route.fulfill({ status: 500, body: 'A saved session must not start a new run.' })
  })

  await page.goto('/sre-agent')

  await expect(page.getByText('2h ago', { exact: true })).toBeVisible()
  const savedInvestigation = page.getByRole('link', { name: 'Checkout latency' })
  await expect(savedInvestigation).toHaveAttribute('href', '/sre-agent/saved-session')
  await savedInvestigation.click()
  await expect(page).toHaveURL(/\/sre-agent\/saved-session$/)
  await expect(page.getByText('SAVED INVESTIGATION', { exact: true })).toBeVisible()
  await expect(page.getByText('"Why is checkout slow?"', { exact: true })).toBeVisible()
  await expect(page.getByText('search_logs', { exact: true })).toBeVisible()
  await expect(page.getByText('Found three timeout errors.', { exact: true })).toBeVisible()
  await expect(page.getByText('Database saturation was the cause.', { exact: true })).toBeVisible()
  expect(investigationRequests).toBe(0)

  await page.reload()
  await expect(page.getByText('SAVED INVESTIGATION', { exact: true })).toBeVisible()
  await expect(page.getByText('Database saturation was the cause.', { exact: true })).toBeVisible()
  expect(investigationRequests).toBe(0)
})
