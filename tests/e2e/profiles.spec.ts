import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, mode: 'data' | 'empty' | 'error' = 'data') {
  const queries: URL[] = []
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = {}
    if (url.pathname === '/api/v1/auth/me') body = { user: { id: 'profile-reader', username: 'reader', role: 'viewer', display_name: 'Reader' } }
    if (url.pathname === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }, { id: 'other', name: 'other', enabled: true }] }
    if (url.pathname === '/api/v1/profiles/series') body = { series: mode === 'empty' ? [] : [{ service: 'checkout', version: 'v1', pod: 'checkout-1' }, { service: 'checkout', version: 'v2', pod: 'checkout-2' }], truncated: false }
    if (url.pathname === '/api/v1/profiles') {
      queries.push(url)
      if (mode === 'error') { await route.fulfill({ status: 422, body: 'internal details must not appear' }); return }
      const stacks = mode === 'empty' ? [] : [
        { frames: ['main', 'handle', 'encode'], cpu_seconds: 3 },
        { frames: ['main', 'handle', 'parse'], cpu_seconds: 1 },
        { frames: ['main', 'handle', 'database.query', 'decode_rows'], cpu_seconds: 2 },
        { frames: ['main', 'handle', 'database.query', 'read_socket'], cpu_seconds: 1.2 },
        { frames: ['main', 'handle', 'cache.lookup'], cpu_seconds: .8 },
        { frames: ['main', 'handle', 'compress', 'deflate'], cpu_seconds: 1.8 },
        { frames: ['main', 'background', 'runtime.gc'], cpu_seconds: .7 },
        { frames: ['main', 'background', 'flush_metrics'], cpu_seconds: .05 },
      ]
      body = { stacks, total_cpu_seconds: stacks.reduce((sum, s) => sum + s.cpu_seconds, 0), from: Date.parse(url.searchParams.get('from')!), to: Date.parse(url.searchParams.get('to')!), attribution: 'service' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return queries
}

test('profiles appears under Observe without a license or integrations', async ({ page }, info) => {
  const queries = await stub(page)
  await page.goto('/profiles?service=checkout')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('heading', { name: 'Profiles', exact: true })).toBeVisible()
  await expect(page.locator('.app-navigation-group').filter({ has: page.getByRole('heading', { name: 'Observe', exact: true }) }).getByRole('link', { name: 'Profiles', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Profiling', exact: true })).toHaveCount(0)
  await expect(page.locator('.data-table')).toContainText('encode')
  const graphBounds = await page.locator('.graph-pane').boundingBox()
  const tableBounds = await page.locator('.functions-pane').boundingBox()
  const analysisBounds = await page.locator('.analysis-panes').boundingBox()
  expect(graphBounds!.width).toBeGreaterThan(analysisBounds!.width - 3)
  expect(tableBounds!.width).toBeGreaterThan(analysisBounds!.width - 3)
  expect(tableBounds!.y).toBeGreaterThanOrEqual(graphBounds!.y + graphBounds!.height - 1)
  await page.getByRole('button', { name: /^handle, .*Zoom into/ }).click()
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('searchbox', { name: 'Find a function' }).fill('encode')
  await expect(page.locator('.data-table tbody tr')).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Find a function' }).fill('')
  await page.getByRole('button', { name: 'Focus encode in flame graph', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Focused call stack' })).toContainText('encode')
  await expect.poll(async () => (await page.locator('.graph-pane').boundingBox())!.y).toBeLessThan(100)
  await page.getByRole('navigation', { name: 'Focused call stack' }).getByRole('button', { name: 'handle', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Focused call stack' })).not.toContainText('encode')
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('profiles-workspace.png'), fullPage: true })
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByLabel('Compare with').selectOption('previous')
  await expect(page.getByRole('columnheader', { name: /Share change/ })).toBeVisible()
  await expect.poll(() => queries.length).toBeGreaterThanOrEqual(3)
  const previous = queries.at(-1)!
  const current = queries.at(-2)!
  expect(previous.searchParams.get('to')).toBe(current.searchParams.get('from'))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('profiles-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Remove comparison' }).click()
  await expect(page.getByRole('columnheader', { name: /Share change/ })).toHaveCount(0)
  await expect(page).not.toHaveURL(/compare=/)
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toBeVisible()
  await expect(page.locator('.data-table')).toContainText('encode')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: info.outputPath('profiles-dark.png'), fullPage: true })
  const backgrounds = await page.locator('.profiles-page, .profiles-page *').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundImage))
  expect(backgrounds.every(background => !background.includes('gradient'))).toBe(true)
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByRole('combobox', { name: 'Service', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('profiles-mobile.png'), fullPage: true })
})

