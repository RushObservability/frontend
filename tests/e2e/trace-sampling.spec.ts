import { expect, test } from '@playwright/test'
import type { TraceSamplingDraft, TraceSamplingPolicy, TraceSamplingPreviewResult } from '../../src/types'

test('previews a draft, shows sample limits, and labels results from a previous draft', async ({ page }) => {
  const policies: TraceSamplingPolicy[] = []
  const writes: string[] = []
  const saves: TraceSamplingDraft[] = []
  let savedDraft: TraceSamplingDraft = { window_minutes: 60, rules: [] }
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/auth/me') {
      return route.fulfill({ json: { user: { id: 'admin', username: 'admin', role: 'admin' } } })
    }
    if (path === '/api/v1/tenants') {
      return route.fulfill({ json: { tenants: [{ id: 'default', name: 'default', enabled: true }] } })
    }
    if (path === '/api/v1/frontend/telemetry') return route.fulfill({ status: 204 })
    if (path === '/api/v1/traces/sampling-options') return route.fulfill({ json: [] })
    if (path === '/api/v1/settings/trace-sampling') {
      expect(request.headers()['x-rush-tenant']).toBe('default')
      if (request.method() === 'GET') return route.fulfill({ json: savedDraft })
      expect(request.method()).toBe('PUT')
      savedDraft = request.postDataJSON()
      saves.push(savedDraft)
      return route.fulfill({ json: savedDraft })
    }
    if (path === '/api/v1/traces/sampling-preview') {
      expect(request.method()).toBe('POST')
      const policy: TraceSamplingPolicy = request.postDataJSON()
      policies.push(policy)
      let unmatched = 100
      const rule_retention = (policy.rules ?? []).map(rule => {
        const total = rule.service === 'payments' ? 2 : rule.service === 'gateway' ? 10 : unmatched
        unmatched -= total
        return { total, kept: Math.round(total * rule.keep_percent / 100) }
      })
      const fallback_retention = { total: unmatched, kept: unmatched }
      const kept = rule_retention.reduce((sum, rule) => sum + rule.kept, fallback_retention.kept)
      const rareRetained = unmatched ? 1 : 0
      const result: TraceSamplingPreviewResult = {
        from: '2026-11-22T18:00:00Z',
        to: '2026-11-22T19:00:00Z',
        window_minutes: policy.window_minutes,
        settling_seconds: 120,
        coverage: {
          scanned_spans: 156,
          observed_minutes: 42,
          sampled_traces: 120,
          sample_limit: 120,
          discovery_capped: false,
          trace_sample_capped: true,
          incomplete_traces: 8,
          boundary_traces: 10,
          span_capped_traces: 2,
          traces_without_route: 1,
        },
        retention: { total: 100, kept },
        rule_retention,
        fallback_retention,
        cohorts: {
          errors: { total: 1, kept: 0 },
          slow: { total: 1, kept: 0 },
          rare_routes: { total: 1, kept: rareRetained },
        },
        rare_route_threshold: 10,
        rare_route_count: 1,
        rare_routes_zero_kept: 1 - rareRetained,
        rare_routes: [{
          service: 'payments',
          method: 'POST',
          route: '/refund/:id',
          retention: { total: 1, kept: rareRetained },
        }],
      }
      return route.fulfill({ json: result })
    }
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) writes.push(path)
    return route.fulfill({
      json: { keys: [], groups: [], users: [], links: [], channels: [], skills: [], values: [], providers: [], mappings: [], sessions: [], routes: [] },
    })
  })

  await page.goto('/settings#trace-sampling')
  await expect(page.getByRole('heading', { name: 'Trace sampling' })).toBeVisible()
  const draft = page.getByRole('region', { name: 'Trace sampling draft' })
  const results = page.getByRole('region', { name: 'Projected retention' })
  await expect(draft.getByText('Preview decisions never affect live ingestion.')).toBeVisible()
  await expect(results.getByText('No preview yet')).toBeVisible()
  const saveRules = draft.getByRole('button', { name: 'Save rules' })
  await expect(saveRules).toBeDisabled()
  expect(policies).toHaveLength(0)

  await expect(draft.getByLabel('Other traces')).toHaveCount(0)
  await expect(draft.getByRole('checkbox', { name: 'Error traces' })).toHaveCount(0)
  await draft.getByRole('button', { name: 'Run preview' }).click()

  await expect(results.getByText('100 of 100 complete traces would be kept')).toBeVisible()
  await expect(results.getByText('100 of 120 sampled traces complete · 42/60 minutes with sampled spans')).toBeVisible()
  await expect(results.getByText('Sampling limit reached.', { exact: false })).toBeVisible()
  expect(policies[0]).toEqual({ window_minutes: 60 })

  await draft.getByLabel('Sample window').selectOption('15')
  await expect(results.getByText('Draft changed. Run the preview to update results.')).toBeVisible()
  expect(policies).toHaveLength(1)
  await draft.getByRole('button', { name: 'Run preview' }).click()
  await expect(results.getByText('Draft changed.', { exact: false })).toHaveCount(0)
  expect(policies[1]).toEqual({ window_minutes: 15 })

  const addRule = draft.getByRole('button', { name: 'Add a rule' })
  const editor = draft.getByRole('form', { name: 'Add a rule' })
  const list = draft.getByRole('list', { name: 'Current draft rules' })
  await addRule.click()
  await editor.getByLabel('Service').fill('gateway')
  await editor.getByLabel('Match on').selectOption('server_span')
  await editor.getByLabel('HTTP status').fill('2XX')
  await editor.getByLabel('Method').fill('get')
  await editor.getByLabel('Route template').fill('/checkout/:id')
  const keep = editor.getByRole('spinbutton', { name: 'Keep (%)' })
  const slider = editor.getByRole('slider', { name: 'Keep percentage slider' })
  await slider.fill('50')
  await expect(keep).toHaveValue('50')
  await expect(results.getByText('95 of 100 complete traces would be kept')).toBeVisible()
  await expect(list).toHaveCount(0)
  await keep.fill('9')
  const ruleResults = results.getByRole('table', { name: 'Projected retention by rule' })
  const gatewayPreview = ruleResults.getByRole('row', { name: /gateway/ })
  await expect(ruleResults.getByRole('columnheader', { name: 'Target keep' })).toBeVisible()
  await expect(ruleResults.getByRole('columnheader', { name: 'Sample retained' })).toBeVisible()
  await expect(gatewayPreview.getByRole('cell', { name: '9%', exact: true })).toBeVisible()
  await expect(gatewayPreview.getByRole('cell', { name: '1 / 10', exact: true })).toBeVisible()
  await expect(gatewayPreview.getByRole('cell', { name: '10%', exact: true })).toBeVisible()
  await expect(results.getByText('Overall sample retention', { exact: true })).toBeVisible()
  await keep.hover()
  await page.mouse.wheel(0, -100)
  await expect(keep).toHaveValue('10')
  await page.mouse.wheel(0, 100)
  await expect(keep).toHaveValue('9')
  await editor.getByLabel('Service').focus()
  await keep.dispatchEvent('wheel', { deltaY: -100 })
  await expect(keep).toHaveValue('9')
  await keep.fill('100')
  await keep.dispatchEvent('wheel', { deltaY: -100 })
  await expect(keep).toHaveValue('100')
  await keep.fill('10')
  await expect(slider).toHaveValue('10')
  await expect(results.getByText('91 of 100 complete traces would be kept')).toBeVisible()
  await expect(list).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add to draft' }).click()
  await expect(list.getByRole('listitem').nth(0)).toContainText('1. gatewayKeep 10%')

  await addRule.click()
  await editor.getByLabel('Service').fill('payments')
  await editor.getByRole('button', { name: 'Add to draft' }).click()
  await list.getByRole('button', { name: 'Move rule 2 up' }).click()
  await expect(list.getByRole('listitem').nth(0)).toContainText('1. paymentsKeep 100%')

  await list.getByRole('button', { name: 'Edit rule 1' }).click()
  const editPayments = draft.getByRole('form', { name: 'Edit rule 1' })
  await editPayments.getByLabel('Keep (%)', { exact: true }).fill('50')
  await expect(ruleResults.getByRole('row', { name: /1\. payments.*1 \/ 2/ })).toBeVisible()
  await editPayments.getByRole('button', { name: 'Cancel' }).click()
  await expect(list.getByRole('listitem').nth(0)).toContainText('1. paymentsKeep 100%')
  await expect(ruleResults.getByRole('row', { name: /1\. payments.*2 \/ 2/ })).toBeVisible()

  await list.getByRole('button', { name: 'Edit rule 2' }).click()
  const editGateway = draft.getByRole('form', { name: 'Edit rule 2' })
  await editGateway.getByLabel('Method').fill('post')
  await editGateway.getByText('Duration and route frequency').click()
  await editGateway.getByLabel('Minimum root span duration (ms)').fill('500')
  await editGateway.getByLabel('Rare routes only').check()
  await editGateway.getByRole('button', { name: 'Update draft rule' }).click()
  await expect(list.getByRole('listitem').nth(1)).toContainText('POST')

  await addRule.click()
  await expect(editor.getByRole('spinbutton', { name: 'Keep (%)' })).toHaveCount(1)
  await editor.getByLabel('Keep (%)', { exact: true }).fill('0')
  await editor.getByRole('button', { name: 'Add to draft' }).click()
  await expect(list.getByRole('listitem').nth(2)).toContainText('3. All tracesKeep 0%')
  await draft.getByRole('button', { name: 'Run preview' }).click()

  await expect(ruleResults.getByRole('row', { name: /1\. payments.*2 \/ 2/ })).toBeVisible()
  await expect(ruleResults.getByRole('row', { name: /2\. gateway.*HTTP 2xx.*1 \/ 10/ })).toBeVisible()
  expect(policies.at(-1)?.rules).toEqual([
    { service: 'payments', scope: 'any_span', keep_percent: 100 },
    { service: 'gateway', scope: 'server_span', http_status: '2xx', method: 'POST', route: '/checkout/:id', minimum_root_duration_ms: 500, require_rare_route: true, keep_percent: 10 },
    { scope: 'any_span', keep_percent: 0 },
  ])
  await expect(results.getByText('3 of 100 complete traces would be kept')).toBeVisible()
  await expect(results.getByText('1 with zero kept')).toBeVisible()
  await list.getByRole('button', { name: 'Remove rule 1' }).click()
  await expect(list.getByRole('listitem').nth(0)).toContainText('1. gateway')
  await expect(results.getByText('Draft changed.', { exact: false })).toBeVisible()
  await expect(ruleResults.getByRole('row', { name: /1\. payments/ })).toBeVisible()
  expect(writes).toEqual([])
  expect(saves).toHaveLength(0)

  await page.setViewportSize({ width: 390, height: 844 })
  for (const section of await page.locator('.sampling-preview, .sampling-table').all()) {
    await expect.poll(() => section.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
  }
  await expect(draft.getByText('Unsaved changes')).toBeVisible()
  await saveRules.click()
  await expect(draft.getByText('Saved for default')).toBeVisible()
  expect(saves).toEqual([{
    window_minutes: 15,
    rules: [
      { service: 'gateway', scope: 'server_span', http_status: '2xx', method: 'POST', route: '/checkout/:id', minimum_root_duration_ms: 500, require_rare_route: true, keep_percent: 10 },
      { scope: 'any_span', keep_percent: 0 },
    ],
  }])
  await page.reload()
  await expect(list.getByRole('listitem').nth(0)).toContainText('1. gateway')
  await expect(list.getByRole('listitem').nth(1)).toContainText('2. All traces')
  await expect(draft.getByLabel('Sample window')).toHaveValue('15')
  await expect(saveRules).toBeDisabled()
})

