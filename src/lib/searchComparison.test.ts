import { describe, expect, it } from 'vitest'
import { parseSearchComparison } from './searchComparison'

describe('autocomplete comparison tokens', () => {
  it.each(['=', '!=', '>=', '<=', '>', '<'])('recognizes %s and keeps an empty prefix', operator => {
    expect(parseSearchComparison(`attributes.http.status${operator}`)).toEqual({
      field: 'attributes.http.status', operator, value: '',
    })
  })

  it.each(['', 'service_name', '=value', '!value', '<value', 'field!value'])('rejects an incomplete field or operator: %s', token => {
    expect(parseSearchComparison(token)).toBeNull()
  })

  it.each(['"Example Air"', 'a>=b', '<!-- -->', '<!-- --!>', '<img src=x onerror=alert(1)>'])('preserves the value as text: %s', value => {
    expect(parseSearchComparison(`log.message=${value}`)).toEqual({ field: 'log.message', operator: '=', value })
  })

  it('preserves arbitrary attribute names and Unicode field offsets', () => {
    expect(parseSearchComparison('attributes.k8s.io/🚀!=launch')).toEqual({
      field: 'attributes.k8s.io/🚀', operator: '!=', value: 'launch',
    })
  })
})
