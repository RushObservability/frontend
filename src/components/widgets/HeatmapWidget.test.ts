import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import WidgetWrapper from './WidgetWrapper.vue'

describe('dashboard heatmap panel', () => {
  it('renders named rows, measured zeroes, missing buckets, and the shared panel shell', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Requests by service',
      type: 'heatmap',
      unit: 'requests',
      data: {
        type: 'heatmap',
        time_domain: { from: 10, to: 30 },
        series: [
          { name: 'checkout', points: [[10, 0], [20, 10]] },
          { name: 'payments', points: [[20, 1]] },
        ],
      },
    }))
    expect(html).toContain('Requests by service')
    expect(html).toContain('checkout')
    expect(html).toContain('payments')
    expect(html).toContain('0 requests')
    expect(html).toContain('No data')
    expect(html).toContain('class="panel-card')
    const cells = html.match(/<span[^>]*class="heatmap-cell[^>]*>/g) ?? []
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => !cell.includes(' title='))).toBe(true)
    expect(cells.every((cell) => cell.includes('role="gridcell"') && cell.includes('aria-label='))).toBe(true)
  })
})
