import { test, expect, type Page } from '@playwright/test'

function report(service = 'checkout-api') {
  const rules = [
    ['verbose_logs', 'Verbose log volume', 'logs'], ['repeated_logs', 'Repeated low-severity messages', 'logs'],
    ['large_logs', 'Large low-severity log bodies', 'logs'], ['health_spans', 'Successful health-check spans', 'traces'],
    ['static_spans', 'Successful static-asset spans', 'traces'], ['short_spans', 'Very short internal spans', 'traces'],
    ['duplicate_spans', 'Repeated identical spans', 'traces'], ['metric_cardinality', 'High-cardinality metric attributes', 'metrics'], ['metric_cadence', 'Frequent metric reporting', 'metrics'],
  ].map(([id, title, signal]) => ({ id: id!, title: title!, signal: signal!, threshold: 'At least 100 observations are needed for this review.', recommendation: 'Review the collection level for this service and environment.', safeguard: 'Keep warnings, errors and required audit records.' }))
  const finding = (id: string, rule: string, name: string, signal: string) => ({
    id, rule_id: rule, service: name, signal, source: signal === 'traces' ? 'spans' : signal, subject: '', confidence: 'review',
    candidate_records: 80, sampled_records: 200, candidate_body_bytes: signal === 'logs' ? 16384 : null,
    first_observed: '2026-11-12T10:00:00Z', last_observed: '2026-11-12T10:01:00Z', evidence: [{ label: 'Known-severity logs', value: '200' }],
  })
  return {
    evaluated_at: '2026-11-12T12:00:00Z', from: '2026-11-11T12:00:00Z', to: '2026-11-12T12:00:00Z', minutes: 1440,
    sample_limit_per_source: 1000, cache_hit: true, cache_ttl_seconds: 60, partial: false,
    sources: [{ table: 'logs', signal: 'logs', status: 'available', sampled_records: 200, capped: true }, { table: 'spans', signal: 'traces', status: 'available', sampled_records: 200, capped: false }],
    rules, checks: rules.map(r => ({ rule_id: r.id, status: r.id === 'verbose_logs' ? 'finding' : 'not_evaluated', evaluated_groups: r.id === 'verbose_logs' ? 1 : 0, insufficient_groups: 1, findings: r.id === 'verbose_logs' ? 1 : 0 })),
    findings: [finding('verbose', 'verbose_logs', service, 'logs'), finding('health', 'health_spans', 'gateway', 'traces')],
    finding_count: 2, omitted_findings: 0, services: [service, 'gateway'], omitted_services: 0, sampled_records: 400, sampled_log_body_bytes: 32768,
    methodology: 'Bounded storage-order samples. Candidate counts and bytes can overlap and must not be added as savings. No collection settings are changed.',
  }
}
async function stub(page: Page, advisor: (url: URL, tenant: string) => ReturnType<typeof report> | Promise<ReturnType<typeof report>>, tenants = ['default']) {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = { services: [], views: [] }
    if (url.pathname === '/api/v1/auth/me') body = { user: { id: 'noise-test', username: 'tester', role: 'admin' } }
    if (url.pathname === '/api/v1/tenants') body = { tenants: tenants.map(name => ({ id: name, name, enabled: true })) }
    if (url.pathname === '/api/v1/noise-waste') body = await advisor(url, route.request().headers()['x-rush-tenant'] ?? 'default')
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }) } catch { /* cancelled */ }
  })
}

test('recommendations show evidence, safeguards, content bytes and scoped Explore links', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/noise-waste')
  await expect(page.getByRole('link', { name: 'Noise & waste', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Verbose log volume', exact: true })).toBeVisible()
  await expect(page.getByText('16 KiB uncompressed · sampled log bodies only', { exact: true })).toBeVisible()
  await expect(page.getByText('Keep warnings, errors and required audit records.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Explore service data', exact: true })).toHaveAttribute('href', /service=checkout-api/)
  await expect(page.getByRole('link', { name: 'Explore service data', exact: true })).toHaveAttribute('href', /mode=logs/)
  await page.getByLabel('Filter recommendations by signal').selectOption('traces')
  await expect(page.getByRole('heading', { name: 'Successful health-check spans', exact: true })).toBeVisible()
  await expect(page.getByText('Candidate body bytes', { exact: true })).toHaveCount(0)
  await expect(page.locator('.nw-finding')).toHaveCount(1)
})

test('coverage exposes unknown groups, unavailable sources and sample caps', async ({ page }) => {
  await stub(page, () => { const r = report(); r.partial = true; r.sources[1]!.status = 'unavailable'; return r })
  await page.goto('/noise-waste?view=coverage')
  await expect(page.getByText('Analysis incomplete', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Repeated identical spans/ })).toContainText('Not evaluated')
  await expect(page.getByRole('cell', { name: 'Unavailable · not evaluated', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Logs Available/ })).toContainText('Yes')
})

