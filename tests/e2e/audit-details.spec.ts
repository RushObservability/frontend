import { expect, test, type Page } from '@playwright/test'

const event = {
  id: 'event-42',
  seq: 42,
  timestamp: '2026-09-13T20:23:01Z',
  tenant_id: 'default',
  actor_id: 'user-7',
  actor_name: 'admin',
  actor_type: 'user',
  action: 'settings.update',
  resource_type: 'setting',
  resource_id: 'rum_enabled',
  outcome: 'success',
  ip_address: '127.0.0.1',
  user_agent: 'Mozilla/5.0 test client with a deliberately long value that must wrap inside the detail panel',
  request_id: 'request-99',
  changes: JSON.stringify({ before: false, after: true }),
  description: 'Browser telemetry collection was enabled.',
  metadata: JSON.stringify({ source: 'settings' }),
  prev_hash: 'a'.repeat(64),
  hash: 'b'.repeat(64),
}

async function stubAudit(page: Page) {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {}
    if (path === '/api/v1/auth/me') {
      body = { user: { id: 'user-7', username: 'admin', display_name: 'Admin', role: 'admin' } }
    } else if (path === '/api/v1/tenants') {
      body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    } else if (path === '/api/v1/audit/verify') {
      body = { intact: true, checked: 42, first_broken_seq: null }
    } else if (path === '/api/v1/audit') {
      body = { events: [event], limit: 100, offset: 0, total: 1 }
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

for (const width of [1280, 390]) {
  test(`audit event details stay readable at ${width}px`, async ({ page }, testInfo) => {
    await stubAudit(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/audit')

    const row = page.getByRole('button', { name: /settings\.update/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    const detail = page.getByRole('region', { name: 'Details for settings.update' })
    await expect(detail.getByRole('heading', { name: 'Event record' })).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Request context' })).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Changes' })).toBeVisible()
    await expect(detail.getByText('Browser telemetry collection was enabled.')).toBeVisible()
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await detail.screenshot({ path: testInfo.outputPath(`audit-details-${width}.png`), animations: 'disabled' })

    await row.focus()
    await page.keyboard.press('Space')
    await expect(detail).toBeHidden()
  })
}
