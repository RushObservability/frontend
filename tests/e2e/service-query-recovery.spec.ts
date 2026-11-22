import { test, expect, type Page } from '@playwright/test'
import { queryUrl, queryBody, queryReply } from './query-contract'

async function stub(page: Page, chartBuckets = 1) {
  const state = { failSeries: false, failGraph: false, intervals: [] as string[] }
  await page.route('**/api/v1/**', async route => {
    const path = queryUrl(route.request()).pathname
    let body: unknown = { services: [], nodes: [], edges: [], deploys: [], monitors: [], slos: [], rules: [], endpoints: [], groups: [], funnels: [], views: [], values: [], suggestions: ['payments'] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'service-reader', username: 'reader', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    if (path === '/api/v1/suggest/service_name') body = ['payments']
    if (path === '/api/v1/services/graph') {
      if (state.failGraph) { await route.fulfill({ status: 503, body: 'unavailable' }); return }
      body = { nodes: [{ service_name: 'payments', request_count: 120, error_count: 6 }], edges: [] }
    }
    if (path === '/api/v1/query/timeseries') {
      const request = queryBody(route.request())
      state.intervals.push(request.interval)
      // Mirror the server whitelist, rather than accepting every client token.
      if (state.failSeries || !['1s', '10s', '1m', '5m', '15m', '1h', '1d'].includes(request.interval)) {
        await route.fulfill({ status: state.failSeries ? 503 : 400, body: 'unavailable' }); return
      }
      const buckets = Array.from({ length: chartBuckets }, (_, index) => {
        const spike = index === 11 || index === 35
        return {
          bucket: new Date(new Date(request.time_range.from).getTime() + index * 60_000).toISOString(),
          count: 120 + index % 7 * 10,
          error_count: spike ? 26 : 6 + index % 3,
          avg_duration_ms: spike ? 240 : 50,
          p50_ms: 40 + index % 11,
          p95_ms: spike ? 500 : 80 + index % 13,
          p99_ms: spike ? 585 : 100 + index % 17,
        }
      }).filter((_, index) => index < 17 || index > 19)
      body = { buckets }
    }
    if (path === '/api/v1/services/latency-histogram') body = { buckets: [], total: 120, p50_ms: 40, p95_ms: 80, p99_ms: 100 }
    if (path === '/api/v1/services/time-breakdown/timeseries') body = { buckets: [], databases: [], interval: '1m', bucket_secs: 60 }
    await route.fulfill({ contentType: 'application/json', body: queryReply(route, body) })
  })
  return state
}

for (const [minutes, interval] of [[15, '1m'], [60, '1m'], [180, '5m'], [1440, '15m'], [10080, '1h']] as const) {
  test(`service overview loads a supported interval for ${minutes}m`, async ({ page }) => {
    const state = await stub(page)
    await page.goto(`/services/payments?t=${minutes}`)
    await expect(page.locator('.svc-stats-row')).toContainText('120')
    await expect(page.locator('.health-badge')).toHaveText('degraded')
    await expect(page.getByText('No service traffic was observed in this window.')).toHaveCount(0)
    expect(state.intervals.length).toBeGreaterThan(0)
    expect(state.intervals.every(value => value === interval)).toBe(true)
  })
}

test('a service query failure is unavailable, not zero traffic, and retry recovers', async ({ page }) => {
  const state = await stub(page)
  state.failSeries = true
  await page.goto('/services/payments?t=60')
  await expect(page.locator('.health-badge')).toHaveText('unavailable')
  await expect(page.locator('.svc-panel > [role="alert"]')).toContainText('Request and latency data could not be loaded')
  await expect(page.locator('.svc-stats-row')).toHaveCount(0)
  await expect(page.getByText('No service traffic was observed in this window.')).toHaveCount(0)
  state.failSeries = false
  await page.getByRole('button', { name: 'Retry service data' }).click()
  await expect(page.locator('.svc-stats-row')).toContainText('120')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a failed service map does not discard successful request data', async ({ page }) => {
  const state = await stub(page)
  state.failGraph = true
  await page.goto('/services/payments?t=60')
  await expect(page.locator('.svc-stats-row')).toContainText('120')
  await expect(page.getByRole('alert')).toContainText('service map could not be loaded')
  await expect(page.locator('.health-badge')).toHaveText('degraded')
})

test('expanded service charts retain thin strokes and synchronize the selected window', async ({ page }, testInfo) => {
  await stub(page, 50)
  await page.goto('/services/payments?t=60')
  const compact = page.getByRole('region', { name: 'Latency', exact: true })
  const compactLine = compact.locator('.ts-line').first()
  await expect(compactLine).toHaveCSS('stroke-width', '1.25px')
  const compactPlot = (await compact.locator('.ts-plot').boundingBox())!
  await page.getByRole('button', { name: 'Expand latency' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request latency' })
  const expandedLine = dialog.locator('.ts-line').first()
  await expect(expandedLine).toHaveCSS('stroke-width', '1.25px')
  await expect(expandedLine).toHaveCSS('vector-effect', 'non-scaling-stroke')

  const plot = dialog.locator('.ts-plot')
  await plot.focus()
  await page.keyboard.press('Home')
  await expect(dialog.locator('.ts-readout-time')).toBeVisible()
  const plotRect = (await plot.boundingBox())!
  expect(plotRect.height).toBeGreaterThan(compactPlot.height)
  const readoutRect = (await dialog.locator('.ts-legend').boundingBox())!
  expect(readoutRect.y).toBeGreaterThanOrEqual(plotRect.y + plotRect.height)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.mouse.move(plotRect.x + plotRect.width * .10, plotRect.y + plotRect.height / 2)
  await page.mouse.down()
  await page.mouse.move(plotRect.x + plotRect.width * .35, plotRect.y + plotRect.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(dialog.getByRole('button', { name: 'Reset zoom' })).toBeEnabled()
  await expect(expandedLine).toHaveCSS('stroke-width', '1.25px')
  await page.mouse.move(plotRect.x + plotRect.width * .55, plotRect.y + plotRect.height / 2)
  await expect(dialog.locator('.ts-readout-time')).toBeVisible()
  await dialog.screenshot({ path: testInfo.outputPath('expanded-latency.png') })
  await dialog.getByRole('button', { name: 'Close expanded chart' }).press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Expand latency' })).toBeFocused()

  await page.getByRole('button', { name: 'Expand requests' }).click()
  const signals = page.getByRole('dialog', { name: 'Traffic and errors' })
  const requests = signals.getByRole('region', { name: 'Requests' })
  const errors = signals.getByRole('region', { name: 'Errors' })
  await expect(requests.locator('.ts-stacked-bar')).toHaveCount(47)
  const originalTicks = await requests.locator('.ts-axis-label--bottom').allTextContents()
  const requestsPlot = requests.locator('.ts-plot')
  await requestsPlot.focus()
  await page.keyboard.press('Home')
  await expect(errors.locator('.ts-readout-time')).toHaveText(await requests.locator('.ts-readout-time').innerText())
  const rect = (await requestsPlot.boundingBox())!
  await page.mouse.move(rect.x + rect.width * .07, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .35, rect.y + rect.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(signals.getByRole('button', { name: 'Reset zoom' })).toBeEnabled()
  const zoomTicks = await requests.locator('.ts-axis-label--bottom').allTextContents()
  expect(zoomTicks).not.toEqual(originalTicks)
  await expect(errors.locator('.ts-axis-label--bottom')).toHaveText(zoomTicks)
  await requestsPlot.focus()
  await page.keyboard.press('Home')
  await signals.screenshot({ path: testInfo.outputPath('linked-service-charts.png') })
  await signals.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(requests.locator('.ts-axis-label--bottom')).toHaveText(originalTicks)
})
