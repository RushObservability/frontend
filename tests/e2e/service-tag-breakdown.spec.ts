import { test, expect } from '@playwright/test'
import { queryUrl, queryBody, queryReply } from './query-contract'
import type { ServiceTagGroup } from '../../src/types'

test('tag breakdown opens the matching traces with the original window', async ({ page }) => {
  const breakdowns: URL[] = []
  const exploreRequests: ReturnType<typeof queryBody>[] = []
  const routes = ['/v1/charge', '/v1/refund', '/v1/verify']
  await page.route('**/api/v1/**', async route => {
    const url = queryUrl(route.request())
    const path = url.pathname
    let data: unknown = { nodes: [], edges: [], services: [], rules: [], values: [], monitors: [], slos: [], views: [], buckets: [], endpoints: [], groups: [] }
    if (path === '/api/v1/auth/me') data = { user: { id: 'reader', username: 'reader', role: 'admin' } }
    if (path === '/api/v1/tenants') data = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/suggest/service_name') data = ['payments']
    if (path === '/api/v1/services/tag-breakdown') {
      breakdowns.push(url)
      const from = Date.parse(url.searchParams.get('from')!)
      const values = url.searchParams.get('dimension') === 'endpoint' ? routes : ['us-east-1', 'eu-central-1', 'us-west-2']
      const groups = [...values, null].map((value, index): ServiceTagGroup => ({
        value, requests: [50, 20, 20, 10][index]!, errors: index === 1 ? 4 : 0, p95_ms: 120 + index * 100,
        other_values: value === null ? 2 : 0, untagged_requests: value === null ? 3 : 0,
        buckets: Array.from({ length: 2 }, (_, bucket) => ({
          timestamp_ms: from + bucket * 60_000, requests: [25, 10, 10, 5][index]!,
          errors: index === 1 ? 2 : 0, p95_ms: 120 + index * 100,
        })),
      }))
      data = { bucket_seconds: 60, total_requests: 100, groups }
    }
    if (path === '/api/v1/explore/search') {
      const request = queryBody(route.request())
      if (request.include_rows) exploreRequests.push(request)
      data = {
        signal: 'spans', rows: [], count: { value: 0, kind: 'exact' },
        summary: { histogram: [], facets: {}, groups: [], interval_secs: 60 }, errors: {}, query_stats: {},
      }
    }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, data) })
  })

  await page.goto('/services/payments?t=60')
  const panel = page.getByRole('region', { name: 'Breakdown by tag' })
  await panel.scrollIntoViewIfNeeded()
  await expect(panel.getByText('Top 3 of 5 values by requests · 100 total requests')).toBeVisible()
  await expect(panel.getByRole('row').filter({ hasText: 'Other' })).toContainText('10%')
  await expect(panel.getByRole('row').filter({ hasText: 'Other' })).toContainText('3 without a usable tag')
  await expect(panel.getByRole('region', { name: 'P95 latency' }).locator('.ts-series-hit')).toHaveCount(4)

  await panel.getByRole('combobox', { name: 'Group by' }).selectOption('endpoint')
  await expect(panel.getByRole('table').getByText('/v1/charge', { exact: true })).toBeVisible()
  const current = breakdowns.at(-1)!
  expect(current.searchParams.get('dimension')).toBe('endpoint')
  expect(current.searchParams.get('service')).toBe('payments')
  const firstSeries = panel.getByRole('region', { name: 'Requests / 1m' }).locator('path.ts-series-hit').first()
  await firstSeries.scrollIntoViewIfNeeded()
  const point = await firstSeries.evaluate(path => {
    const line = path as SVGPathElement
    const point = line.getPointAtLength(line.getTotalLength() / 2).matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  const context = page.locator('[aria-label="Service tag filters"]')
  await expect(context).toContainText('Endpoint = /v1/charge')
  await context.getByRole('link', { name: 'Service overview' }).click()
  await panel.scrollIntoViewIfNeeded()
  await expect(panel.getByRole('combobox', { name: 'Group by' })).toHaveValue('endpoint')
  await panel.getByRole('link', { name: 'View traces for Other' }).waitFor()
  const updated = breakdowns.at(-1)!
  const from = updated.searchParams.get('from')
  const to = updated.searchParams.get('to')
  await panel.getByRole('link', { name: 'View traces for Other' }).click()
  await expect(context).toContainText('Service = payments')
  await expect(context).toContainText(routes.join(', '))
  await expect.poll(() => exploreRequests.at(-1)?.time_range).toEqual({ from, to })
  const request = exploreRequests.at(-1)!
  expect(request.filters).toContainEqual({ field: 'parent_span_id', op: '=', value: '' })
  const filter = request.filters.find((filter: { field: string }) => filter.field === 'rush.service_tag')
  expect(JSON.parse(filter.value)).toEqual({ service: 'payments', dimension: 'endpoint', selection: { kind: 'other', excluded: routes } })

  await page.reload()
  await expect(context).toBeVisible()
  await page.getByRole('button', { name: 'Clear tag filter' }).click()
  await expect(context).toHaveCount(0)
  await expect.poll(() => exploreRequests.at(-1)?.filters).toEqual([{ field: 'parent_span_id', op: '=', value: '' }])
  expect(exploreRequests.at(-1)?.time_range).toEqual({ from, to })
})
