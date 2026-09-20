import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, existing = false) {
  const state = { saved: [] as any[], tests: 0, channels: existing ? [{
    id: 'rootly-1', name: 'Production Rootly', channel_type: 'rootly', enabled: true,
    config: { url_configured: true, token_configured: true },
  }] : [] as any[] }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { keys: [], groups: [], users: [], channels: [], routes: [], links: [], skills: [], values: [], providers: [], mappings: [], sessions: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/channels' || path === '/api/v1/channels/rootly-1') {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        const data = route.request().postDataJSON()
        state.saved.push(data)
        const channel = { id: 'rootly-1', name: data.name, channel_type: 'rootly', enabled: true, config: { url_configured: true, token_configured: true } }
        state.channels = [channel]
        body = channel
      } else body = { channels: state.channels }
    }
    if (path === '/api/v1/channels/rootly-1/test') {
      state.tests++
      body = { ok: true, message: 'Test notification sent successfully' }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('Rootly replaces Opsgenie and saves a source URL and masked bearer secret', async ({ page }, info) => {
  const state = await stub(page)
  await page.goto('/settings#alerting')
  await page.getByRole('button', { name: '+ Add Channel', exact: true }).click()
  const form = page.locator('.channel-form')
  await expect(form.getByRole('button', { name: /OpsGenie/i })).toHaveCount(0)
  await form.getByRole('button', { name: /Rootly.*Send alerts/ }).click()
  await expect(form.getByLabel('Rootly webhook URL')).toHaveValue('https://webhooks.rootly.com/webhooks/incoming/generic_webhooks')
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(form.getByLabel('Bearer secret')).toHaveAttribute('type', 'password')
  await form.getByLabel('Bearer secret').fill('test-source-secret')
  await expect(form.getByText('$.external_id', { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('rootly-setup.png'), fullPage: true, animations: 'disabled' })
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(1)
  expect(state.saved[0]).toMatchObject({ name: 'Rootly', channel_type: 'rootly', config: { url: 'https://webhooks.rootly.com/webhooks/incoming/generic_webhooks', token: 'test-source-secret' } })
  await page.locator('#panel-alerting').getByRole('button', { name: 'Test', exact: true }).click()
  await expect.poll(() => state.tests).toBe(1)
})

test('editing Rootly preserves redacted secrets and allows rotating the token', async ({ page }, info) => {
  const state = await stub(page, true)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/settings#alerting')
  await page.locator('#panel-alerting').getByRole('button', { name: 'Edit', exact: true }).click()
  const form = page.locator('.channel-form')
  await expect(form.getByLabel('Rootly webhook URL')).toHaveValue('')
  await expect(form.getByLabel('Bearer secret')).toHaveValue('')
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('rootly-mobile.png'), fullPage: true, animations: 'disabled' })
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(1)
  expect(state.saved[0].config).toEqual({ url: '', token: '' })
  await page.locator('#panel-alerting').getByRole('button', { name: 'Edit', exact: true }).click()
  await form.getByLabel('Bearer secret').fill('replacement-secret')
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(2)
  expect(state.saved[1].config).toEqual({ url: '', token: 'replacement-secret' })
})
