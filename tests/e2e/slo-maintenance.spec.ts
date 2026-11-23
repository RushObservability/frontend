import { expect, test } from '@playwright/test'
import { queryReply, queryUrl } from './query-contract'
import type { Slo } from '../../src/types'

const initial: Slo = {
  id: 'checkout', name: 'Checkout availability', description: '', enabled: true,
  slo_type: 'trace', indicator_type: 'availability', service_name: 'checkout', metric_name: '',
  error_promql: '', total_promql: '', window_type: 'rolling_1h', target_percentage: 50,
  threshold_ms: null, threshold_value: null, threshold_op: null,
  error_filters: [{ field: 'error', op: '=', value: 1 }], total_filters: [],
  eval_interval_secs: 60, notification_channel_ids: [], state: 'breaching',
  error_budget_remaining: 0, error_count: 3, total_count: 6,
  last_eval_at: '2026-11-22T09:00:00Z', last_breached_at: null,
  created_at: '2026-11-22T08:00:00Z', updated_at: '2026-11-22T09:00:00Z',
  maintenance_supported: true, maintenance_revision: 0, maintenance_windows: [], maintenance_evaluation: null,
}

test.use({ timezoneId: 'America/Los_Angeles' })

test('saves recurring UTC exclusions and shows the applied budget breakdown', async ({ page }) => {
  let slo = { ...initial }
  let saved: unknown
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let data: unknown = {}
    if (path.endsWith('/auth/me')) data = { user: { id: 'operator', username: 'operator', role: 'admin' } }
    if (path.endsWith('/tenants')) data = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path.endsWith('/channels')) data = { channels: [] }
    if (path.endsWith('/slos/checkout')) data = { slo, events: [] }
    if (path.endsWith('/maintenance-exclusions')) {
      expect(route.request().method()).toBe('PUT')
      const request = route.request().postDataJSON()
      saved = request
      slo = { ...slo, maintenance_revision: 1, maintenance_windows: request.windows }
      data = slo
    }
    if (path.endsWith('/timeseries')) data = { buckets: [] }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, data) })
  })

  await page.goto('/slos/checkout')
  const panel = page.locator('.slo-maintenance')
  await panel.getByRole('button', { name: 'Add exclusion' }).click()
  await panel.getByLabel('Name', { exact: true }).fill('Backup')
  await panel.getByLabel('First start (UTC)', { exact: true }).fill('2026-11-22T08:15')
  await panel.getByLabel('First end (UTC)', { exact: true }).fill('2026-11-22T08:18')
  await panel.getByLabel('Repeat', { exact: true }).selectOption('weekly')
  await panel.getByRole('button', { name: 'Save exclusions' }).click()

  await expect(panel.getByRole('status')).toContainText('next budget evaluation')
  expect(saved).toEqual({
    revision: 0, windows: [{
      name: 'Backup', starts_at: '2026-11-22T08:15:00.000Z', ends_at: '2026-11-22T08:18:00.000Z', repeat: 'weekly',
    }],
  })
  await expect(panel.getByRole('row', { name: /Backup.*Weekly/ })).toBeVisible()

  slo = {
    ...slo, state: 'compliant', error_count: 1, total_count: 3, error_budget_remaining: 1 / 3,
    maintenance_evaluation: {
      revision: 1, excluded_seconds: 180, excluded_total: 3, excluded_bad: 2,
      periods: [{ starts_at: '2026-11-22T08:15:00Z', ends_at: '2026-11-22T08:18:00Z' }],
    },
  }
  await page.reload()
  await expect(panel.getByText('3m', { exact: true })).toBeVisible()
  await expect(panel.getByText('Excluded requests', { exact: true })).toBeVisible()
  await expect(panel.getByText('Excluded errors', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Error Budget' }).getByRole('status', { name: 'Remaining: 33.3%' })).toBeVisible()
  await panel.getByText('Applied periods (1)', { exact: true }).click()
  await expect(panel.getByRole('rowgroup').first()).toContainText('Start (UTC)')
  await expect(panel.getByRole('status')).toHaveCount(0)
})
