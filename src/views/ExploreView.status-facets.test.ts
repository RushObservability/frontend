import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function quickFiltersSource(): string {
  const start = source.indexOf('function getQuickFilters(): Filter[]')
  const end = source.indexOf('function toggleQuickService(', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Explore status facets', () => {
  it('sends the Logs-mode Status facet to the server as a severity filter', () => {
    const body = quickFiltersSource()
    const logsBranch = body.match(/if \(viewMode\.value === 'logs'\) return (.+)/)?.[1] ?? ''
    expect(logsBranch).toContain('logStatusFacetFilters(quickStatusRange.value, quickErrorOnly.value)')
  })

  it('keeps span-only controls out of logs queries', () => {
    const body = quickFiltersSource()
    const logsReturn = body.indexOf("if (viewMode.value === 'logs') return")
    for (const spanOnly of ["field: 'status'", "field: 'http_method'", "field: 'http_status_code'", "field: 'duration_ns'"]) {
      expect(body.indexOf(spanOnly), spanOnly).toBeGreaterThan(logsReturn)
    }
  })
})
