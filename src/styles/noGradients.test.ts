import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readdirSync, readFileSync } from 'fs'

interface DirectoryEntry {
  name: string
  isDirectory: () => boolean
}

function styleSources(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }) as DirectoryEntry[]
  return entries.flatMap((entry) => {
    const path = `${directory.replace(/\/$/, '')}/${entry.name}`
    if (entry.isDirectory()) return styleSources(path)
    return /\.(css|vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('flat color design rule', () => {
  it('does not use CSS gradients', () => {
    const sourceRoot = new URL('..', import.meta.url).pathname
    const gradient = new RegExp('(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\\(', 'i')
    const offenders = styleSources(sourceRoot)
      .filter((path) => gradient.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})
