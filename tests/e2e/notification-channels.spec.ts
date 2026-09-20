import { test, expect, type Page, type Locator } from '@playwright/test'

// Dummy credentials only. Every API call is intercepted; tests never send real alerts.
type Case = {
  type: string
  label: string
  config: Record<string, unknown>
  fields: [string, string][]
  secrets: string[]
  secretInput?: string
  rotate?: Record<string, unknown>
}

const channels: Case[] = [
  { type: 'slack', label: 'Slack Webhook', config: { webhook_url: 'https://hooks.slack.com/services/test-secret' },
    fields: [['input[placeholder^="https://hooks.slack.com"]', 'https://hooks.slack.com/services/test-secret']],
    secrets: ['webhook_url'], secretInput: 'input[placeholder^="https://hooks.slack.com"]', rotate: { webhook_url: 'https://hooks.slack.com/services/rotated-secret' } },
  { type: 'slack_app', label: 'Slack App', config: { token: 'test-secret', channel: 'C01234', username: 'Rush On-call' },
    fields: [['input[type="password"]', 'test-secret'], ['input[placeholder="#alerts or C0123456789"]', 'C01234'], ['input[placeholder="Rush Alerts"]', 'Rush On-call']],
    secrets: ['token'], secretInput: 'input[type="password"]', rotate: { token: 'rotated-secret' } },
  { type: 'discord', label: 'Discord', config: { webhook_url: 'https://discord.com/api/webhooks/test-secret' },
    fields: [['input[placeholder^="https://discord.com"]', 'https://discord.com/api/webhooks/test-secret']],
    secrets: ['webhook_url'], secretInput: 'input[placeholder^="https://discord.com"]', rotate: { webhook_url: 'https://discord.com/api/webhooks/rotated-secret' } },
  { type: 'webhook', label: 'Webhook', config: { url: 'https://example.invalid/test-secret', method: 'PUT', headers: { Authorization: 'Bearer test-secret' } },
    fields: [['input[placeholder^="https://internal.company.com"]', 'https://example.invalid/test-secret'], ['select', 'PUT'], ['textarea', '{"Authorization":"Bearer test-secret"}']],
    secrets: ['url', 'headers'], secretInput: 'textarea', rotate: { headers: { Authorization: 'Bearer rotated-secret' } } },
  { type: 'alertmanager', label: 'Alertmanager', config: { url: 'https://example.invalid/test-secret', labels: { team: 'platform' } },
    fields: [['input[placeholder^="https://alertmanager"]', 'https://example.invalid/test-secret'], ['textarea', '{"team":"platform"}']],
    secrets: ['url'], secretInput: 'input[placeholder^="https://alertmanager"]', rotate: { url: 'https://example.invalid/rotated-secret' } },
  { type: 'pagerduty', label: 'PagerDuty', config: { routing_key: 'test-secret', region: 'eu', severity: 'warning' },
    fields: [['#pd-routing-key', 'test-secret'], ['#pd-region', 'eu'], ['#pd-severity', 'warning']],
    secrets: ['routing_key'], secretInput: '#pd-routing-key', rotate: { routing_key: 'rotated-secret' } },
  { type: 'rootly', label: 'Rootly', config: { url: 'https://webhooks.rootly.com/webhooks/incoming/generic_webhooks', token: 'test-secret' },
    fields: [['#rootly-webhook-url', 'https://webhooks.rootly.com/webhooks/incoming/generic_webhooks'], ['#rootly-bearer-secret', 'test-secret']],
    secrets: ['url', 'token'], secretInput: '#rootly-bearer-secret', rotate: { token: 'rotated-secret' } },
  // Email can still be edited if configured through the API. Creating it in the UI remains disabled.
  { type: 'email', label: 'Email', config: { recipients: 'oncall@example.invalid' },
    fields: [['input[placeholder="oncall@company.com, lead@company.com"]', 'oncall@example.invalid']], secrets: [] },
]

