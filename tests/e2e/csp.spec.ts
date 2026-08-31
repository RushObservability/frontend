import { test, expect, type Page } from '@playwright/test'

declare global {
  interface Window {
    __cspViolations?: Array<{ directive: string; disposition: string }>
  }
}

async function stubApi(page: Page, authenticated: boolean) {
  await page.route('**/api/v1/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }))
  await page.route('**/api/v1/auth/me', route => route.fulfill({
    status: authenticated ? 200 : 401,
    contentType: 'application/json',
    body: authenticated
      ? JSON.stringify({ user: { id: 'csp-user', username: 'csp', display_name: 'CSP Test', role: 'admin' } })
      : '{}',
  }))
  await page.route('**/api/v1/tenants', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tenants: [{ id: 'default', name: 'default', enabled: true }] }),
  }))
}

test('production CSP covers login, Explore, dashboards, SSO setup, and RUM replay', async ({ browser }) => {
  const pages = [
    { path: '/login', authenticated: false },
    { path: '/?mode=traces', authenticated: true },
    { path: '/dashboards/csp-test-dashboard', authenticated: true },
    { path: '/setup/sso', authenticated: false },
    { path: '/rum/csp-app/replay/csp-session', authenticated: true },
  ]

  for (const example of pages) {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      window.__cspViolations = []
      document.addEventListener('securitypolicyviolation', event => {
        window.__cspViolations?.push({
          directive: event.effectiveDirective,
          disposition: event.disposition,
        })
      })
    })
    await stubApi(page, example.authenticated)
    await page.goto(example.path)
    await expect(page.locator('body')).toBeVisible()
    await page.waitForTimeout(150)
    const violations = await page.evaluate(() => window.__cspViolations || [])
    expect(violations, `${example.path} emitted CSP violations`).toEqual([])
    await page.close()
  }
})
