import { describe, it, expect } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import WidgetWrapper from './WidgetWrapper.vue'

describe('pie dashboard panel', () => {
  it('uses the shared shell and exposes names, values, and shares', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Request share', type: 'pie', unit: 'req/s',
      data: { type: 'pie', groups: [{ key: 'payments', count: 25 }, { key: 'checkout', count: 75 }] },
    }))
    expect(html).toContain('panel-card')
    expect(html).toContain('Donut chart: 2 slices')
    expect(html).toContain('Highlight payments: 25 req/s, 25.0%')
    expect(html).toContain('pie-center')
  })
  it('renders a solid pie without a donut-center overlay', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Share', type: 'pie', pieStyle: 'pie',
      data: { type: 'pie', groups: [{ key: 'only', count: 1 }] },
    }))
    expect(html).toContain('Pie chart: 1 slice, total 1')
    expect(html).not.toContain('class="pie-center"')
  })
  it('shows a useful empty state instead of a fabricated ring', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Share', type: 'pie', data: { type: 'pie', groups: [{ key: 'zero', count: 0 }] },
    }))
    expect(html).toContain('No positive values')
    expect(html).not.toContain('<path')
  })
})
