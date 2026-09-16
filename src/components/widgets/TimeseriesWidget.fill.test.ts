import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import TimeseriesWidget from './TimeseriesWidget.vue'
import WidgetWrapper from './WidgetWrapper.vue'

const series = [{ name: 'requests', color: '#3b82f6', points: [[0, 1], [60, 2]] as [number, number][] }]

async function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(TimeseriesWidget, { buckets: [], ...props }))
}

describe('time-series area fill', () => {
  it('keeps dashboard multi-series charts as lines by default', async () => {
    const html = await render({ series })
    expect(html).toContain('class="ch-line ts-line"')
    expect(html).not.toContain('class="ch-area"')
  })

  it('closes every enabled series area at the x-axis', async () => {
    const html = await render({ series, fill: true })
    expect(html).toMatch(/d="M40,66 L558,12 L558,120 L40,120 Z" class="ch-area"/)
    expect(html).toContain('color:#3b82f6')
  })

  it('preserves the legacy single-series fill unless disabled', async () => {
    const buckets = [{ bucket: '2026-01-01T00:00:00Z', count: 1 }]
    expect(await render({ buckets })).toContain('class="ch-area"')
    expect(await render({ buckets, fill: false })).not.toContain('class="ch-area"')
  })

  it('does not draw area fill over stacked bars', async () => {
    const html = await render({ series, displayMode: 'stacked-bars', fill: true })
    expect(html).toContain('class="ts-stacked-bar"')
    expect(html).not.toContain('class="ch-area"')
  })

  it('uses the dashboard panel setting in the shared chart', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Requests',
      type: 'timeseries',
      fill: true,
      data: { type: 'timeseries', series },
    }))
    expect(html).toContain('class="ch-area"')
  })
})
