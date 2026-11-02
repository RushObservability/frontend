import { createServer, type ServerResponse } from 'node:http'
import { test, expect, type Page } from '@playwright/test'

async function stub(page: Page, streamUrl: string) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/investigate') { await route.continue({ url: streamUrl }); return }
    let body: unknown = { sessions: [], templates: [], services: [], views: [] }
    if (path === '/api/v1/auth/me') body = { user: { id: 'tester', username: 'tester', role: 'admin' } }
    if (path === '/api/v1/tenants') body = { tenants: [{ id: 'default', name: 'default', enabled: true }] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

for (const action of ['stop', 'navigate', 'logout'] as const) {
  test(`${action} closes an open investigation and discards late events`, async ({ page }) => {
    let closed = false
    let response: ServerResponse | undefined
    const server = createServer((req, res) => {
      req.resume()
      response = res
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
        'Access-Control-Allow-Credentials': 'true',
      })
      res.write('data: {"type":"thinking_delta","text":"Collecting evidence"}\n\n')
      res.on('close', () => { closed = true })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      await stub(page, `http://127.0.0.1:${address.port}/api/v1/investigate`)
      await page.goto('/investigate?q=Investigate%20CPU')
      await expect(page.getByText('Collecting evidence', { exact: false })).toBeVisible()
      if (action === 'stop') await page.getByRole('button', { name: 'Stop', exact: true }).click()
      else if (action === 'navigate') await page.getByRole('link', { name: 'Services', exact: true }).click()
      else {
        await page.getByRole('button', { name: 'Open user menu', exact: true }).click()
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      }
      await expect.poll(() => closed).toBe(true)
      // A completed cancellation must not leave any reader attached to this response.
      if (response && !response.destroyed) response.end('data: {"type":"summary","text":"Late evidence"}\n\n')
      await expect(page.getByText('Late evidence', { exact: true })).toHaveCount(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}
