import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import WidgetWrapper from './WidgetWrapper.vue'

describe('dashboard histogram panel', () => {
  it('renders a numeric distribution in the shared panel shell', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Latency distribution',
      type: 'histogram',
      unit: 'ms',
      histogramBucketCount: 2,
      data: {
        type: 'histogram',
        series: [{ name: 'gateway', points: [[1, 10], [2, 20], [3, 30]] }],
      },
    }))
    expect(html).toContain('Latency distribution')
    expect(html).toContain('class="panel-card')
    expect(html).toContain('histogram-svg')
    expect(html).toContain('10 ms')
    expect(html).toContain('30 ms')
  })
})
