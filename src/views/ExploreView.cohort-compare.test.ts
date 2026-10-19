import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore cohort comparison', () => {
  // Regression: "Compare with baseline" sent the structured filters but dropped
  // the free-text search, so cohort A / baseline B covered every span in range
  // instead of the spans matching the query shown in "Ready to compare".
  it('scopes the BubbleUp request to the same filters and free-text search as the cohort preview', () => {
    const preview = between('async function loadScatterCohortRows(', 'function setScatterSelection(')
    expect(preview).toContain('getActiveFilters()')
    expect(preview).toContain('search: searchText.value || undefined')

    const compare = between('async function runBubbleUp()', 'function closeBubbleUp()')
    const bubbleUpCall = compare.slice(compare.indexOf('api.bubbleUp({'))
    expect(bubbleUpCall).toMatch(/\bsearch: searchParam,/)
    expect(bubbleUpCall).toMatch(/filters: viewMode\.value === 'logs' \? getLogFilters\(activeFilters\) : activeFilters,/)

    // searchText is re-derived by getActiveFilters() (parseSearch), so it must be
    // read after the filters are resolved, before the request is sent.
    const filtersAt = compare.indexOf('const activeFilters = getActiveFilters()')
    const searchAt = compare.indexOf('const searchParam = searchText.value || undefined')
    expect(filtersAt).toBeGreaterThanOrEqual(0)
    expect(searchAt).toBeGreaterThan(filtersAt)
    expect(compare.indexOf('api.bubbleUp({')).toBeGreaterThan(searchAt)
  })
})
