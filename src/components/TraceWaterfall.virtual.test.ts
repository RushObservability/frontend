import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import TraceWaterfall from './TraceWaterfall.vue'
import type { SpanNode, TraceResponse } from '../types'

function largeTrace(count: number): TraceResponse {
  const children: SpanNode[] = Array.from({ length: count - 1 }, (_, i) => ({
    span_id: `child-${i}`,
    parent_span_id: 'root',
    service_name: 'api',
    status: 'OK',
    http_status_code: 200,
    http_method: 'GET',
    http_path: `/item/${i}`,
    duration_ns: 1_000,
    timestamp: `2026-01-01 10:00:00.${String(i).padStart(9, '0')}`,
    attributes: {},
    children: [],
  }) as unknown as SpanNode)
  const root = { ...children[0]!, span_id: 'root', parent_span_id: '', timestamp: '2026-01-01 10:00:00.000000000', duration_ns: 1_000_000_000, children }
  return { trace_id: 't', spans: [root], span_count: count, duration_ns: 1_000_000_000, services: ['api'] }
}

describe('TraceWaterfall windowing', () => {
  it('renders a bounded number of rows for a large trace', async () => {
    const html = await renderToString(createSSRApp(TraceWaterfall, { trace: largeTrace(20_000) }))
    const rows = html.match(/class="tw-row/g) ?? []
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(100)
    // Assistive tech still learns the full size and each row's position.
    expect(html).toContain('aria-rowcount="20001"')
    expect(html).toContain('aria-rowindex="2"')
  })

  it('keeps exactly one rendered row in the tab order', async () => {
    const html = await renderToString(createSSRApp(TraceWaterfall, { trace: largeTrace(500) }))
    expect(html.match(/role="row" tabindex="0"/g)).toHaveLength(1)
  })

  it('still caps compact mode at 20 rows', async () => {
    const html = await renderToString(createSSRApp(TraceWaterfall, { trace: largeTrace(500), compact: true }))
    expect(html.match(/class="tw-row/g)).toHaveLength(20)
  })
})
