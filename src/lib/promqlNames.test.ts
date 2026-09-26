import { describe, expect, it } from 'vitest'
import { isBareMetricName, loneMetricName, metricNameInBraces, metricSelector } from './promqlNames'

describe('PromQL metric names', () => {
  it('knows which names PromQL accepts bare', () => {
    expect(isBareMetricName('http_requests_total')).toBe(true)
    expect(isBareMetricName('job:http_requests:rate5m')).toBe(true)
    expect(isBareMetricName('http.server.request.duration')).toBe(false)
    expect(isBareMetricName('system.cpu.user')).toBe(false)
    expect(isBareMetricName('9lives')).toBe(false)
    expect(isBareMetricName('')).toBe(false)
  })

  it('leaves bare names alone', () => {
    expect(metricSelector('http_requests_total')).toBe('http_requests_total')
    expect(metricSelector('up', 'job="api"')).toBe('up{job="api"}')
  })

  it('selects dotted names by __name__', () => {
    expect(metricSelector('http.server.request.duration')).toBe('{__name__="http.server.request.duration"}')
    expect(metricSelector('system.cpu.user', 'host="web-1"')).toBe('{__name__="system.cpu.user", host="web-1"}')
  })

  it('escapes quotes and backslashes in names', () => {
    expect(metricSelector('odd"name\\x')).toBe(String.raw`{__name__="odd\"name\\x"}`)
  })

  it('recognizes a query that is only one metric', () => {
    expect(loneMetricName(' http_requests_total ')).toBe('http_requests_total')
    expect(loneMetricName('{__name__="http.server.request.duration"}')).toBe('http.server.request.duration')
    expect(loneMetricName('{ __name__ = "a.b" }')).toBe('a.b')
    expect(loneMetricName('{"a.b.c"}')).toBe('a.b.c')
    expect(loneMetricName('{__name__="a.b", job="x"}')).toBeNull()
    expect(loneMetricName('rate(http_requests_total[5m])')).toBeNull()
    expect(loneMetricName('http.server.request.duration')).toBeNull()
  })

  it('round-trips every selector it builds', () => {
    for (const name of ['up', 'http.server.request.duration', 'weird "quoted" name']) {
      expect(loneMetricName(metricSelector(name))).toBe(name)
    }
  })

  it('finds the metric named inside braces', () => {
    expect(metricNameInBraces('__name__="a.b.c", job=')).toBe('a.b.c')
    expect(metricNameInBraces('"a.b.c", job=')).toBe('a.b.c')
    expect(metricNameInBraces('job="x", __name__="a.b"')).toBe('a.b')
    expect(metricNameInBraces('job="x"')).toBeNull()
  })
})
