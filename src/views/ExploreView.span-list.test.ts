import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore span list paging', () => {
  const spanBranch = () => between('async function loadMore()', '// ═══ Infinite scroll observer ═══').split('} else {')[1]!

  it('drops a page that returns after a new search replaced the rows', () => {
    const branch = spanBranch()
    expect(branch).toContain('const rows = results.value')
    const guard = branch.indexOf('if (results.value !== rows) return')
    expect(guard).toBeGreaterThan(branch.indexOf('await api.queryEvents('))
    expect(guard).toBeLessThan(branch.indexOf('results.value.push(...page.rows)'))
    expect(guard).toBeLessThan(branch.indexOf('nextCursor.value = page.next_cursor'))
  })

  it('stops infinite scroll at the loaded-span cap and says so', () => {
    expect(source).toContain('const MAX_LOADED_SPAN_ROWS = 10_000')
    expect(spanBranch()).toContain('paginationHasMore.value = Boolean(page.next_cursor) && results.value.length < MAX_LOADED_SPAN_ROWS')
    expect(between('<div class="scroll-sentinel">', '</VirtualTable>'))
      .toMatch(/v-else-if="results.length >= MAX_LOADED_SPAN_ROWS"[^>]*>\s*Showing the first \{\{ MAX_LOADED_SPAN_ROWS.toLocaleString\(\) \}\}[^<]*Narrow your query/)
  })
})