async function setup(page: Page, fixture: Case, existing = false) {
  const state = { saved: [] as any[], tested: 0, deleted: 0, failTest: false, failSave: false, config: { ...fixture.config }, channels: [] as any[] }
  const response = () => {
    const config: Record<string, unknown> = { ...state.config }
    for (const key of fixture.secrets) { delete config[key]; config[`${key}_configured`] = true }
    return { id: 'channel-1', name: `${fixture.label} on-call`, channel_type: fixture.type, config, enabled: true }
  }
  if (existing) state.channels = [response()]
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let status = 200
    let body: unknown = { keys: [], groups: [], users: [], channels: [], routes: [], links: [], skills: [], values: [], providers: [], mappings: [], sessions: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/channels' || path === '/api/v1/channels/channel-1') {
      if (method === 'POST' || method === 'PUT') {
        const data = route.request().postDataJSON()
        state.saved.push(data)
        if (state.failSave) { status = 400; body = { error: 'Invalid channel configuration' } }
        else {
          for (const [key, value] of Object.entries(data.config)) {
            if (!fixture.secrets.includes(key) || (value !== '' && value !== null)) state.config[key] = value
          }
          state.channels = [{ ...response(), name: data.name }]
          body = state.channels[0]
        }
      } else if (method === 'DELETE') { state.deleted++; state.channels = []; body = {} }
      else body = { channels: state.channels }
    }
    if (path === '/api/v1/channels/channel-1/test') {
      state.tested++
      status = state.failTest ? 502 : 200
      body = state.failTest ? { error: 'Notification delivery failed' } : { ok: true, message: 'Test notification sent successfully' }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/settings#alerting')
  return state
}

async function fill(form: Locator, fields: Case['fields']) {
  for (const [selector, value] of fields) {
    const field = form.locator(selector)
    if (selector === 'select' || selector === '#pd-region' || selector === '#pd-severity') await field.selectOption(value)
    else await field.fill(value)
  }
}

for (const fixture of channels) {
  if (fixture.type !== 'email') {
    test(`${fixture.label}: creation validates required fields and sends the complete config`, async ({ page }) => {
      const state = await setup(page, fixture)
      await page.getByRole('button', { name: '+ Add Channel', exact: true }).click()
      const form = page.locator('.channel-form')
      await form.locator('.channel-type-card').filter({ has: page.locator('.ct-label', { hasText: new RegExp(`^${fixture.label}$`) }) }).click()
      await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await fill(form, fixture.fields)
      await form.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(() => state.saved.length).toBe(1)
      expect(state.saved[0]).toEqual({ name: fixture.label, channel_type: fixture.type, config: fixture.config })
      await expect(form).toHaveCount(0)
    })
  }

  test(`${fixture.label}: editing preserves stored secrets and allows rotation`, async ({ page }) => {
    const state = await setup(page, fixture, true)
    const panel = page.locator('#panel-alerting')
    await panel.getByRole('button', { name: 'Edit', exact: true }).click()
    const form = page.locator('.channel-form')
    for (const input of await form.locator('input, textarea').all()) {
      expect(await input.inputValue()).not.toContain('test-secret')
    }
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => state.saved.length).toBe(1)
    for (const key of fixture.secrets) expect(state.saved[0].config[key] ?? '').toBe('')
    expect(state.config).toEqual(fixture.config)
    if (fixture.rotate && fixture.secretInput) {
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      const value = Object.values(fixture.rotate)[0]
      await form.locator(fixture.secretInput).fill(typeof value === 'string' ? value : JSON.stringify(value))
      await form.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(() => state.saved.length).toBe(2)
      expect(state.saved[1].config).toMatchObject(fixture.rotate)
      expect(state.config).toEqual({ ...fixture.config, ...fixture.rotate })
    }
  })

  test(`${fixture.label}: Test shows failures and allows a successful retry`, async ({ page }) => {
    const state = await setup(page, fixture, true)
    const panel = page.locator('#panel-alerting')
    state.failTest = true
    await panel.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.getByText('Test failed', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    state.failTest = false
    await panel.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.getByText('Test notification sent', { exact: true })).toBeVisible()
    expect(state.tested).toBe(2)
  })
}

test('Email creation stays disabled until SMTP setup is available in the UI', async ({ page }) => {
  await setup(page, channels[0]!)
  await page.getByRole('button', { name: '+ Add Channel', exact: true }).click()
  await expect(page.locator('.channel-type-card').filter({ has: page.locator('.ct-label', { hasText: /^Email$/ }) })).toBeDisabled()
})

test('failed saves keep the form open and do not lose entered settings', async ({ page }) => {
  const fixture = channels[0]!
  const state = await setup(page, fixture, true)
  state.failSave = true
  await page.locator('#panel-alerting').getByRole('button', { name: 'Edit', exact: true }).click()
  const form = page.locator('.channel-form')
  await form.locator(fixture.secretInput!).fill('https://hooks.slack.com/services/rotated-secret')
  page.once('dialog', dialog => dialog.accept())
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.saved.length).toBe(1)
  await expect(form).toBeVisible()
  await expect(form.locator(fixture.secretInput!)).toHaveValue('https://hooks.slack.com/services/rotated-secret')
  state.failSave = false
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(form).toHaveCount(0)
})
