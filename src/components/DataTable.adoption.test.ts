import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readdirSync, readFileSync } from 'fs'

interface DirectoryEntry {
  name: string
  isDirectory: () => boolean
}

function vueFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }) as DirectoryEntry[]
  return entries.flatMap((entry) => {
    const path = `${directory.replace(/\/$/, '')}/${entry.name}`
    return entry.isDirectory() ? vueFiles(path) : entry.name.endsWith('.vue') ? [path] : []
  })
}

describe('shared table adoption', () => {
  it('keeps native table markup inside DataTable', () => {
    const sourceRoot = new URL('..', import.meta.url).pathname
    const offenders = vueFiles(sourceRoot)
      .filter((path) => !path.endsWith('/components/DataTable.vue'))
      .filter((path) => /<\/?table(?:\s|>)/i.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})
