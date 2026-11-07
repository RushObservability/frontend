import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import WidgetWrapper from './WidgetWrapper.vue'
import type { WidgetData, WidgetType } from '../../types'

async function render(type: WidgetType, data: WidgetData, config = {}) {
  const app = createSSRApp(WidgetWrapper, { title: 'Operations', type, data, displayConfig: config })
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { name: 'trace', path: '/trace/:traceId', component: { template: '<div />' } }] }))
  return renderToString(app)
}
describe('analysis dashboard panels', () => {
  it('renders patterns through the shared table and escapes message content', async () => {
    const html = await render('log-patterns', { type: 'log-patterns', pattern_total: 20, patterns: [{ service: 'payments', severity: 'ERROR', template: '<script>alert(N)</script>', example: 'alert(1)', trace_id: '', last_seen: '', count: 2, total_count: 20, buckets: [[10, 2]] }], time_domain: { from: 0, to: 60 } })
    expect(html).toContain('data-table'); expect(html).toContain('10.0%'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>alert')
    expect(html).toContain('aria-expanded="false"')
  })
  it('shows configured states and no-data segments in the shared panel shell', async () => {
    const html = await render('state-timeline', { type: 'state-timeline', series: [{ name: 'payments', points: [[20, 0]] }], step_secs: 10, time_domain: { from: 0, to: 100 } }, { states: [{ value: 0, label: 'Offline', color: 'red' }] })
    expect(html).toContain('panel-card'); expect(html).toContain('Offline'); expect(html).toContain('No data'); expect(html).toMatch(/class="[^"]*missing[^\"]*state-segment/)
  })
  it('renders finite paired samples, explicit cap notice and keyboard navigation', async () => {
    const html = await render('scatter', { type: 'scatter', scatter_points: [{ x: 0, y: 0, timestamp: '', trace_id: '', span_id: '', service: 'payments', label: 'charge', error: 0 }], truncated: true, x_field: 'bytes', y_field: 'duration_ms' }, { x_label: 'Payload', x_unit: 'KB', y_label: 'Duration', unit: 'ms' })
    expect(html).toContain('Payload (KB)'); expect(html).toContain('Duration (ms)'); expect(html).toContain('result capped'); expect(html).toContain('tabindex="0"'); expect(html).not.toContain('NaN')
  })
})
