import { describe, expect, it } from 'vitest'
import { filtersToSearch, parseSearchQuery } from './searchQuery'

describe('parseSearchQuery', () => {
  it('splits filters from free text', () => {
    expect(parseSearchQuery('  service_name=checkout status!=ok  card declined duration_ms>=2000 path~/api ')).toEqual({
      filters: [
        { field: 'service_name', op: '=', value: 'checkout' },
        { field: 'status', op: '!=', value: 'ok' },
        { field: 'duration_ms', op: '>=', value: '2000' },
        { field: 'path', op: 'LIKE', value: '/api' },
      ],
      text: ['card', 'declined'],
    })
  })

  it('returns nothing for an empty box', () => {
    expect(parseSearchQuery('   ')).toEqual({ filters: [], text: [] })
  })
})

describe('filtersToSearch', () => {
  it('writes filters the parser reads back and keeps the rest', () => {
    const { search, rest } = filtersToSearch([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '>=', value: 500 },
      { field: 'path', op: 'LIKE', value: '/api' },
      { field: 'parent_span_id', op: '=', value: '' },
      { field: 'region', op: 'IN', value: 'us,eu' },
      { field: 'message', op: '=', value: 'card declined' },
    ])
    expect(search).toBe('service_name=checkout http_status_code>=500 path~/api')
    expect(parseSearchQuery(search).filters).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '>=', value: '500' },
      { field: 'path', op: 'LIKE', value: '/api' },
    ])
    expect(rest.map(f => f.field)).toEqual(['parent_span_id', 'region', 'message'])
  })
})