test('narrows all trace rule pickers when a route, method, status, or scope changes', async ({ page }) => {
  const windows: string[] = []
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/auth/me') {
      return route.fulfill({ json: { user: { id: 'admin', username: 'admin', role: 'admin' } } })
    }
    if (url.pathname === '/api/v1/tenants') return route.fulfill({ json: { tenants: [{ id: 'default', name: 'default', enabled: true }] } })
    if (url.pathname === '/api/v1/frontend/telemetry') return route.fulfill({ status: 204 })
    if (url.pathname === '/api/v1/settings/trace-sampling') return route.fulfill({ json: { window_minutes: 60, rules: [] } })
    if (url.pathname === '/api/v1/traces/sampling-options') {
      windows.push(url.searchParams.get('window_minutes') ?? '')
      return route.fulfill({ json: [
        { service: 'checkout', method: 'GET', route: '/orders/:id', http_status: 200, root: 0, server: 1 },
        { service: 'gateway', method: 'GET', route: '/orders/:id', http_status: 204, root: 1, server: 1 },
        { service: 'gateway', method: 'HEAD', route: '/health', http_status: 503, root: 1, server: 1 },
        { service: 'payments', method: 'POST', route: '/orders/:id', http_status: 201, root: 1, server: 1 },
        { service: 'worker', method: 'GET', route: '/orders/:id', http_status: 200, root: 0, server: 0 },
      ] })
    }
    return route.fulfill({ json: { keys: [], groups: [], users: [], links: [], channels: [], skills: [], values: [], providers: [], mappings: [], sessions: [], routes: [] } })
  })

  await page.goto('/settings#trace-sampling')
  await page.getByRole('button', { name: 'Add a rule' }).click()
  const rule = page.getByRole('form', { name: 'Add a rule' })
  const routeField = rule.getByRole('combobox', { name: 'Route template' })
  const service = rule.getByRole('combobox', { name: 'Service' })
  const method = rule.getByRole('combobox', { name: 'Method' })
  const status = rule.getByRole('combobox', { name: 'HTTP status' })
  const options = rule.getByRole('listbox')

  await routeField.fill('order')
  await expect(options.getByRole('option')).toHaveText(['/orders/:id'])
  await routeField.press('ArrowDown')
  await routeField.press('Enter')
  await expect(routeField).toHaveValue('/orders/:id')
  await rule.getByLabel('Match on').selectOption('server_span')

  await service.click()
  await expect(options.getByRole('option')).toHaveText(['checkout', 'gateway', 'payments'])
  await service.press('Escape')
  await method.click()
  await expect(options.getByRole('option')).toHaveText(['Any', 'GET', 'POST'])
  await options.getByRole('option', { name: 'GET' }).click()
  await status.click()
  await expect(options.getByRole('option')).toHaveText(['Any', '2xx', '200', '204'])
  await options.getByRole('option', { name: '204' }).click()
  await service.click()
  await expect(options.getByRole('option')).toHaveText(['gateway'])
  await options.getByRole('option', { name: 'gateway' }).click()
  await expect(service).toHaveValue('gateway')
  await routeField.click()
  await expect(options.getByRole('option')).toHaveText(['Any', '/orders/:id'])
  await routeField.press('ArrowDown')
  await routeField.press('Enter')
  await expect(routeField).toHaveValue('')
  await method.click()
  await expect(options.getByRole('option')).toHaveText(['Any', 'GET'])
  await options.getByRole('option', { name: 'Any', exact: true }).click()
  await expect(method).toHaveValue('')
  await status.click()
  await expect(options.getByRole('option')).toHaveText(['Any', '2xx', '204', '5xx', '503'])
  await options.getByRole('option', { name: 'Any', exact: true }).click()
  await expect(status).toHaveValue('')
  await rule.getByRole('button', { name: 'Add to draft' }).click()
  const saved = page.getByRole('list', { name: 'Current draft rules' }).getByRole('listitem')
  await expect(saved).toContainText('gateway')
  await expect(saved).not.toContainText('HTTP 204')
  await expect(saved).not.toContainText('GET')
  await expect(saved).not.toContainText('/orders/:id')
  expect(windows).toEqual(['60'])

  await page.getByLabel('Sample window').selectOption('15')
  await expect.poll(() => windows).toEqual(['60', '15'])
})
