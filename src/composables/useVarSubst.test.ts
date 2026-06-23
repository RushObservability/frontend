import { describe, it, expect } from 'vitest'
import { referencedVars, substitute, applyVarsToFilters } from './useVarSubst'
import { VAR_ALL, type Filter } from '../types'

describe('referencedVars', () => {
  it('finds bare $name tokens', () => {
    expect(referencedVars('rate($service)')).toEqual(['service'])
  })

  it('finds braced ${name} tokens', () => {
    expect(referencedVars('${env}_latency')).toEqual(['env'])
  })

  it('finds multiple distinct references in order', () => {
    expect(referencedVars('$a + ${b} - $a')).toEqual(['a', 'b', 'a'])
  })

  it('returns nothing for a string with no tokens', () => {
    expect(referencedVars('plain text')).toEqual([])
  })
})

describe('substitute', () => {
  it('replaces a known variable with its value', () => {
    expect(substitute('svc=$service', { service: 'payments' })).toBe('svc=payments')
  })

  it('replaces braced tokens too', () => {
    expect(substitute('${region}-1', { region: 'us-east' })).toBe('us-east-1')
  })

  it('leaves unknown variables untouched', () => {
    expect(substitute('$known/$unknown', { known: 'x' })).toBe('x/$unknown')
  })

  it('expands the "All" sentinel to the default allValue', () => {
    expect(substitute('$service', { service: VAR_ALL })).toBe('*')
  })

  it('honours a custom allValue (e.g. PromQL regex)', () => {
    expect(substitute('$service', { service: VAR_ALL }, '.*')).toBe('.*')
  })

  it('passes empty/undefined strings through unchanged', () => {
    expect(substitute('', { a: '1' })).toBe('')
  })
})

describe('applyVarsToFilters', () => {
  const f = (key: string, value: string): Filter =>
    ({ field: key, op: '=', value }) as unknown as Filter

  it('substitutes variable references in filter values', () => {
    const out = applyVarsToFilters([f('service_name', '$service')], { service: 'cart' })
    expect(out).toHaveLength(1)
    expect(String(out[0]!.value)).toBe('cart')
  })

  it('drops a filter whose variable is set to "All"', () => {
    const out = applyVarsToFilters([f('service_name', '$service')], { service: VAR_ALL })
    expect(out).toHaveLength(0)
  })

  it('keeps literal filters with no variable references intact', () => {
    const filters = [f('status', 'error')]
    const out = applyVarsToFilters(filters, { service: 'cart' })
    expect(out).toHaveLength(1)
    expect(String(out[0]!.value)).toBe('error')
  })
})