test('no sampled data remains unknown rather than an efficiency claim', async ({ page }) => {
  await stub(page, () => { const r = report(); r.findings = []; r.finding_count = 0; r.sampled_records = 0; return r })
  await page.goto('/noise-waste')
  await expect(page.getByText('No telemetry assessed', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected recommendation' })).toHaveCount(0)
})

test('window changes supersede older pending results and update the URL immediately', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let started = false
  await stub(page, async url => { if (url.searchParams.get('minutes') === '1440') { started = true; await pending; return report('old-window') } return report('new-window') })
  await page.goto('/noise-waste')
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: 'Last 24h', exact: true }).click()
  await page.getByRole('button', { name: 'Last 6h', exact: true }).click()
  await expect(page).toHaveURL(/minutes=360/)
  await expect(page.locator('.nw-detail-service')).toContainText('new-window')
  release()
  await expect(page.getByText('old-window', { exact: true })).toHaveCount(0)
})

test('tenant switches never expose the previous pending response', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let started = false
  await stub(page, async (_url, tenant) => { if (tenant === 'default') { started = true; await pending; return report('old-tenant') } return report('new-tenant') }, ['default', 'customer-b'])
  await page.goto('/noise-waste')
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: /default/i }).filter({ has: page.locator('.tenant-name') }).click()
  await page.getByRole('menuitem', { name: 'customer-b', exact: true }).click()
  await expect(page.locator('.nw-detail-service')).toContainText('new-tenant')
  release()
  await expect(page.getByText('old-tenant', { exact: true })).toHaveCount(0)
})

test('failed requests can be retried without a fake clean assessment', async ({ page }) => {
  let fail = true
  await stub(page, () => report())
  await page.route('**/api/v1/noise-waste?**', async route => { if (fail) await route.fulfill({ status: 503, body: '' }); else await route.fulfill({ contentType: 'application/json', body: JSON.stringify(report()) }) })
  await page.goto('/noise-waste')
  await expect(page.getByText('Advisor unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('.nw-overview')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Verbose log volume', exact: true })).toBeVisible()
})

test('deep-linked recommendations and service filters stay aligned', async ({ page }) => {
  await stub(page, () => report())
  await page.goto('/noise-waste?finding=health&service=gateway')
  await expect(page.getByRole('heading', { name: 'Successful health-check spans', exact: true })).toBeVisible()
  await expect(page.locator('.nw-finding')).toHaveCount(1)
  await page.getByLabel('Filter recommendations by service').selectOption('*')
  await expect(page.locator('.nw-finding')).toHaveCount(2)
})

for (const width of [1440, 390]) {
  test(`recommendations and evidence fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await stub(page, () => report('checkout-service-with-a-long-name-and-resource-suffix'))
    await page.goto('/noise-waste')
    await expect(page.getByRole('heading', { name: 'Suggested change', exact: true })).toBeVisible()
    if (width === 390) {
      await page.getByRole('button', { name: /Successful health-check spans gateway/ }).click()
      await expect(page.getByRole('heading', { name: 'Successful health-check spans', exact: true })).toBeInViewport()
      await page.getByRole('button', { name: 'Back to recommendations', exact: true }).click()
      await expect(page.locator('.nw-finding').first()).toBeInViewport()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`noise-waste-${width}.png`), fullPage: true })
  })
}

test('deep links, pagination and service filters keep the selected recommendation visible', async ({ page }) => {
  await stub(page, () => {
    const r = report()
    r.findings = Array.from({ length: 25 }, (_, i) => ({ ...r.findings[0]!, id: `row-${i}`, service: `sample-svc-${i}` }))
    r.finding_count = 25
    return r
  })
  await page.goto('/noise-waste?finding=row-24')
  await expect(page.locator('.nw-pagination')).toContainText('2 / 2')
  await expect(page.locator('.nw-finding')).toHaveCount(5)
  await expect(page.locator('.nw-detail-service')).toContainText('sample-svc-24')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.locator('.nw-pagination')).toContainText('1 / 2')
  await expect(page.locator('.nw-detail-service')).toContainText('sample-svc-0')
  await page.getByLabel('Filter recommendations by service').selectOption('service:sample-svc-24')
  await expect(page.locator('.nw-finding')).toHaveCount(1)
  await expect(page.locator('.nw-detail-service')).toContainText('sample-svc-24')
})

test('unknown log bytes and keyboard navigation remain explicit', async ({ page }) => {
  await stub(page, () => {
    const r = report(); r.partial = true; r.sources[0]!.status = 'unavailable'; r.sources[0]!.sampled_records = 0
    r.findings = r.findings.filter(f => f.signal !== 'logs'); r.finding_count = r.findings.length; r.sampled_log_body_bytes = 0
    return r
  })
  await page.goto('/noise-waste')
  await page.getByRole('tab', { name: 'Recommendations', exact: true }).press('End')
  await expect(page.getByRole('tab', { name: 'Coverage & method', exact: true })).toBeFocused()
  await expect(page.getByText('Log body bytes were not evaluated because the log source was unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Coverage & method', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Recommendations', exact: true })).toBeFocused()
})
