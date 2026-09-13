import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'

const tableStyles = readFileSync(new URL('../styles/components/DataTable.css', import.meta.url), 'utf8')
const exploreStyles = readFileSync(new URL('../styles/views/ExploreView.css', import.meta.url), 'utf8')
const servicesStyles = readFileSync(new URL('../styles/views/ServicesView.css', import.meta.url), 'utf8')
const servicesView = readFileSync(new URL('../views/ServicesView.vue', import.meta.url), 'utf8')

describe('shared operational table style', () => {
  it('uses the same header and row rhythm as Explore results', () => {
    for (const token of ['--table-head-height', '--table-row-height', '--table-head-size', '--table-row-size']) {
      expect(tableStyles).toContain(`var(${token})`)
      expect(exploreStyles).toContain(`var(${token})`)
    }
  })

  it('uses the Explore header band and row hover colors', () => {
    expect(tableStyles).toContain('background: var(--bg-raised)')
    expect(tableStyles).toContain('border-bottom: 1px solid var(--border-default)')
    expect(tableStyles).toContain('background: var(--bg-hover)')
  })

  it('keeps manual sortable headers padded', () => {
    expect(tableStyles).toContain('.data-table th.sortable')
    expect(tableStyles).not.toContain('.data-table :deep(th.sortable)')
  })

  it('keeps Services name cells in the table layout with flex on an inner wrapper', () => {
    expect(servicesStyles).not.toMatch(/[^{}]*\btd\b[^{}]*\{[^{}]*display:\s*(?:inline-)?(?:flex|grid)/)
    expect(servicesStyles).toMatch(/\.svc-name-cell\s*\{[^{}]*display:\s*flex/)
    expect(servicesView).toMatch(/<span class="svc-name-cell">\s*<span class="svc-dot"[^>]*\/>\s*<span class="svc-name mono">/)
  })
})
