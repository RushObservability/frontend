import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>('./**/*.vue', { query: '?raw', import: 'default', eager: true })

describe('links that open a new tab', () => {
  it('do not send the referrer', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      (source.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? [])
        .filter((tag) => !/rel="[^"]*\bnoreferrer\b/.test(tag))
        .map((tag) => `${file}: ${tag}`))

    expect(offenders).toEqual([])
  })
})
