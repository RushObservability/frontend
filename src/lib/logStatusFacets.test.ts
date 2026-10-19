import { describe, expect, it } from 'vitest'
import { logStatusFacetFilters } from './logStatusFacets'

describe('logs status facet filters', () => {
  it('maps Error / Warning / Info to the severity ranges the facet counts use', () => {
    expect(logStatusFacetFilters('5xx', false)).toEqual([
      { field: 'severity_number', op: '>=', value: 17 },
    ])
    expect(logStatusFacetFilters('4xx', false)).toEqual([
      { field: 'severity_number', op: '>=', value: 13 },
      { field: 'severity_number', op: '<', value: 17 },
    ])
    expect(logStatusFacetFilters('2xx', false)).toEqual([
      { field: 'severity_number', op: '<', value: 13 },
    ])
  })

  it('maps "Errors only" to error severity without duplicating the Error facet', () => {
    expect(logStatusFacetFilters('', true)).toEqual([
      { field: 'severity_number', op: '>=', value: 17 },
    ])
    expect(logStatusFacetFilters('5xx', true)).toEqual([
      { field: 'severity_number', op: '>=', value: 17 },
    ])
  })

  it('adds nothing when no status facet is selected', () => {
    expect(logStatusFacetFilters('', false)).toEqual([])
  })

  it('never filters on a "status" field, which in logs is a custom attribute', () => {
    for (const range of ['', '2xx', '4xx', '5xx']) {
      for (const errorsOnly of [false, true]) {
        const fields = logStatusFacetFilters(range, errorsOnly).map(f => f.field)
        expect(fields.every(field => field === 'severity_number')).toBe(true)
      }
    }
  })
})
