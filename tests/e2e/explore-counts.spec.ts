import { test, expect, type Page } from '@playwright/test'
import type { CountBucket, TraceResponse } from '../../src/types'

async function stubExplore(page: Page) {
  const state = { total: 410_936, kind: 'exact', summaryFails: false, searches: [] as Record<string, any>[], trace: null as TraceResponse | null, histogram: null as CountBucket[] | null }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { views: [], services: [], buckets: [], keys: [], groups: [], values: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'count-test', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path.startsWith('/api/v1/traces/') && state.trace) body = state.trace
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
        TraceId: index === 0 ? state.trace?.trace_id ?? '' : '', SpanId: '', Body: `Payment event ${index}`, LogAttributes: {}, ResourceAttributes: {},
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
          histogram: state.histogram ?? [{ bucket: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString().slice(0, 19).replace('T', ' '), count: state.total, error_count: 1_600 }],
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

for (const mode of ['logs', 'traces', 'spans']) {
  for (const width of [1440, 390]) {
    test(`${mode} volume inspection stays outside the bars at ${width}px`, async ({ page }, testInfo) => {
      const state = await stubExplore(page)
      const now = Math.floor(Date.now() / 60_000) * 60_000
      state.histogram = Array.from({ length: 60 }, (_, index) => ({
        bucket: new Date(now - (59 - index) * 60_000).toISOString().slice(0, 19).replace('T', ' '),
        count: index === 30 ? 9_500 : 1_000 + (index % 5) * 200,
        error_count: index === 30 ? 500 : 0,
      }))
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`/?mode=${mode}&t=60`)
      const panel = page.locator('.signal-timeline')
      const plot = panel.locator('.timeline-bars')
      const readout = panel.locator('.timeline-tooltip')
      await expect(plot).toBeVisible()
      await plot.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const plotBox = (await plot.boundingBox())!
      for (const position of [0.01, 0.51, 0.99]) {
        await page.mouse.move(plotBox.x + plotBox.width * position, plotBox.y + plotBox.height / 2)
        await expect(readout).toBeVisible()
        await expect(panel.locator('.timeline-column--active')).toHaveCount(1)
        const detailsBox = (await readout.boundingBox())!
        expect(detailsBox.y + detailsBox.height <= plotBox.y || detailsBox.y >= plotBox.y + plotBox.height).toBe(true)
        expect(detailsBox.y).toBeGreaterThanOrEqual(0)
        const panelBox = (await panel.boundingBox())!
        expect(detailsBox.x).toBeGreaterThanOrEqual(panelBox.x)
        expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
        expect((await plot.boundingBox())!).toEqual(plotBox)
      }
      const spike = panel.locator('.timeline-column').filter({ has: page.locator('.timeline-stack') }).nth(30)
      await spike.hover()
      await expect(readout).toContainText('9,500')
      await expect(readout).toContainText('500')
      await page.screenshot({ path: testInfo.outputPath(`${mode}-volume-inspection-${width}.png`) })
      await page.mouse.move(plotBox.x, plotBox.y - 10)
      await expect(readout).toBeHidden()
      await plot.focus()
      await page.keyboard.press('Home')
      await expect(readout).toBeVisible()
      const firstTime = await readout.locator('.timeline-tooltip-time').innerText()
      await page.keyboard.press('ArrowRight')
      await expect(readout.locator('.timeline-tooltip-time')).not.toHaveText(firstTime)
      await page.keyboard.press('Escape')
      await expect(readout).toBeHidden()
      await page.keyboard.press('End')
      await expect(readout).toBeVisible()
      await page.keyboard.press('Tab')
      await expect(readout).toBeHidden()
      // Near the viewport top, put the popup below the plot instead of clipping it.
      await plot.focus()
      await plot.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await page.keyboard.press('Home')
      await expect(readout).toHaveClass(/timeline-tooltip--below/)
      const topPlot = (await plot.boundingBox())!
      const belowPopup = (await readout.boundingBox())!
      expect(belowPopup.y).toBeGreaterThanOrEqual(topPlot.y + topPlot.height)
      await page.keyboard.press('Escape')
      // The floating tooltip must not intercept zoom selection.
      await plot.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const dragBox = (await plot.boundingBox())!
      await page.mouse.move(dragBox.x + dragBox.width * 0.2, dragBox.y + 30)
      await page.mouse.down()
      await page.mouse.move(dragBox.x + dragBox.width * 0.7, dragBox.y + 30)
      await expect(readout).toBeHidden()
      await expect(panel.locator('.timeline-selection')).toBeVisible()
      await page.mouse.up()
      await expect(panel.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
    })
  }
}

for (const mode of ['traces', 'logs']) {
  test(`${mode} inline trace bars match the full trace service and error colors`, async ({ page }, testInfo) => {
    const state = await stubExplore(page)
    state.trace = {
      trace_id: 'trace-0', services: ['gateway', 'articles', 'payments'],
      duration_ns: 100_000_000, span_count: 6,
      spans: ['gateway', 'articles', 'payments', 'articles', 'payments', 'gateway'].map((service, index) => ({
        span_id: `span-${index}`, parent_span_id: '', service_name: service, service_version: '',
        timestamp: `2026-09-13 10:00:00.0${index}0000000`,
        duration_ns: 40_000_000, http_method: 'GET', http_path: `/work/${index}`,
        http_status_code: index === 5 ? 404 : 200,
        status: index === 3 ? 'ERROR' : index === 4 ? 'error' : 'OK',
        attributes: {}, events: [], children: [],
      })),
    }
    await page.goto(`/?mode=${mode}&t=60`)
    // Open the row preview without first opening the separate detail panel.
    await page.locator('.et-trace-link').first().click()
    const preview = page.locator('.inline-trace-preview')
    const bars = preview.locator('.inline-wf-bar')
    await expect(bars).toHaveCount(6)
    await expect(bars.nth(0)).toHaveCSS('background-color', 'rgb(59, 130, 246)')
    await expect(bars.nth(1)).toHaveCSS('background-color', 'rgb(71, 184, 129)')
    await expect(bars.nth(2)).toHaveCSS('background-color', 'rgb(91, 141, 217)')
    await expect(preview.locator('.inline-wf-error')).toHaveCount(3)
    const inlineColors = await bars.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
    expect(new Set(inlineColors.slice(3)).size).toBe(1)
    expect(inlineColors[3]).not.toBe(inlineColors[1])
    await preview.screenshot({ path: testInfo.outputPath(`${mode}-inline-trace-colors.png`) })

    await preview.getByRole('link', { name: 'View Full Trace' }).click()
    await expect(page).toHaveURL(/\/trace\/trace-0$/)
    const fullBars = page.locator('.tw-bar')
    await expect(fullBars).toHaveCount(6)
    expect(await fullBars.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))).toEqual(inlineColors)
  })
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
