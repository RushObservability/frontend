import { test, expect, type Page } from '@playwright/test'

async function stubExplore(page: Page) {
  const state = { total: 410_936, kind: 'exact', summaryFails: false, searches: [] as Record<string, any>[] }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { views: [], services: [], buckets: [], keys: [], groups: [], values: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'count-test', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/explore/search') {
      const query = route.request().postDataJSON()
      state.searches.push(query)
      if (query.include_summary && state.summaryFails) {
        await route.fulfill({ status: 503, body: 'Unavailable' })
        return
      }
      const logs = query.signal === 'logs'
      const timestamp = Date.now() * 1_000_000
      const rows = Array.from({ length: logs ? 500 : 100 }, (_, index) => logs ? {
        Timestamp: timestamp - index * 1_000_000, TimestampNs: String(timestamp - index * 1_000_000),
        ServiceName: 'payments', SeverityText: 'INFO', SeverityNumber: 9,
        TraceId: '', SpanId: '', Body: `Payment event ${index}`, LogAttributes: {}, ResourceAttributes: {},
      } : {
        timestamp: timestamp - index * 1_000_000, trace_id: `trace-${index}`, span_id: `span-${index}`,
        parent_span_id: '', service_name: 'payments', service_version: '', environment: '', host_name: '',
        http_method: 'POST', http_path: '/payments', http_status_code: 200, duration_ns: 1_000_000,
        status: 'OK', attributes: '{}', event_timestamps: [], event_names: [], event_attributes: [],
        link_trace_ids: [], link_span_ids: [],
      })
      body = {
        signal: query.signal,
        count: query.include_summary ? { value: state.total, kind: state.kind } : { value: rows.length, kind: 'capped' },
        rows: query.include_rows ? rows : [], next_cursor: query.include_rows ? 'next-page' : null,
        summary: {
          histogram: [{ bucket: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString().slice(0, 19).replace('T', ' '), count: state.total, error_count: 1_600 }],
          facets: {
            services: Array.from({ length: 9 }, (_, index) => ({ key: `service-${index}`, count: 1000 })),
            statuses: [{ key: 'error', count: 1_600 }, { key: 'warn', count: 3_800 }], methods: [],
          }, groups: [], interval_secs: 60,
        },
        errors: {}, query_stats: {},
      }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('log event totals use the full filtered time range instead of the 500 loaded rows', async ({ page }) => {
  const state = await stubExplore(page)
  await page.goto('/?mode=logs&t=60')
  const count = page.locator('.signal-timeline .timeline-total')
  await expect(count).toHaveText('410,936events')
  await expect(page.locator('.facet-showing')).toContainText('500 of 410,936 events')

  state.total = 12_345
  await page.locator('.search-input').first().fill('service_name=payments')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(count).toHaveText('12,345events')
  const queries = state.searches.slice(-2)
  expect(queries[0]?.time_range).toEqual(queries[1]?.time_range)
  expect(queries[0]?.filters).toEqual(queries[1]?.filters)
  expect(queries[0]?.filters).toContainEqual({ field: 'service_name', op: '=', value: 'payments' })

  state.total = 98_765
  await page.goto('/?mode=logs&t=360')
  await expect(count).toHaveText('98,765events')
  const range = state.searches.at(-1)!.time_range
  expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBe(360 * 60_000)
})

test('counts preserve capped and estimated indicators instead of presenting partial totals as exact', async ({ page }) => {
  const state = await stubExplore(page)
  state.summaryFails = true
  await page.goto('/?mode=logs')
  const count = page.locator('.signal-timeline .timeline-total')
  await expect(page.getByText('Summary partial', { exact: true })).toHaveAttribute('title', 'Summaries are temporarily unavailable. Results are still complete.')
  await expect(count).toHaveText('500+events')

  state.summaryFails = false
  state.kind = 'estimated'
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(count).toHaveText('~410,936events')
})

test('the result count label follows spans, traces, and logs when switching modes', async ({ page }) => {
  await stubExplore(page)
  await page.goto('/?mode=spans')
  const count = page.locator('.signal-timeline .timeline-total')
  await expect(page.locator('.stats-bar')).toHaveCount(0)
  await expect(count).toHaveText('410,936spans')
  await page.getByText('Traces only', { exact: true }).click()
  await expect(count).toHaveText('410,936traces')
  await expect(page.locator('.stats-bar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Logs', exact: true }).click()
  await expect(page.locator('.signal-timeline .timeline-total')).toHaveText('410,936events')
  await expect(page.locator('.stats-bar')).toHaveCount(0)
})

for (const mode of ['traces', 'spans']) {
  test(`${mode} volume contains the former banner stats on desktop and mobile`, async ({ page }, testInfo) => {
    await stubExplore(page)
    await page.goto(`/?mode=${mode}&t=60`)
    const title = mode === 'traces' ? 'Trace volume' : 'Span volume'
    const panel = page.getByRole('region', { name: title, exact: true })
    const summary = panel.locator('.timeline-summary')
    await expect(page.locator('.stats-bar')).toHaveCount(0)
    await expect(summary.locator('.timeline-total')).toHaveText(`410,936${mode}`)
    const stats = summary.locator('.timeline-stat')
    await expect(stats.locator(':scope > span')).toHaveText(['Error rate', 'P50', 'P99', 'Services'])
    await expect(stats.filter({ hasText: 'Services' })).toHaveText('Services9')
    await expect(stats.filter({ hasText: 'P50' })).toHaveAttribute('title', `P50 of the 100 loaded ${mode}, not the full time range.`)
    await expect(stats.filter({ hasText: 'P99' }).locator('strong')).not.toHaveText('—')
    await page.screenshot({ path: testInfo.outputPath(`${mode}-volume-desktop.png`), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    const bounds = await summary.boundingBox()
    for (const stat of await stats.all()) {
      const box = await stat.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
    }
    await page.screenshot({ path: testInfo.outputPath(`${mode}-volume-mobile.png`), fullPage: true })
  })
}

test('log volume consolidates full-range stats without a separate banner and wraps on mobile', async ({ page }, testInfo) => {
  await stubExplore(page)
  await page.goto('/?mode=logs&t=60')
  await expect(page.locator('.stats-bar')).toHaveCount(0)
  const panel = page.getByRole('region', { name: 'Log volume', exact: true })
  const summary = panel.locator('.timeline-summary')
  await expect(summary.locator('.timeline-total')).toHaveText('410,936events')
  const stats = summary.locator('.timeline-stat')
  await expect(stats).toHaveText(['Errors1,600', 'Warnings3,800', 'Error rate0.4%', 'Services9'])
  await expect(summary.getByText('Peak', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('log-volume-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(stats).toHaveText(['Errors1,600', 'Warnings3,800', 'Error rate0.4%', 'Services9'])
  const summaryBox = await summary.boundingBox()
  for (const stat of await stats.all()) {
    const box = await stat.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(summaryBox!.x)
    expect(box!.x + box!.width).toBeLessThanOrEqual(summaryBox!.x + summaryBox!.width + 1)
  }
  await page.screenshot({ path: testInfo.outputPath('log-volume-mobile.png'), fullPage: true })
})
