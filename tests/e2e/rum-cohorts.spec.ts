import { expect, test } from '@playwright/test'
import type { RumCohortReport } from '../../src/types'

const report: RumCohortReport = {
  as_of: '2026-11-23T12:00:00Z',
  cohort_start: '2026-10-12',
  cohort_end: '2026-11-23',
  coverage_start: '2026-10-12T00:00:00Z',
  coverage: { total_sessions: 500, missing_user_id_sessions: 62 },
  first_actions: ['Created an account', 'Started checkout'],
  cohorts: [
    { week_start: '2026-10-12', new_users: 400, returned: [180, 100, 0, 66, 80] },
    { week_start: '2026-11-16', new_users: 322, returned: [null, null, null, null, null] },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const { pathname } = new URL(route.request().url())
    const data = {
      '/api/v1/auth/me': { user: { id: 'reader', username: 'reader', role: 'viewer' } },
      '/api/v1/tenants': { tenants: [{ id: 'default', name: 'default', enabled: true }] },
      '/api/v1/rum/vitals': { vitals: [] },
      '/api/v1/rum/pages': { pages: [] },
      '/api/v1/rum/errors': { errors: [] },
      '/api/v1/rum/sessions': { sessions: [] },
    }[pathname] || {}
    await route.fulfill({ json: data })
  })
})

test('views returning users, filters on first action, and keeps session coverage app-wide', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/v1/rum/cohorts?*', async route => {
    const url = new URL(route.request().url())
    requests.push(url)
    await route.fulfill({
      json: url.searchParams.get('first_action')
        ? { ...report, cohorts: [{ week_start: '2026-10-12', new_users: 200, returned: [120, 50, 0, 40, 49] }] }
        : report,
    })
  })

  await page.goto('/rum/storefront?t=180')
  const nav = page.getByRole('navigation', { name: 'RUM application' })
  await nav.getByRole('link', { name: 'Returning users' }).click()
  await expect(nav.getByRole('link', { name: 'Returning users' })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL('/rum/storefront/returning-users?t=180')

  const table = page.getByRole('table', { name: 'Each row shows users first observed in that week and the share who returned in later weeks.' })
  await expect(table.getByRole('button', { name: /Week 1, 45%, 180 of 400 users returned/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(table.getByRole('row', { name: /^Nov 16/ }).getByText('Week not complete')).toHaveCount(5)
  const noReturns = table.getByRole('button', { name: /Week 3, 0%, 0 of 400 users returned/ })
  await noReturns.press('Enter')
  await expect(noReturns).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Oct 12 cohort' })).toContainText('0 of 400 users returned · Nov 2 to Nov 8')
  const meter = page.getByRole('meter', { name: 'Sessions missing a user ID' })
  await expect(meter).toHaveAttribute('aria-valuetext', '12.4%')
  await expect(page.getByText('62 of 500')).toBeVisible()
  expect(requests.at(-1)?.searchParams.get('app_name')).toBe('storefront')

  const action = page.getByRole('combobox', { name: 'First action' })
  await action.selectOption('Created an account')
  await expect(table.getByRole('button', { name: /Week 1, 60%, 120 of 200 users returned/ })).toBeVisible()
  await expect(meter).toHaveAttribute('aria-valuetext', '12.4%')
  expect(requests.at(-1)?.searchParams.get('first_action')).toBe('Created an account')

  await page.reload()
  await expect(action).toHaveValue('Created an account')
  await expect(table.getByRole('button', { name: /Week 1, 60%/ })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(table.getByRole('columnheader', { name: 'Week 5' })).toBeVisible()
  const fits = await page.locator('.retention-table').evaluate(element => element.scrollWidth > element.clientWidth)
  expect(fits).toBe(true)

  await nav.getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL('/rum/storefront?t=180')
  await expect(page.getByRole('button', { name: 'Last 3h', exact: true })).toBeVisible()
})

test('recovers from a query failure and explains missing user IDs', async ({ page }) => {
  let unavailable = true
  await page.route('**/api/v1/rum/cohorts?*', async route => {
    if (unavailable) {
      await route.fulfill({ status: 500, json: { error: 'query failed' } })
      return
    }
    await route.fulfill({
      json: { ...report, first_actions: [], cohorts: [], coverage: { total_sessions: 10, missing_user_id_sessions: 10 } },
    })
  })
  await page.goto('/rum/storefront/returning-users')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load cohorts' })).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('No weekly cohorts yet')).toBeVisible()
  await expect(page.getByText('Send stable pseudonymous user IDs', { exact: false })).toBeVisible()
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuetext', '100%')
})
