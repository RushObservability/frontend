import { test, expect, type Page } from '@playwright/test'

async function stubSettingsApi(page: Page, role: 'admin' | 'read' | 'write', denySessions = false) {
  const state = {
    sessionRequests: 0, policyRequests: 0, activityRequests: 0, expired: false,
    idleSeconds: 7200, remainingSeconds: 7200, rejectPolicySave: false,
    savedTimeouts: [] as number[],
  }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {
      keys: [], groups: [], users: [], links: [], channels: [], skills: [],
      values: [], providers: [], mappings: [], sessions: [],
    }
    if (path === '/api/v1/auth/me' || path === '/api/v1/auth/activity') {
      if (path.endsWith('/activity')) state.activityRequests++
      if (state.expired) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Session expired"}' })
        return
      }
      body = { user: { id: 'test-user', username: 'tester', role }, session: {
        idle_timeout_seconds: state.idleSeconds, idle_remaining_seconds: state.remainingSeconds, activity_interval_seconds: 300,
      } }
    }
    if (path === '/api/v1/settings/session-policy') {
      state.policyRequests++
      if (route.request().method() === 'PUT') {
        if (state.rejectPolicySave) {
          await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Denied"}' })
          return
        }
        state.idleSeconds = route.request().postDataJSON().idle_timeout_seconds
        state.remainingSeconds = state.idleSeconds
        state.savedTimeouts.push(state.idleSeconds)
      }
      body = { idle_timeout_seconds: state.idleSeconds, absolute_timeout_seconds: 86400, min_idle_timeout_seconds: 60, default_idle_timeout_seconds: 7200 }
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
      expect(state.policyRequests).toBe(0)
    }
  })
}

test('admin idle timeout defaults to two hours and saves minutes as seconds', async ({ page }, testInfo) => {
  const state = await stubSettingsApi(page, 'admin')
  await openSettings(page, '#users')
  const card = page.locator('.session-timeout-card')
  await expect(card).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Idle logout', exact: true })).toHaveCount(1)
  await expect(page.locator('#idle-timeout-minutes')).toHaveCount(1)
  const input = card.getByLabel('Idle timeout in minutes')
  await expect(input).toHaveValue('120')
  const save = card.getByRole('button', { name: 'Save idle timeout' })
  await expect(save).toBeDisabled()
  for (const invalid of ['0', '1441', '1.5', '']) {
    await input.fill(invalid)
    await expect(save).toBeDisabled()
  }
  await input.fill('90')
  await save.click()
  await expect(card.getByRole('status')).toHaveText('Idle timeout saved.')
  expect(state.savedTimeouts).toEqual([5400])
  await expect(save).toBeDisabled()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await card.screenshot({ path: testInfo.outputPath(`idle-timeout-${width}.png`) })
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('rejected idle timeout changes keep the draft and show the error', async ({ page }) => {
  const state = await stubSettingsApi(page, 'admin')
  state.rejectPolicySave = true
  await openSettings(page, '#users')
  const card = page.locator('.session-timeout-card')
  await card.getByLabel('Idle timeout in minutes').fill('30')
  await card.getByRole('button', { name: 'Save idle timeout' }).click()
  await expect(card.getByRole('alert')).toContainText('permission')
  await expect(card.getByLabel('Idle timeout in minutes')).toHaveValue('30')
  expect(state.savedTimeouts).toEqual([])
})

test('an idle page returns to login at the server deadline without activity renewals', async ({ page }) => {
  await page.clock.install()
  const state = await stubSettingsApi(page, 'admin')
  await openSettings(page, '#users')
  await expect(page.getByLabel('Idle timeout in minutes')).toHaveValue('120')
  state.expired = true
  await page.clock.fastForward('02:00:01')
  await expect(page).toHaveURL(/\/login\?.*expired=1/)
  expect(state.activityRequests).toBe(0)
})

test('activity renews through POST while another tab can keep the shared session alive', async ({ page }) => {
  await page.clock.install()
  const state = await stubSettingsApi(page, 'admin')
  state.remainingSeconds = 60
  await openSettings(page, '#users')
  await expect(page.getByLabel('Idle timeout in minutes')).toHaveValue('120')
  // Simulate a cookie renewed by another tab. The deadline check is read-only.
  state.remainingSeconds = 7200
  await page.clock.fastForward('01:01')
  await expect(page).toHaveURL(/\/settings#users$/)
  expect(state.activityRequests).toBe(0)
  const activityResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/activity'))
  await page.getByLabel('Idle timeout in minutes').click()
  await (await activityResponse).finished()
  await page.clock.runFor(100)
  await expect.poll(() => state.activityRequests).toBe(1)
  state.expired = true
  await page.clock.fastForward('02:00:01')
  await expect(page).toHaveURL(/\/login\?.*expired=1/)
})

test('server denial is shown without rendering session data', async ({ page }) => {
  const state = await stubSettingsApi(page, 'admin', true)
  await openSettings(page, '#users')
  const inventory = page.locator('.session-inventory-card')
  await expect(inventory.locator('.error-row')).toContainText('You do not have permission to perform this action.')
  await expect(inventory.locator('.session-grid')).toHaveCount(0)
  expect(state.sessionRequests).toBe(1)
})

for (const width of [1280, 390]) {
  test(`empty alert channel icon stays beside its text at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await stubSettingsApi(page, 'admin')
    await openSettings(page, '#alerting')
    const empty = page.locator('#panel-alerting .empty-state-block')
    await expect(empty).toContainText('No alert channels yet')
    await empty.screenshot({ path: testInfo.outputPath('empty-alert-channel.png'), animations: 'disabled' })
    const icon = await empty.locator('.empty-state-block-icon').boundingBox()
    const copy = await empty.locator('.empty-state-block-copy').boundingBox()
    expect(icon).not.toBeNull()
    expect(copy).not.toBeNull()
    expect(icon!.x + icon!.width).toBeLessThan(copy!.x)
    expect(Math.abs(icon!.y + icon!.height / 2 - copy!.y - copy!.height / 2)).toBeLessThan(2)
    const box = await empty.boundingBox()
    const noticeCenter = (icon!.x + copy!.x + copy!.width) / 2
    expect(Math.abs(noticeCenter - box!.x - box!.width / 2)).toBeLessThan(2)
    expect(await empty.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
}
