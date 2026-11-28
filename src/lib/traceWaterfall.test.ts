import { describe, expect, it } from 'vitest'
import type { SpanNode } from '../types'
import {
  clipTraceWindow,
  spanTraceWindow,
  buildWaterfallRows,
  durationClass,
  errorSpanInsights,
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

  it('keeps elapsed offsets after clipping a parent span to the focused window', () => {
    const ordered = flattenSpans(tree)
    const originUs = parseTraceTimestamp(ordered[0]!.timestamp)
    const windows = ordered.map(item => spanTraceWindow(item, originUs))
    const target = { from: 100_000_000, to: 101_000_000 }
    expect(windows[1]).toEqual(target)
    expect(clipTraceWindow(windows[0]!, target)).toEqual(target)
    expect(clipTraceWindow(windows[2]!, target)).toBeNull()
  })

  it('keeps an instantaneous span at a range boundary', () => {
    const range = { from: 100, to: 200 }
    expect(clipTraceWindow({ from: 200, to: 200 }, range)).toEqual({ from: 200, to: 200 })
    expect(clipTraceWindow({ from: 200, to: 300 }, range)).toBeNull()
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

  it('parses each span timestamp once per sort, not once per comparison', () => {
    let reads = 0
    const counted = (id: string, second: number, children: SpanNode[] = []) => {
      const node = span({ span_id: id, timestamp: '', children })
      const timestamp = `2026-01-01 10:${String(Math.floor(second / 60) % 60).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.000000000`
      Object.defineProperty(node, 'timestamp', { get: () => { reads++; return timestamp } })
      return node
    }
    // Reverse order forces the sort to do real work.
    const children = Array.from({ length: 500 }, (_, i) => counted(`c${i}`, 3599 - i))
    const roots = [counted('root', 0, children)]

    reads = 0
    const flat = flattenSpans(roots)
    expect(flat[1]!.span_id).toBe('c499')
    expect(reads).toBe(501)

    reads = 0
    buildWaterfallRows(roots, new Set())
    expect(reads).toBe(501)
  })
})

describe('trace error insights', () => {
  const failing = (i: number, path = '/checkout') =>
    span({ span_id: `s${i}`, timestamp: '2026-01-01 10:00:00.000000000', service_name: 'api', http_method: 'POST', http_path: path, http_status_code: 503 })

  it('keeps the one-line-per-span text when nothing repeats', () => {
    const spans = [failing(1, '/a'), span({ span_id: 'ok', timestamp: '2026-01-01 10:00:00.000000000' }), failing(2, '/b')]
    expect(errorSpanInsights(spans)).toEqual([
      'Error in api: POST /a returned 503',
      'Error in api: POST /b returned 503',
    ])
  })

  it('groups repeated failures and folds groups past the limit into one count', () => {
    const spans = [
      ...Array.from({ length: 5_000 }, (_, i) => failing(i)),
      ...Array.from({ length: 12 }, (_, i) => failing(5_000 + i, `/item/${i}`)),
      failing(6_000, '/item/11'),
    ]
    const lines = errorSpanInsights(spans, 10)
    expect(lines).toHaveLength(11)
    expect(lines[0]).toBe('Error in api: POST /checkout returned 503 (5,000 spans)')
    expect(lines[1]).toBe('Error in api: POST /item/0 returned 503')
    expect(lines[10]).toBe('4 more failing spans not listed')
  })
})
