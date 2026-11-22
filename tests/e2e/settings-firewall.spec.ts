import { expect, test } from '@playwright/test'
import type { MetricFirewallInput, MetricFirewallPreviewResult, MetricFirewallSample } from '../../src/types'

test('previews a firewall draft and retests after a concurrent policy change', async ({ page }) => {
  const previews: Array<{ rule: MetricFirewallInput; samples: MetricFirewallSample[] }> = []
  const saves: MetricFirewallInput[] = []
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/auth/me') {
      return route.fulfill({ json: { user: { id: 'admin', username: 'admin', role: 'admin' } } })
    }
    if (pathname === '/api/v1/tenants') {
      return route.fulfill({ json: { tenants: [{ id: 'default', name: 'default', enabled: true }] } })
    }
    if (pathname === '/api/v1/metric-firewall/preview') {
      const body = request.postDataJSON()
      previews.push(body)
      const result: MetricFirewallPreviewResult = {
        policy_revision: `policy-${previews.length}`,
        sampled: 2,
        duplicates: 0,
        changed: 2,
        blocked: 0,
        output_identities: 1,
        collisions: [{
          id: 1,
          identity: { __name__: 'http_requests_total', service_name: 'payments', route: '/charge' },
          series_count: 2,
          introduced: true,
        }],
        rows: body.samples.slice(0, 2).map((input: MetricFirewallSample) => ({
          input,
          current: { labels: input.labels ?? {}, matched_rules: [] },
          proposed: { labels: { route: '/charge' }, matched_rules: [body.rule.name] },
          collision_id: 1,
        })),
      }
      return route.fulfill({ json: result })
    }
    if (pathname === '/api/v1/metric-firewall') {
      if (request.method() === 'POST') {
        saves.push(request.postDataJSON())
        if (saves.length === 1) return route.fulfill({ status: 409, body: 'Firewall rules changed.' })
        return route.fulfill({ status: 201, json: {} })
      }
      return route.fulfill({ json: { rules: [] } })
    }
    return route.fulfill({
      json: { keys: [], groups: [], users: [], links: [], channels: [], skills: [], values: [], providers: [], mappings: [], sessions: [], routes: [] },
    })
  })

  await page.goto('/settings#firewall')
  await page.getByRole('button', { name: 'Add Rule' }).click()
  const drawer = page.getByRole('dialog', { name: 'Firewall rule' })
  const testRule = drawer.getByRole('button', { name: 'Test rule' })
  const createRule = drawer.getByRole('button', { name: 'Create Rule' })
  await expect(testRule).toBeDisabled()
  await drawer.getByRole('button', { name: /^Strip labels/ }).click()
  await drawer.getByPlaceholder('e.g. http_requests_total').fill('http_requests_total')
  await drawer.getByPlaceholder('e.g. pod_uid').fill('pod_uid')
  await testRule.click()

  await expect(drawer.getByText('1 new collision group', { exact: true })).toBeVisible()
  await expect(drawer.getByText('Collision 1', { exact: true })).toHaveCount(2)
  expect(previews[0].rule.drop_label_pattern).toBe('pod_uid')
  expect(previews[0].samples).toHaveLength(6)
  expect(saves).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => drawer.locator('.fw-test-table').evaluate(
    table => table.scrollWidth <= table.clientWidth,
  )).toBe(true)

  await createRule.click()
  await expect(drawer.getByRole('alert')).toHaveText('Firewall rules changed. Test the draft again before saving.')
  await expect(createRule).toBeDisabled()
  await testRule.click()
  await expect(createRule).toBeEnabled()
  await createRule.click()
  await expect(drawer).not.toBeVisible()
  expect(saves.map(request => request.expected_policy_revision)).toEqual(['policy-1', 'policy-2'])
})
