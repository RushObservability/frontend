import { test, expect, type Page } from '@playwright/test'

const rules = [
  ['service_name', 'Missing service name', 'high'], ['environment', 'Missing deployment environment', 'high'],
  ['instance', 'Missing service instance ID', 'medium'], ['severity', 'Missing or invalid log severity', 'medium'],
  ['metric_unit', 'Missing metric unit', 'low'], ['unit_conflict', 'Conflicting metric units', 'high'],
  ['label_cardinality', 'High-cardinality metric attribute', 'medium'], ['span_names', 'Likely dynamic span names', 'medium'],
  ['version', 'Missing service version', 'medium'], ['namespace', 'Missing service namespace', 'low'],
  ['sdk_name', 'Missing telemetry SDK name', 'low'], ['sdk_language', 'Missing telemetry SDK language', 'low'],
  ['metric_description', 'Missing metric description', 'low'], ['span_kind', 'Unspecified or invalid span kind', 'medium'],
].map(([id, title, impact]) => ({ id, title, impact, signals: 'Logs, metrics', description: 'A resource check evaluated from the sample.', remediation: 'Set the required resource attribute in your SDK or Collector.' }))

function report(service = 'checkout-api') {
  const finding = (id: string, rule: string, name: string) => ({
    id, rule_id: rule, service: name, subject: '', affected: 100, sampled: 200,
    first_observed: '2026-11-12T10:00:00Z', last_observed: '2026-11-12T11:00:00Z',
    observed: 'Deployment environment is absent', expected: 'deployment.environment.name on the resource',
    versions: [{ version: '2.8.0', sampled: 200, affected: 100 }],
  })
  const serviceRow = (name: string, found: boolean, sampled = 200) => ({
    service: name, status: sampled === 0 ? 'unknown' : found ? 'findings' : 'no_findings_in_sample',
    sampled_records: sampled, finding_count: found ? 1 : 0,
    score: { value: sampled === 0 ? null : 50, passed_weight: sampled === 0 ? 0 : 3, evaluated_weight: sampled === 0 ? 0 : 6, evaluated_checks: sampled === 0 ? 0 : 2, not_evaluated_checks: sampled === 0 ? 14 : 12 },
    checks: rules.map(rule => ({ rule_id: rule.id, status: sampled === 0 ? 'not_evaluated' : rule.id === 'environment' && found ? 'finding' : rule.id === 'service_name' ? 'pass' : 'not_evaluated', sampled, affected: found ? 100 : 0 })),
  })
  return {
    evaluated_at: '2026-11-12T12:00:00Z', from: '2026-11-11T12:00:00Z', to: '2026-11-12T12:00:00Z', minutes: 1440,
    sample_limit_per_source: 1000, sampling: 'Bounded storage-order samples. Percentages describe sampled records only.',
    sources: [{ table: 'logs', signal: 'logs', status: 'available', sampled_records: 200, capped: false }],
    inventory_available: true, inventory_capped: false, partial: false, finding_count: 2, high_impact_findings: 2,
    assessed_services: 2, unknown_services: 1, omitted_findings: 0, omitted_services: 0, rules,
    score: { value: 50, passed_weight: 6, evaluated_weight: 12, evaluated_checks: 4, not_evaluated_checks: 38 },
    history_available: true, history_capped: false, scheduled_at: '2026-11-12T11:58:00Z', cache_hit: true,
    history: [{ id: 'env', service, rule_id: 'environment', status: 'open', first_detected: '2026-11-10T12:00:00Z', last_detected: '2026-11-12T11:58:00Z', last_evaluated: '2026-11-12T11:58:00Z', resolved_at: null, occurrences: 2, latest: finding('env', 'environment', service), changes: [{ at: '2026-11-10T12:00:00Z', kind: 'opened', versions: ['2.7.0'] }, { at: '2026-11-12T11:58:00Z', kind: 'reopened', versions: ['2.8.0'] }] }],
    findings: [finding('env', 'environment', service), finding('unit', 'unit_conflict', 'payments')],
    services: [serviceRow(service, true), serviceRow('payments', true), serviceRow('quiet-worker', false, 0)],
  }
}

async function stub(page: Page, quality: (url: URL, tenant: string) => ReturnType<typeof report> | Promise<ReturnType<typeof report>>, tenants = ['default']) {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = { services: [], views: [] }
    if (url.pathname === '/api/v1/auth/me') body = { user: { id: 'quality-test', username: 'tester', role: 'admin' } }
    if (url.pathname === '/api/v1/tenants') body = { tenants: tenants.map(name => ({ id: name, name, enabled: true })) }
    if (url.pathname === '/api/v1/telemetry-quality') body = await quality(url, route.request().headers()['x-rush-tenant'] ?? 'default')
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }) } catch { /* cancelled request */ }
  })
}

