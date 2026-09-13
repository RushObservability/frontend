import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'

const styles = readFileSync(new URL('../styles/views/ExploreView.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const view = readFileSync(new URL('./ExploreView.vue', import.meta.url), 'utf8')

describe('Explore search focus', () => {
  it('matches the global search highlight without an inner input outline', () => {
    const search = styles.match(/\.search-bar:hover,\s*\.search-bar:focus-within\s*\{([^}]+)\}/)?.[1]
    const global = app.match(/\.global-search:hover,\s*\.global-search:focus-visible\s*\{([^}]+)\}/)?.[1]
    expect(search).toBeDefined()
    expect(search?.trim()).toBe(global?.trim())
    expect(styles).toMatch(/\.search-input:focus-visible\s*\{\s*outline: none;/)
  })

  it('preserves high-contrast focus and gives both search modes accessible names', () => {
    expect(styles).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.search-bar:focus-within\s*\{\s*outline: 2px solid Highlight;/)
    expect(styles).toContain('.search-bar.nl-mode:not(:focus-within):not(:hover)')
    expect(view).toContain('aria-label="Search traces and logs"')
    expect(view).toContain('aria-label="Natural language search"')
  })
})
