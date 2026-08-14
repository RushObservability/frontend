import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore query plan', () => {
  it('uses only the coordinated endpoint for an initial search', () => {
    const search = between('async function search(', 'async function loadMore(')
    expect(search.match(/api\.queryExplore\(/g)).toHaveLength(1)
    for (const legacyCall of [
      'api.queryEvents(',
      'api.queryLogs(',
      'api.queryCount(',
      'api.countLogs(',
      'api.queryGroup(',
      'api.getLogHistogram(',
    ]) {
      expect(search).not.toContain(legacyCall)
    }
  })

  it('uses only the coordinated endpoint for each live refresh', () => {
    const livePoll = between('async function livePoll(', 'const liveLoop =')
    expect(livePoll.match(/api\.queryExplore\(/g)).toHaveLength(1)
    expect(livePoll).not.toContain('api.queryEvents(')
    expect(livePoll).not.toContain('api.queryCount(')
    expect(livePoll).not.toContain('api.countLogs(')
  })
})