test('findings show actual evidence, versions and service-scoped selection', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/telemetry-quality')
  await expect(page.getByRole('link', { name: 'Telemetry quality', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Missing deployment environment', exact: true })).toBeVisible()
  await expect(page.getByText('100 / 200 records affected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Inspect version evidence' }).click()
  await expect(page.getByRole('cell', { name: '2.8.0', exact: true })).toBeVisible()
  await page.getByLabel('Filter findings by service').selectOption('service:payments')
  await expect(page.getByRole('heading', { name: 'Conflicting metric units', exact: true })).toBeVisible()
  await expect(page.locator('.tq-finding')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Services', exact: true }).click()
  await expect(page.getByRole('row', { name: /quiet-worker/ })).toContainText('Not evaluated')
  await expect(page.getByRole('row', { name: /quiet-worker/ })).toContainText('Unknown · no sampled data')
  await page.getByRole('tab', { name: 'Rule coverage' }).click()
  await expect(page.getByText('Rush sample score v1 is', { exact: false })).toBeVisible()
})

test('unavailable sources remain explicitly incomplete with unknown services', async ({ page }) => {
  await stub(page, () => {
    const result = report()
    result.partial = true
    result.sources[0]!.status = 'unavailable'
    result.sources[0]!.sampled_records = 0
    result.findings = []
    result.assessed_services = 0
    result.finding_count = 0
    result.services = result.services.map(s => ({ ...s, status: 'unknown', sampled_records: 0, checks: s.checks.map(c => ({ ...c, status: 'not_evaluated' })) }))
    return result
  })
  await page.goto('/telemetry-quality')
  await expect(page.getByText('Analysis incomplete', { exact: true })).toBeVisible()
  await expect(page.getByText('No telemetry assessed', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Rule coverage' }).click()
  await expect(page.getByRole('cell', { name: 'Not evaluated · unavailable', exact: true })).toBeVisible()
})

test('a newer time window owns the results while the old request is pending', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let firstStarted = false
  await stub(page, async url => {
    if (url.searchParams.get('minutes') === '1440') { firstStarted = true; await pending; return report('old-window') }
    return report('new-window')
  })
  await page.goto('/telemetry-quality')
  await expect.poll(() => firstStarted).toBe(true)
  await page.getByRole('button', { name: 'Last 24h' }).click()
  await page.getByRole('button', { name: 'Last 6h', exact: true }).click()
  await expect(page.locator('.tq-detail-service')).toContainText('new-window')
  release()
  await expect(page.locator('.tq-detail-service')).toContainText('new-window')
  await expect(page.getByText('old-window', { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/minutes=360/)
})

test('tenant changes clear pending results and never show the previous tenant response', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let started = false
  await stub(page, async (_url, tenant) => {
    if (tenant === 'default') { started = true; await pending; return report('old-tenant-service') }
    return report('new-tenant-service')
  }, ['default', 'customer-b'])
  await page.goto('/telemetry-quality')
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: /default/i }).filter({ has: page.locator('.tenant-name') }).click()
  await page.getByRole('menuitem', { name: 'customer-b', exact: true }).click()
  await expect(page.locator('.tq-detail-service')).toContainText('new-tenant-service')
  release()
  await expect(page.locator('.tq-detail-service')).toContainText('new-tenant-service')
  await expect(page.getByText('old-tenant-service', { exact: true })).toHaveCount(0)
})

test('a failed request is recoverable and is never presented as a clean sample', async ({ page }) => {
  let fail = true
  await stub(page, () => report())
  await page.route('**/api/v1/telemetry-quality?**', async route => {
    if (fail) await route.fulfill({ status: 403, body: '' })
    else await route.fulfill({ contentType: 'application/json', body: JSON.stringify(report()) })
  })
  await page.goto('/telemetry-quality')
  await expect(page.getByText('Quality analysis unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('.tq-summary')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Missing deployment environment', exact: true })).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`findings and evidence fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await stub(page, () => report('checkout-api-with-a-long-service-name'))
    await page.goto('/telemetry-quality')
    await expect(page.getByRole('heading', { name: 'Recommended fix' })).toBeVisible()
    if (width === 390) {
      await page.getByRole('button', { name: /Conflicting metric units payments/ }).click()
      await expect(page.getByRole('heading', { name: 'Conflicting metric units', exact: true })).toBeInViewport()
      await page.getByRole('button', { name: 'Back to findings', exact: true }).click()
      await expect(page.locator('.tq-finding').first()).toBeInViewport()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`quality-${width}.png`), fullPage: true })
  })
}


test('saved history shows lifecycle and affected versions separately from the sample', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/telemetry-quality')
  await expect(page.getByText('Tracked since', { exact: true })).toBeVisible()
  await expect(page.locator('.tq-summary')).toContainText('Rush sample score')
  await expect(page.locator('.tq-summary')).toContainText('38 not evaluated')
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Missing deployment environment', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Finding timeline' })).toContainText('Reopened')
  await expect(page.getByRole('region', { name: 'Finding timeline' })).toContainText('Affected versions: 2.8.0')
  await page.getByLabel('Filter history by status').selectOption('resolved')
  await expect(page.getByText('No saved findings match these filters')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Finding timeline' })).toHaveCount(0)
})

test('history failure and truncation are visible without hiding current findings', async ({ page }) => {
  let unavailable = true
  await stub(page, () => { const result = report(); result.history_available = !unavailable; result.history_capped = true; return result })
  await page.goto('/telemetry-quality?view=history')
  await expect(page.getByText('Finding history unavailable', { exact: true })).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Showing the 500 most recently updated findings.', { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: /^Findings/ }).click()
  await expect(page.getByRole('heading', { name: 'Missing deployment environment', exact: true })).toBeVisible()
})

test('unevaluated services have no numeric sample score', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/telemetry-quality?view=services')
  await expect(page.getByRole('row', { name: /quiet-worker/ })).toContainText('Not evaluated')
  await expect(page.getByRole('row', { name: /quiet-worker/ })).not.toContainText('100 / 100')
})


test('saved finding timeline stays reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page, () => report())
  await page.goto('/telemetry-quality?view=history')
  await page.getByRole('button', { name: 'Missing deployment environment', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Finding timeline' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Back to history', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Missing deployment environment', exact: true })).toBeInViewport()
})

test('the Instrumentation Score is shown as incomplete, with every spec rule accounted for', async ({ page }) => {
  const standardRules = [
    { id: 'RES-005', description: 'service.name is present.', impact: 'Critical', weight: 40, implemented: true, note: '' },
    { id: 'RES-007', description: 'deployment.environment.name is present.', impact: 'Important', weight: 30, implemented: true, note: '' },
    { id: 'LOG-003', description: 'Log records do not contain sensitive data.', impact: 'Critical', weight: 40, implemented: false, note: 'Needs sensitive-data detection over values Rush\'s quality scan does not read.' },
  ]
  const score = (value: number | null, category: string | null) => ({ value, category, passed_weight: 40, evaluated_weight: 70, evaluated_rules: 2, not_evaluated_rules: 0 })
  await stub(page, () => {
    const base = report()
    return {
      ...base,
      standard_spec: 'instrumentation-score/spec@ef080a8 (2026-10-30)',
      standard_rules: standardRules,
      instrumentation_score: score(57.14, 'Needs Improvement'),
      services: base.services.map((s, i) => ({
        ...s,
        instrumentation_score: i === 2 ? score(null, null) : score(57.14, 'Needs Improvement'),
        standard: [{ rule_id: 'RES-005', status: i === 2 ? 'not_evaluated' : 'pass', sampled: 200, affected: 0 }, { rule_id: 'RES-007', status: i === 2 ? 'not_evaluated' : 'finding', sampled: 200, affected: 200 }],
      })),
    }
  })
  await page.goto('/telemetry-quality')
  const card = page.locator('.tq-stat').filter({ hasText: 'Instrumentation Score' })
  await expect(card).toContainText('57.14 / 100')
  await expect(card).toContainText('Needs Improvement · Incomplete: 2 of 3 spec rules implemented')
  await page.getByRole('tab', { name: 'Services' }).click()
  await expect(page.getByRole('cell', { name: '57.14 · Needs Improvement' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'See rules' }).click()
  await expect(page.getByRole('heading', { name: 'Instrumentation Score rules' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'LOG-003' })).toHaveAttribute('href', 'https://github.com/instrumentation-score/spec/blob/main/rules/LOG-003.md')
  await expect(page.getByText(/Not implemented: Needs sensitive-data detection/)).toBeVisible()
  await expect(page.getByText('Critical · 40').first()).toBeVisible()
})

test('reports saved before the Instrumentation Score keep the Rush score only', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/telemetry-quality')
  await expect(page.getByText('Rush sample score', { exact: true })).toBeVisible()
  await expect(page.getByText('Instrumentation Score', { exact: true })).toHaveCount(0)
})
