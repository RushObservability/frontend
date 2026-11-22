import { expect, test, type Page } from '@playwright/test'
import { queryBody, queryReply, queryUrl } from './query-contract'
import type { MonitorEvent, MonitorEvidenceQuery } from '../../src/types'

const from = '2026-11-22T09:09:00Z'
const to = '2026-11-22T09:14:00Z'
const oldVersion = Date.parse('2026-11-22T08:00:00Z') * 1000
const newVersion = Date.parse('2026-11-22T09:22:00Z') * 1000

function firing(query: MonitorEvidenceQuery, groupBy: string[] = [], groupKey = ''): MonitorEvent {
  return {
    id: 'old-event', monitor_id: 'checkout', tenant_id: 'default', group_key: groupKey,
    prev_state: 'ok', new_state: 'alert', value: 8.2, threshold: 5, message: '', created_at: '2026-11-22 09:14:00',
    evidence: {
      rule_name: 'Checkout error rate', rule_version: oldVersion, comparator: 'above',
      group_by: groupBy, window_start: from, evaluated_at: to, query,
    },
  }
}

async function stub(page: Page, event: MonitorEvent) {
  const oldEvidence = event.evidence!
  const monitor = {
    id: 'checkout', name: 'Checkout error rate', type: 'apm', state: 'ok', tags: [],
    enabled: true, created_at: '2026-11-22 08:00:00', rule_version: newVersion,
    critical: 10, comparator: 'above', eval_window_secs: 300,
    group_by: oldEvidence.group_by, group_states: { [event.group_key]: 'ok' },
    query_config: { type: 'apm', service: 'checkout-v2', endpoint_filter: '/new-checkout', metric: 'error_rate' },
  }
  const newer = {
    ...event, id: 'new-event', threshold: 10, value: 12.4, created_at: '2026-11-22 09:31:00',
    evidence: {
      ...oldEvidence, rule_version: newVersion, window_start: '2026-11-22T09:26:00Z', evaluated_at: '2026-11-22T09:31:00Z',
    },
  }
  const events = [newer, event, { ...event, id: 'legacy', created_at: '2026-11-22 08:55:00', evidence: undefined }]
  const explore: ReturnType<typeof queryBody>[] = []
  const metrics: URL[] = []
  await page.route('**/api/v1/**', async route => {
    const url = queryUrl(route.request())
    let data: unknown = { services: [], views: [], buckets: [], groups: [], keys: [] }
    if (url.pathname === '/api/v1/auth/me') data = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (url.pathname === '/api/v1/tenants') data = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (url.pathname === '/api/v1/monitors/checkout') data = { monitor, events }
    if (url.pathname === '/api/v1/monitors/checkout/events') data = { events }
    if (url.pathname === '/api/v1/monitors/preview') data = { current_value: null, timeseries: [] }
    if (url.pathname === '/api/v1/explore/search') {
      const request = queryBody(route.request())
      explore.push(request)
      data = {
        signal: request.signal, rows: [], count: { value: 0, kind: 'exact' },
        summary: { histogram: [], facets: {}, groups: [], interval_secs: 60 }, errors: {}, query_stats: {},
      }
    }
    if (url.pathname.startsWith('/prom/')) data = { status: 'success', data: [] }
    if (url.pathname === '/prom/api/v1/query_range') {
      metrics.push(url)
      const window = [Number(url.searchParams.get('start')), Number(url.searchParams.get('end'))]
      data = { status: 'success', data: { resultType: 'matrix', result: ['checkout', 'billing'].map(service_name => ({
        metric: { service_name }, values: [[window[0], '4'], [window[1], '8.2']],
      })) } }
    }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, data) })
  })
  return { explore, metrics }
}

test.use({ timezoneId: 'UTC' })

