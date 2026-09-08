import { describe, expect, it } from 'vitest'
import type { SpanNode } from '../types'
import {
  barOffsetPercent,
  barWidthPercent,
  buildWaterfallRows,
  durationClass,
  flattenSpans,
  formatSpanDuration,
  isSpanError,
  parseTraceTimestamp,
  serviceColor,
  spanOperation,
  spanStatusClass,
} from './traceWaterfall'

function span(partial: Partial<SpanNode> & { span_id: string; timestamp: string }): SpanNode {
  return {
    service_name: 'svc',
    status: 'OK',
    http_status_code: 200,
    http_method: '',
    http_path: '',
    duration_ns: 1_000_000,
    parent_span_id: '',
    attributes: {},
    children: [],
    ...partial,
  } as SpanNode
}

describe('trace waterfall', () => {
  const tree = [
    span({
      span_id: 'root',
      timestamp: '2026-01-01 10:00:00.000000000',
      duration_ns: 1_000_000_000,
      children: [
        span({ span_id: 'child-b', timestamp: '2026-01-01 10:00:00.500000000' }),
        span({ span_id: 'child-a', timestamp: '2026-01-01 10:00:00.100000000', children: [
          span({ span_id: 'grandchild', timestamp: '2026-01-01 10:00:00.200000000' }),
        ] }),
      ],
    }),
  ]

  it('orders siblings by start time, not by input order', () => {
    const rows = buildWaterfallRows(tree, new Set())
    expect(rows.map(r => r.span.span_id)).toEqual(['root', 'child-a', 'grandchild', 'child-b'])
  })

  it('hides descendants of a collapsed branch but keeps the branch itself', () => {
    const rows = buildWaterfallRows(tree, new Set(['child-a']))
    expect(rows.map(r => r.span.span_id)).toEqual(['root', 'child-a', 'child-b'])
    expect(rows.find(r => r.span.span_id === 'child-a')?.childCount).toBe(1)
  })

  it('reports depth for indentation', () => {
    const rows = buildWaterfallRows(tree, new Set())
    expect(rows.map(r => r.depth)).toEqual([0, 1, 2, 1])
  })

  it('keeps sub-microsecond precision when parsing timestamps', () => {
    const a = parseTraceTimestamp('2026-01-01 10:00:00.000001000')
    const b = parseTraceTimestamp('2026-01-01 10:00:00.000002000')
    expect(b - a).toBe(1)
  })

  it('returns 0 for an unparseable timestamp rather than NaN', () => {
    expect(parseTraceTimestamp('not a timestamp')).toBe(0)
    expect(parseTraceTimestamp('')).toBe(0)
  })

  it('offsets bars against the first span and caps at 95%', () => {
    const ordered = flattenSpans(tree)
    expect(barOffsetPercent(ordered[0]!, ordered, 1_000_000_000)).toBe('0%')
    // child-a starts 100ms into a 1s trace.
    const childA = ordered.find(s => s.span_id === 'child-a')!
    expect(barOffsetPercent(childA, ordered, 1_000_000_000)).toBe('10%')
  })

  it('never divides by a zero trace duration', () => {
    const ordered = flattenSpans(tree)
    expect(barOffsetPercent(ordered[1]!, ordered, 0)).toBe('0%')
    expect(barWidthPercent(ordered[1]!, 0)).toBe('1%')
  })

  it('floors bar width so a fast span stays visible', () => {
    const tiny = span({ span_id: 't', timestamp: '2026-01-01 10:00:00.000000000', duration_ns: 1 })
    expect(barWidthPercent(tiny, 1_000_000_000)).toBe('0.5%')
  })

  it('treats 4xx and ERROR status as errors', () => {
    expect(isSpanError(span({ span_id: 'a', timestamp: '', http_status_code: 404 }))).toBe(true)
    expect(isSpanError(span({ span_id: 'b', timestamp: '', status: 'error' }))).toBe(true)
    expect(isSpanError(span({ span_id: 'c', timestamp: '' }))).toBe(false)
  })

  it('labels a span by route, then name, then id', () => {
    expect(spanOperation(span({ span_id: 'a', timestamp: '', http_method: 'GET', http_path: '/x' }))).toBe('GET /x')
    expect(spanOperation(span({ span_id: 'b', timestamp: '', attributes: { name: 'query' } }))).toBe('query')
    expect(spanOperation(span({ span_id: 'abcdef123456', timestamp: '' }))).toBe('abcdef12')
  })

  it('assigns a stable colour per service and wraps past the palette', () => {
    const services = ['a', 'b', 'c']
    expect(serviceColor('b', services)).toBe(serviceColor('b', services))
    expect(serviceColor('a', services)).not.toBe(serviceColor('b', services))
    // Unknown service falls back rather than returning undefined.
    expect(serviceColor('missing', services)).toBeTruthy()
    expect(serviceColor('a', undefined)).toBeTruthy()
  })

  it('formats durations across unit boundaries', () => {
    expect(formatSpanDuration(500)).toBe('1µs')
    expect(formatSpanDuration(1_500_000)).toBe('1.5ms')
    expect(formatSpanDuration(2_500_000_000)).toBe('2.50s')
  })

  it('buckets duration and status into classes', () => {
    expect(durationClass(2_000_000_000)).toBe('dur-slow')
    expect(durationClass(10_000)).toBe('dur-fast')
    expect(spanStatusClass('OK', 500)).toBe('status-error')
    expect(spanStatusClass('OK', 404)).toBe('status-warning')
    expect(spanStatusClass('OK', 200)).toBe('status-ok')
  })
})
