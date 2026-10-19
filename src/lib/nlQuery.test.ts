import { describe, expect, it } from 'vitest'
import { parseNaturalQuery } from './nlQuery'

describe('parseNaturalQuery — logs mode', () => {
  it('maps "errors from notifications" to a service + error level', () => {
    const r = parseNaturalQuery('errors from notifications', 'logs')
    expect(r.chips).toEqual([
      { field: 'service_name', op: '=', value: 'notifications' },
      { field: 'level', op: '=', value: 'error' },
    ])
    expect(r.search).toBe('')
  })

  it('consumes "server errors" without leaving "server" as free text', () => {
    const r = parseNaturalQuery('server errors from gateway', 'logs')
    expect(r.chips).toEqual([
      { field: 'service_name', op: '=', value: 'gateway' },
      { field: 'level', op: '=', value: 'error' },
    ])
    expect(r.search).toBe('')
  })

  it('keeps warning and debug levels', () => {
    expect(parseNaturalQuery('warnings from checkout', 'logs').chips)
      .toContainEqual({ field: 'level', op: '=', value: 'warn' })
    expect(parseNaturalQuery('debug logs', 'logs').chips)
      .toContainEqual({ field: 'level', op: '=', value: 'debug' })
  })

  it('leaves unrecognized words as search text', () => {
    const r = parseNaturalQuery('database connection timeout', 'logs')
    expect(r.chips).toEqual([])
    expect(r.search).toBe('database connection timeout')
  })
})

describe('parseNaturalQuery — APM (spans) mode', () => {
  it('never emits a level filter for errors', () => {
    const r = parseNaturalQuery('errors from notifications', 'spans')
    expect(r.chips).toEqual([
      { field: 'service_name', op: '=', value: 'notifications' },
      { field: 'http_status_code', op: '>=', value: 500 },
    ])
    expect(r.chips.some(c => c.field === 'level')).toBe(false)
    expect(r.search).toBe('')
  })

  it('turns "server errors from gateway" into a 5xx filter with no stray words', () => {
    const r = parseNaturalQuery('server errors from gateway', 'spans')
    expect(r.chips).toEqual([
      { field: 'service_name', op: '=', value: 'gateway' },
      { field: 'http_status_code', op: '>=', value: 500 },
    ])
    expect(r.search).toBe('')
  })

  it('maps client errors and 5xx to http_status_code', () => {
    expect(parseNaturalQuery('client errors from checkout', 'spans').chips).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '>=', value: 400 },
    ])
    expect(parseNaturalQuery('5xx from checkout', 'spans').chips).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '>=', value: 500 },
    ])
  })

  it('uses an explicit status code instead of adding a second error filter', () => {
    const r = parseNaturalQuery('503 errors from checkout in production', 'spans')
    expect(r.chips).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '=', value: 503 },
      { field: 'environment', op: '=', value: 'production' },
    ])
    expect(r.search).toBe('')
  })

  it('keeps real search words alongside the error filter', () => {
    const r = parseNaturalQuery('timeout errors from payment', 'spans')
    expect(r.chips).toContainEqual({ field: 'http_status_code', op: '>=', value: 500 })
    expect(r.search).toBe('timeout')
  })
})