test('flame graph uses readable Rush-blue CPU bands in both themes', async ({ page }) => {
  await stub(page)
  await page.goto('/profiles?service=checkout')
  await expect(page.locator('.flame-frame.cpu-low').first()).toBeAttached()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme)
    const bands = await page.locator('.profile-flame').evaluate(graph => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      const rgb = (color: string) => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
      }
      const luminance = (color: number[]) => color.map(value => {
        const channel = value / 255
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      return ['cpu-low', 'cpu-medium', 'cpu-high'].map(band => {
        const frame = getComputedStyle(graph.querySelector(`.flame-frame.${band}`)!)
        const swatch = getComputedStyle(graph.querySelector(`.flame-legend .${band}`)!)
        const background = rgb(frame.backgroundColor)
        const a = luminance(background)
        const b = luminance(rgb(frame.color))
        return { background, swatch: rgb(swatch.backgroundColor), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      })
    })
    expect(new Set(bands.map(band => band.background.join(','))).size).toBe(3)
    for (const band of bands) {
      expect(band.background[2]).toBeGreaterThan(band.background[0])
      expect(band.background[2]).toBeGreaterThan(band.background[1])
      expect(band.swatch).toEqual(band.background)
      expect(band.contrast).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('empty profiles explain collection without fabricated data', async ({ page }, info) => {
  await stub(page, 'empty')
  await page.goto('/profiles?service=checkout')
  await expect(page.getByRole('heading', { name: 'No CPU samples in this range' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('profiles-empty.png'), fullPage: true })
  await page.getByRole('button', { name: 'Set up CPU profiling' }).click()
  await expect(page.getByText(/Profiling is built in and requires no integration or paid license/)).toBeVisible()
})

test('service browser gives the unfiltered page a useful starting point', async ({ page }, info) => {
  await stub(page)
  await page.goto('/profiles')
  await expect(page.getByRole('heading', { name: /Profiled services/ })).toBeVisible()
  await expect(page.locator('.page-title')).toHaveText('Profiles')
  await expect(page.getByText('CPU · Preview', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No CPU samples in this range' })).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: 'Find a service' })).toHaveCount(0)
  await expect(page.getByPlaceholder('Filter services')).toHaveCount(0)
  const serviceSelect = page.getByRole('combobox', { name: 'Service', exact: true })
  await expect(serviceSelect).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('profiles-services.png'), fullPage: true, animations: 'disabled' })
  await serviceSelect.selectOption('checkout')
  await expect(page).toHaveURL(/service=checkout/)
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toBeVisible()
  await serviceSelect.selectOption('')
  await expect(page.getByRole('heading', { name: /Profiled services/ })).toBeVisible()
  await page.getByRole('button', { name: 'checkout' }).click()
  await expect(page).toHaveURL(/service=checkout/)
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toBeVisible()
})

test('layouts preserve function focus and search', async ({ page }) => {
  await stub(page)
  await page.goto('/profiles?service=checkout')
  const layouts = page.getByRole('group', { name: 'Profile layout' })
  await layouts.getByRole('button', { name: 'Functions', exact: true }).click()
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toBeHidden()
  await page.getByRole('button', { name: 'Focus encode in flame graph', exact: true }).click()
  await expect(layouts.getByRole('button', { name: 'Both', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('navigation', { name: 'Focused call stack' })).toContainText('encode')
  await layouts.getByRole('button', { name: 'Flame graph', exact: true }).click()
  await expect(page.locator('.data-table')).toBeHidden()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('searchbox', { name: 'Find a function' }).fill('encode')
  await expect(page.locator('.flame-frame.matched')).toHaveCount(1)
  await layouts.getByRole('button', { name: 'Both', exact: true }).click()
  await expect(page.locator('.data-table tbody tr')).toHaveCount(1)
})

test('query failures show an actionable error without stale charts', async ({ page }) => {
  await stub(page, 'error')
  await page.goto('/profiles?service=checkout')
  await expect(page.getByRole('alert')).toContainText('Narrow the time range')
  await expect(page.getByRole('region', { name: 'CPU flame graph' })).toHaveCount(0)
  await expect(page.getByText('internal details must not appear')).toHaveCount(0)
})

test('invalid URL ranges are rejected before querying', async ({ page }) => {
  const queries = await stub(page)
  await page.goto('/profiles?service=checkout&from=bad&to=bad')
  await expect(page.getByRole('alert')).toContainText('valid time range')
  expect(queries).toHaveLength(0)
})
