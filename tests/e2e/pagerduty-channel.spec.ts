import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, existing = false) {
  const state = { saved: [] as any[], tests: 0, channels: existing ? [{
    id: 'pd-1', name: 'Production PagerDuty', channel_type: 'pagerduty', enabled: true,
    config: { routing_key_configured: true, region: 'eu', severity: 'error' },
  }] : [] as any[] }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { keys: [], groups: [], users: [], channels: [], routes: [], links: [], skills: [], values: [], providers: [], mappings: [], sessions: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/channels' || path === '/api/v1/channels/pd-1') {
      if (['POST', 'PUT'].includes(route.request().method())) {
        const data = route.request().postDataJSON()
        state.saved.push(data)
        const channel = { id: 'pd-1', name: data.name, channel_type: 'pagerduty', enabled: true,
          config: { routing_key_configured: true, region: data.config.region, severity: data.config.severity } }
        state.channels = [channel]
        body = channel
      } else body = { channels: state.channels }
    }
    if (path === '/api/v1/channels/pd-1/test') {
      state.tests++
      body = { ok: true, message: 'Test notification sent successfully' }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('PagerDuty is enabled with setup guidance, masked key, region and severity', async ({ page }, info) => {
  const state = await stub(page)
  await page.goto('/settings#alerting')
  await page.getByRole('button', { name: '+ Add Channel', exact: true }).click()
  const form = page.locator('.channel-form')
  const choice = form.getByRole('button', { name: /PagerDuty.*Send alerts/ })
  await expect(choice).toBeEnabled()
  await expect(choice).not.toContainText('Coming soon')
  await choice.click()
  await expect(form.getByLabel('Account region')).toHaveValue('us')
  await expect(form.getByLabel('Alert severity')).toHaveValue('critical')
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(form.getByLabel('Integration key')).toHaveAttribute('type', 'password')
  await form.getByLabel('Integration key').fill('test-integration-key')
  await form.getByLabel('Account region').selectOption('eu')
  await form.getByLabel('Alert severity').selectOption('warning')
  await expect(form.getByText(/may page responders/)).toBeVisible()
  await form.screenshot({ path: info.outputPath('pagerduty-setup.png'), animations: 'disabled' })
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(1)
  expect(state.saved[0]).toMatchObject({ name: 'PagerDuty', channel_type: 'pagerduty',
    config: { routing_key: 'test-integration-key', region: 'eu', severity: 'warning' } })
  await page.locator('#panel-alerting').getByRole('button', { name: 'Test', exact: true }).click()
  await expect.poll(() => state.tests).toBe(1)
})

test('editing PagerDuty preserves the redacted key and supports rotation on mobile', async ({ page }, info) => {
  const state = await stub(page, true)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/settings#alerting')
  await page.locator('#panel-alerting').getByRole('button', { name: 'Edit', exact: true }).click()
  const form = page.locator('.channel-form')
  await expect(form.getByLabel('Integration key')).toHaveValue('')
  await expect(form.getByLabel('Account region')).toHaveValue('eu')
  await expect(form.getByLabel('Alert severity')).toHaveValue('error')
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await form.screenshot({ path: info.outputPath('pagerduty-mobile.png'), animations: 'disabled' })
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(1)
  expect(state.saved[0].config).toEqual({ routing_key: '', region: 'eu', severity: 'error' })
  await page.locator('#panel-alerting').getByRole('button', { name: 'Edit', exact: true }).click()
  await form.getByLabel('Integration key').fill('replacement-key')
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(2)
  expect(state.saved[1].config.routing_key).toBe('replacement-key')
})
