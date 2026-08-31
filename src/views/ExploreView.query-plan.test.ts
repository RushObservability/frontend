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
  it('loads rows and summaries independently for an initial search', () => {
    const search = between('async function search(', 'async function loadMore(')
    expect(search.match(/api\.queryExplore\(/g)).toHaveLength(1)
    expect(search).toContain('settleExploreRequest({')
    expect(search).toContain('include_rows: true')
    expect(search).toContain('include_summary: false')
    expect(search).toContain('include_rows: false')
    expect(search).toContain('include_summary: true')
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

  it('loads rows and summaries independently for each live refresh', () => {
    const livePoll = between('async function livePoll(', 'const liveLoop =')
    expect(livePoll.match(/api\.queryExplore\(/g)).toHaveLength(1)
    expect(livePoll).toContain('settleExploreRequest({')
    expect(livePoll).toContain('include_rows: true')
    expect(livePoll).toContain('include_summary: false')
    expect(livePoll).not.toContain('api.queryEvents(')
    expect(livePoll).not.toContain('api.queryCount(')
    expect(livePoll).not.toContain('api.countLogs(')
  })
})
