import { test, expect, type Page } from '@playwright/test'
import type { LogView } from '../../src/lib/logViews'

async function stubLogApi(page: Page, initialViews: LogView[] = []) {
  const state = { views: initialViews, searches: [] as Record<string, any>[] }
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body: unknown = { keys: [], groups: [], users: [], links: [], channels: [], skills: [], values: [], providers: [], mappings: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'test-user', username: 'tester', role: 'admin', display_name: 'Tester' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }, { id: 'other', name: 'other', enabled: true }] }
    if (path === '/api/v1/services') body = { services: [] }
    if (path === '/api/v1/settings/log-views') {
      if (request.method() === 'PUT') state.views = request.postDataJSON().views
      body = { views: request.headers()['x-rush-tenant'] === 'other' ? [] : state.views }
    }
    if (path === '/api/v1/explore/search') {
      const query = request.postDataJSON()
      state.searches.push(query)
      body = {
        signal: 'logs', count: { value: 1, kind: 'exact' }, next_cursor: null,
        rows: query.include_rows ? [{
          Timestamp: Date.now() * 1_000_000, TimestampNs: String(Date.now() * 1_000_000),
          ServiceName: 'flights', SeverityText: 'INFO', SeverityNumber: 9, TraceId: '', SpanId: '',
          Body: '{"airline":"Example Air","flight_number":"0042","status":"Delayed"}', DisplayValues: { 'log.airline': 'Example Air', 'log.flight_number': '0042', 'log.status': 'Delayed' },
        }] : [],
        summary: { histogram: [], facets: { services: [], statuses: [], methods: [] }, groups: [], interval_secs: 60 },
        errors: {}, query_stats: { clickhouse_queries: 1, matched_rows: 1, matched_logical_bytes: 100, time_to_first_results_ms: 1, response_bytes: 300 },
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

test('create a tenant log view, search within it, customize columns, and return to all logs', async ({ page }, testInfo) => {
  const state = await stubLogApi(page)
  const { searches } = state

  await page.goto('/settings#log-views')
  await page.getByRole('button', { name: 'New log view', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New log view', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use flight example' }).click()
  await expect(page.getByLabel('View name')).toHaveValue('Flights')
  await page.screenshot({ path: testInfo.outputPath('log-view-settings.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(page.getByText('Log view saved.', { exact: true })).toBeVisible()
  expect(state.views[0]?.filters).toEqual([{ field: 'type', op: '=', value: 'event_data' }])
  await page.getByRole('link', { name: 'Flights', exact: true }).click()

  const search = page.locator('.search-input').first()
  await expect(page.locator('.custom-log-grid.et-head')).toHaveText('TimeAirlineFlight numberStatus')
  await expect(page.locator('.custom-log-grid.et-row').first()).toContainText('Example Air')
  await expect(search).toHaveValue('')
  await search.fill('status=Delayed')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect.poll(() => searches.filter(query => query.include_rows).at(-1)?.filters).toEqual([
    { field: 'status', op: '=', value: 'Delayed' }, { field: 'type', op: '=', value: 'event_data' },
  ])
  expect(searches.filter(query => query.include_summary).at(-1)?.filters).toEqual(searches.at(-1)?.filters)
  await expect(search).toHaveValue('status=Delayed')
  await expect(page).toHaveURL(/log_view=/)
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('status=Delayed')
  await page.reload()
  await expect(search).toHaveValue('status=Delayed')
  await expect(page.locator('.custom-log-grid.et-row').first()).toContainText('0042')

  const headers = await page.locator('.custom-log-grid.et-head .custom-log-cell').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x))
  const cells = await page.locator('.custom-log-grid.et-row').first().locator('.custom-log-cell').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x))
  headers.forEach((x, index) => expect(Math.abs(x - cells[index]!)).toBeLessThan(2))
  await page.screenshot({ path: testInfo.outputPath('flight-view.png'), fullPage: true })

  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Flight number', exact: true }).click()
  await page.getByRole('button', { name: 'Apply columns', exact: true }).click()
  await expect(page.locator('.custom-log-grid.et-head')).toHaveText('TimeAirlineStatus')
  await expect(page).toHaveURL(/log_columns=/)
  await expect(page.getByRole('link', { name: 'Manage views' })).toHaveAttribute('href', '/settings#log-views')

  await page.getByLabel('Log view', { exact: true }).selectOption('')
  await expect(page.locator('.custom-log-grid.et-head')).toHaveCount(0)
  await expect.poll(() => searches.filter(query => query.include_rows).at(-1)?.filters).toEqual([{ field: 'status', op: '=', value: 'Delayed' }])
})

test('log-view row actions match settings and keep edit and delete confirmation working', async ({ page }, testInfo) => {
  const state = await stubLogApi(page, [{
    id: '33333333-3333-4333-8333-333333333333', name: 'Flights',
    filters: [{ field: 'type', op: '=', value: 'event_data' }],
    columns: [{ field: 'timestamp', label: 'Time' }, { field: 'log.airline', label: 'Airline' }],
  }])
  await page.goto('/settings#log-views')
  const edit = page.getByRole('button', { name: 'Edit', exact: true })
  const remove = page.getByRole('button', { name: 'Delete', exact: true })
  await expect(edit).toHaveClass('action-btn')
  await expect(edit).toHaveCSS('font-size', '11px')
  await expect(edit).toHaveCSS('border-top-width', '0px')
  await expect(remove).toHaveClass('action-btn action-btn-danger')
  await expect(page.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCSS('text-align', 'right')
  const newButton = await page.getByRole('button', { name: 'New log view', exact: true }).boundingBox()
  const table = await page.locator('#panel-log-views table').boundingBox()
  expect(table!.y - (newButton!.y + newButton!.height)).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: testInfo.outputPath('log-view-row-actions.png'), fullPage: true })
  await edit.click()
  await expect(page.getByRole('dialog', { name: 'Edit log view', exact: true })).toBeVisible()
  await expect(page.locator('#panel-log-views table')).toBeVisible()
  await expect(page.getByLabel('View name')).toHaveValue('Flights')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await remove.click()
  await expect(page.getByRole('alert')).toContainText('Delete Flights?')
  expect(state.views).toHaveLength(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(edit).toBeVisible()
  await remove.click()
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Log view deleted.')
  expect(state.views).toHaveLength(0)
})

test('log-view drawer closes with Escape, restores focus, and keeps failed saves open on mobile', async ({ page }, testInfo) => {
  await stubLogApi(page)
  await page.goto('/settings#log-views')
  const create = page.getByRole('button', { name: 'New log view', exact: true })
  const dialog = page.getByRole('dialog', { name: 'New log view', exact: true })
  await create.click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect.poll(async () => {
    const box = await dialog.boundingBox()
    return box ? Math.round(box.x + box.width) : 0
  }).toBe(page.viewportSize()!.width)
  await dialog.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(create).toBeFocused()

  await page.setViewportSize({ width: 390, height: 844 })
  await create.click()
  await dialog.getByRole('button', { name: 'Use flight example' }).click()
  await expect.poll(async () => Math.round((await dialog.boundingBox())?.width ?? 0)).toBe(390)
  await expect(dialog.locator('.view-editor-actions')).toBeInViewport()
  await dialog.getByRole('button', { name: 'Save view', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close log view editor' })).toBeFocused()
  await page.route('**/api/v1/settings/log-views', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Could not save log views.')
  await expect(dialog.getByLabel('View name')).toHaveValue('Flights')
  const body = dialog.locator('.view-editor-body')
  expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('log-view-drawer-mobile.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Close log view editor' }).click()
  await expect(dialog).toBeHidden()
})

test('missing or unreadable saved views never fall back to an unfiltered search', async ({ page }) => {
  const { searches } = await stubLogApi(page)
  await page.goto('/?mode=logs&log_view=33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('alert')).toContainText('This log view is unavailable')
  expect(searches).toHaveLength(0)

  await page.route('**/api/v1/settings/log-views', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not load log views.')
  expect(searches).toHaveLength(0)
  await page.getByLabel('Log view', { exact: true }).selectOption('')
  await expect.poll(() => searches.length).toBeGreaterThan(0)
})

test('a view from another tenant is unavailable after switching tenants', async ({ page }) => {
  const view: LogView = {
    id: '33333333-3333-4333-8333-333333333333', name: 'Flights',
    filters: [{ field: 'type', op: '=', value: 'event_data' }],
    columns: [{ field: 'timestamp', label: 'Time' }, { field: 'log.airline', label: 'Airline' }],
  }
  const { searches } = await stubLogApi(page, [view])
  await page.goto(`/?mode=logs&log_view=${view.id}`)
  await expect(page.locator('.custom-log-grid.et-row').first()).toContainText('Example Air')
  await page.getByRole('button', { name: 'default', exact: true }).click()
  const before = searches.length
  await page.getByRole('menuitem', { name: 'other', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('This log view is unavailable')
  expect(searches).toHaveLength(before)
  await expect(page.locator('.custom-log-grid.et-row')).toHaveCount(0)
})

test('flight autocomplete suggests JSON fields and quoted airline values without changing the base', async ({ page }) => {
  const state = await stubLogApi(page, [{
    id: '33333333-3333-4333-8333-333333333333', name: 'Flights',
    filters: [{ field: 'type', op: '=', value: 'event_data' }],
    columns: [{ field: 'timestamp', label: 'Time' }, { field: 'log.airline', label: 'Airline' }],
  }])
  const suggestions: Record<string, any>[] = []
  await page.route('**/api/v1/logs/suggest', async route => {
    suggestions.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'application/json', body: '["Example Air", "Atlas Demo"]' })
  })
  await page.goto('/?mode=logs&log_view=33333333-3333-4333-8333-333333333333')
  await expect(page.locator('.custom-log-grid.et-row').first()).toContainText('Example Air')
  const search = page.locator('.search-input').first()
  await search.fill('body.air')
  await expect(page.locator('.ac-dropdown')).toContainText('body.airline')
  await page.locator('.ac-item').filter({ hasText: 'body.airline' }).click()
  await expect(search).toHaveValue('body.airline')
  for (const field of ['airline', 'body.airline']) {
    await search.fill(`${field}=""`)
    await expect(page.locator('.ac-dropdown')).toContainText('Example Air')
    await page.locator('.ac-item').filter({ hasText: 'Example Air' }).click()
    await expect(search).toHaveValue(`${field}="Example Air" `)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(() => state.searches.filter(query => query.include_rows).at(-1)?.filters).toEqual([
      { field, op: '=', value: 'Example Air' }, { field: 'type', op: '=', value: 'event_data' },
    ])
  }
  expect(suggestions.at(-1)?.field).toBe('body.airline')
  expect(suggestions.at(-1)?.prefix).toBe('')
  expect(suggestions.at(-1)?.filters).toEqual([{ field: 'type', op: '=', value: 'event_data' }])
  expect(suggestions.at(-1)?.time_range).toHaveProperty('from')

  // Loaded log values remain useful while the API is unavailable or upgrading.
  await page.route('**/api/v1/logs/suggest', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await search.fill('body.airline="Example A')
  await expect(page.locator('.ac-dropdown')).toContainText('Example Air')
  await search.press('Tab')
  await expect(search).toHaveValue('body.airline="Example Air" ')
})
