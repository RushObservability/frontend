import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from './searchQuery'

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
