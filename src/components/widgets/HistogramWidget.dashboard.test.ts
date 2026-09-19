import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import WidgetWrapper from './WidgetWrapper.vue'
import componentSource from './HistogramWidget.vue?raw'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'
const styles = readFileSync(new URL('../../styles/widgets/HistogramWidget.css', import.meta.url), 'utf8')

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
    expect(html).toContain('20 ms')
    expect(html).toContain('histogram-axis-layer')
    expect(html).not.toContain('<text')
  })

  it('uses the same unscaled typography as time-series graphs', () => {
    expect(styles).toContain('font: 500 var(--panel-chart-axis-size, .5625rem) / 1 var(--font-mono)')
    expect(styles).toContain('letter-spacing: -.025em')
    expect(componentSource).toContain('resizeObserver?.disconnect()')
  })
})
