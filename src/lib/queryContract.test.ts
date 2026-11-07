import { describe, expect, it } from 'vitest'
import fixtures from '../../contracts/query-v1.fixtures.json'
import registry from '../../contracts/query-v1.json'
import { adaptQuery, decodeQuery, metricsQuery } from './queryContract'

describe('shared query v1 contract', () => {
  for (const fixture of fixtures) {
    it(`matches the common fixture for ${fixture.path}`, () => {
      const params = fixture.params
      const actual = params
        ? metricsQuery(params.query, Number(params.start ?? params.time), Number(params.end ?? params.time), params.step ? Number(params.step) : undefined)
        : adaptQuery(fixture.path, fixture.body!)
      expect(actual).toEqual(fixture.request)
      expect(decodeQuery({ version: 'v1', signal: actual!.signal, operation: actual!.operation, data: { rows: [] } }, actual!)).toEqual({ rows: [] })
      expect(() => decodeQuery({ version: 'v2', data: {} }, actual!)).toThrow(/contract mismatch/)
    })
  }
  it('adapts every registered JSON query without losing options or filters', () => {
    for (const route of registry.routes.filter(r => !r.path.startsWith('/prom/'))) {
      const body = { time_range: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
        filters: [{ field: 'service_name', op: '=', value: 'checkout' }], search: 'timeout',
        ...(route.signal === 'dynamic' ? { [route.operation === 'scatter' ? 'source' : 'signal']: 'logs' } : {}) }
      const request = adaptQuery(route.path, body)!
      expect(request.operation).toBe(route.operation)
      expect(request.filters).toEqual(body.filters)
      expect(request.time_range).toEqual(body.time_range)
    }
    expect(adaptQuery('/dashboards', {})).toBeUndefined()
  })
})
