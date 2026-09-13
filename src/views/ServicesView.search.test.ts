import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'

const styles = readFileSync(new URL('../styles/views/ServicesView.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const view = readFileSync(new URL('./ServicesView.vue', import.meta.url), 'utf8')

describe('Services filter focus', () => {
  it('matches the global search hover and focus treatment', () => {
    const filter = styles.match(/\.services-search:hover,\s*\.services-search:focus-within\s*\{([^}]+)\}/)?.[1]
    const global = app.match(/\.global-search:hover,\s*\.global-search:focus-visible\s*\{([^}]+)\}/)?.[1]
    expect(filter).toBeDefined()
    expect(filter?.trim()).toBe(global?.trim())
  })

  it('replaces the inner outline with an accessible whole-control indicator', () => {
    expect(styles).toMatch(/\.services-search-input:focus-visible\s*\{\s*outline: none;/)
    expect(styles).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.services-search:focus-within\s*\{\s*outline: 2px solid Highlight;/)
    expect(view).toContain('aria-label="Filter services"')
  })
})