test('an earlier firing keeps its threshold, version, and span filters after a rule edit', async ({ page }) => {
  const event = firing({ kind: 'apm', service: 'checkout-*', endpoint_filter: '/checkout/*', metric: 'error_rate' })
  const { explore } = await stub(page, event)
  await page.goto('/alerts/checkout')
  const old = page.getByRole('button', { name: 'Evidence for Nov 22, 09:14:00' })
  await old.focus()
  await old.press('Enter')
  const evidence = page.getByRole('region', { name: 'Saved evaluation evidence' })
  await expect(evidence).toContainText('8.2%')
  await expect(evidence).toContainText('> 5%')
  await expect(evidence.getByTitle(String(oldVersion))).toBeVisible()
  await expect(evidence).toContainText('earlier rule version')
  await expect(evidence).toContainText('Endpoint /checkout/*')

  await page.getByRole('button', { name: 'Evidence for Nov 22, 09:31:00' }).click()
  await expect(evidence).toContainText('> 10%')
  await expect(evidence.getByTitle(String(newVersion))).toBeVisible()

  await old.click()
  await evidence.getByRole('link', { name: /Open in Explore/ }).click()
  await expect(page.getByRole('link', { name: 'Alert evidence' })).toBeVisible()
  await expect.poll(() => explore.find(request => request.include_rows)?.time_range).toEqual({ from, to })
  const requests = explore.filter(request => request.include_rows)
  expect(requests.at(-1)?.signal).toBe('spans')
  expect(requests.at(-1)?.filters).toEqual([{
    field: 'rush.alert_scope', op: '=', value: expect.any(String),
  }])
  expect(JSON.parse(requests.at(-1)?.filters[0].value)).toMatchObject({ query: event.evidence!.query, group_key: null })
  await expect(page.getByText(/Older data may have expired/)).toBeVisible()

  await page.getByRole('link', { name: 'Alert evidence' }).click()
  await expect(old).toHaveAttribute('aria-expanded', 'true')
  await expect(evidence).toContainText('> 5%')
  await page.getByRole('button', { name: 'Evidence for Nov 22, 08:55:00' }).click()
  await expect(evidence).toContainText('No saved evaluation')
  await expect(evidence.getByRole('link')).toHaveCount(0)
})

test('a grouped log alert preserves severity, text, field filters, and the exact group key', async ({ page }) => {
  const event = firing({
    kind: 'log', search: 'timeout gone', service: 'checkout worker', severities: ['ERROR', 'WARN'],
    filters: [{ field: 'body', op: 'LIKE', value: 'retry required' }],
  }, ['service_name', 'scope_name'], 'checkout worker:scope:one')
  const { explore } = await stub(page, event)
  await page.goto('/alerts/checkout?event=old-event')
  const evidence = page.getByRole('region', { name: 'Saved evaluation evidence' })
  await expect(evidence).toContainText('checkout worker:scope:one')
  await evidence.getByRole('link', { name: /Open in Explore/ }).click()
  await expect.poll(() => explore.find(request => request.include_rows)?.time_range).toEqual({ from, to })
  const request = explore.find(request => request.include_rows)!
  expect(request.signal).toBe('logs')
  expect(JSON.parse(request.filters[0].value)).toMatchObject({
    query: event.evidence!.query, group_by: event.evidence!.group_by, group_key: event.group_key,
  })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Alert evidence' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear alert filter' }).click()
  await expect.poll(() => explore.filter(request => request.include_rows).at(-1)?.filters).toEqual([])
})

test('a PromQL alert opens its saved expression, range, and matching series', async ({ page }) => {
  const expression = 'sum by (service_name) (rate(http_errors_total[5m]))'
  const { metrics } = await stub(page, firing({ kind: 'promql', expression, series: { service_name: 'checkout' } }))
  await page.goto('/alerts/checkout?event=old-event')
  await page.getByRole('link', { name: /Open in Metrics/ }).click()
  await expect.poll(() => metrics[0]?.searchParams.get('query')).toBe(expression)
  expect(metrics[0]!.searchParams.get('start')).toBe(String(Date.parse(from) / 1000))
  expect(metrics[0]!.searchParams.get('end')).toBe(String(Date.parse(to) / 1000))
  const results = page.getByTitle(/Create alert from the full query/)
  await expect(page.getByText('{service_name="checkout"}', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('{service_name="billing"}', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all series' }).click()
  await expect(page.getByText('{service_name="billing"}', { exact: true }).last()).toBeVisible()
  await expect(results).toHaveCount(2)
})
