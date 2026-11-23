import { expect, test } from '@playwright/test'
import type { CapacityForecast, ForecastResource } from '../../src/types'
import { queryReply, queryUrl } from './query-contract'

const now = Date.UTC(2026, 10, 23, 9)
const hour = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const host = (name: string): ForecastResource => ({
  service: 'clickhouse',
  attributes: { mountpoint: '/var/lib/clickhouse', state: 'used' },
  resource_attributes: { 'host.name': name },
})
const primary = host('db-a')
const secondary = host('db-b')

test('previews, creates, and reloads a capacity forecast monitor', async ({ page }) => {
  let saved: Record<string, any> | undefined
  const previews: Record<string, any>[] = []
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { channels: [], monitors: [], views: [], suggestions: [], events: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/monitors/forecast/series') body = { resources: [primary, secondary], truncated: false }
    if (path === '/api/v1/monitors/preview') {
      const request = route.request().postDataJSON()
      previews.push(request)
      const noData = request.query_config.resource?.resource_attributes['host.name'] === 'db-b'
      const end = now + request.query_config.horizon_secs * 1000
      const crossing = now + 18 * hour
      const forecast: CapacityForecast = {
        evaluated_at: iso(now), history_from: iso(now - 24 * hour), horizon_end: iso(end),
        threshold_pct: request.critical, current_pct: 78, projected_pct: noData ? null : 78 + (end - now) / hour * 2 / 3,
        crossing_at: !noData && end >= crossing ? iso(crossing) : null,
        no_data: noData ? 'insufficient_history' : null,
        history: Array.from({ length: noData ? 3 : 25 }, (_, index) => ({
          timestamp: iso(now - index * hour), value: 78 - index * 2 / 3,
        })).reverse(),
        projection: noData ? [] : [{ timestamp: iso(now), value: 78 }, { timestamp: iso(end), value: 78 + (end - now) / hour * 2 / 3 }],
      }
      body = { current_value: forecast.projected_pct, timeseries: [], forecast }
    }
    if (path === '/api/v1/monitors' && route.request().method() === 'POST') {
      saved = { ...route.request().postDataJSON(), id: 'capacity-demo', state: 'ok', group_states: {} }
      body = saved
    }
    if (path === '/api/v1/monitors/capacity-demo') {
      if (route.request().method() === 'PUT') {
        saved = { ...saved, ...route.request().postDataJSON() }
        body = saved
      } else body = { monitor: saved, events: [] }
    }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })

  await page.goto('/alerts/new')
  await page.getByRole('button', { name: 'Capacity forecast' }).click()
  const resource = page.getByRole('combobox', { name: 'Resource', exact: true })
  const horizon = page.getByRole('combobox', { name: 'Forecast window' })
  const panel = page.getByRole('region', { name: 'Forecast preview' })
  await resource.selectOption({ label: 'db-a · /var/lib/clickhouse · used' })
  await expect(panel).toContainText('Projected to cross 90% in 18h')
  await expect(panel.locator('.ts-forecast-region')).toBeVisible()
  await expect(panel.locator('path[stroke-dasharray="4 3"]')).toHaveCount(1)
  await horizon.selectOption('21600')
  await expect(panel).toContainText('No crossing in the next 6 hours')
  await resource.selectOption({ label: 'db-b · /var/lib/clickhouse · used' })
  await expect(panel).toContainText('Insufficient history')
  await expect(panel.locator('path[stroke-dasharray="4 3"]')).toHaveCount(0)
  await resource.selectOption({ label: 'db-a · /var/lib/clickhouse · used' })
  await horizon.selectOption('86400')
  await expect(panel).toContainText('Would alert')
  await page.getByPlaceholder('High latency on checkout service').fill('ClickHouse disk capacity')
  await page.getByRole('button', { name: 'Save alert' }).click()
  await expect.poll(() => saved).toMatchObject({
    type: 'forecast', critical: 90, comparator: 'above_or_equal', eval_interval_secs: 300, eval_window_secs: 86_400, group_by: [],
    query_config: { metric_name: 'system.filesystem.utilization', resource: primary, input_unit: 'ratio', horizon_secs: 86400 },
  })
  expect(previews.at(-1)?.query_config).toMatchObject({ resource: primary, horizon_secs: 86400 })
  if (saved) saved.enabled = false
  await page.goto('/alerts/capacity-demo/edit')
  await expect(horizon).toHaveValue('86400')
  await expect(resource.locator('option:checked')).toHaveText('db-a · /var/lib/clickhouse · used')
  await expect(panel).toContainText('Projected to cross 90% in 18h')
  await horizon.selectOption('21600')
  await page.getByRole('button', { name: 'Update alert' }).click()
  await expect.poll(() => saved).toMatchObject({ enabled: false, query_config: { horizon_secs: 21600 } })
  await page.goto('/alerts/capacity-demo')
  await expect(panel).toContainText('No crossing in the next 6 hours')
})
