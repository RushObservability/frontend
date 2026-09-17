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

  it('places timezone-free UTC buckets inside the requested window', async () => {
    const html = await render({
      buckets: [{ bucket: '2026-09-17 00:30:00', count: 1 }],
      timeDomain: { from: Date.parse('2026-09-17T00:00:00Z') / 1000, to: Date.parse('2026-09-17T01:00:00Z') / 1000 },
    })
    expect(html).toContain('d="M299,12')
  })

  it('does not draw area fill over stacked bars', async () => {
    const html = await render({ series, displayMode: 'stacked-bars', fill: true })
    expect(html).toContain('class="ts-stacked-bar"')
    expect(html).not.toContain('class="ch-area"')
  })

  it('fills each stacked line only to the next line by default', async () => {
    const html = await render({
      series: [series[0], { name: 'errors', color: '#e5584f', points: [[0, 2], [60, 1]] }],
      displayMode: 'stacked-lines',
    })
    expect(html).toMatch(/d="M40,84 L558,48 L558,120 L40,120 Z" class="ch-area ts-stacked-area"/)
    expect(html).toMatch(/d="M40,12 L558,12 L558,48 L40,84 Z" class="ch-area ts-stacked-area"/)
    expect((html.match(/class="ch-area ts-stacked-area"/g) || [])).toHaveLength(2)
  })

  it('keeps the larger A series on top with its own color', async () => {
    const html = await render({
      series: [
        { name: 'A', color: '#3b82f6', points: [[0, 10], [60, 10]] },
        { name: 'B', color: '#e5584f', points: [[0, 1], [60, 1]] },
      ],
      displayMode: 'stacked-lines',
    })
    expect(html).toMatch(/d="M40,12 L558,12 L558,110\.18 L40,110\.18 Z" class="ch-area ts-stacked-area" style="color:#3b82f6/)
    expect(html).toMatch(/d="M40,110\.18 L558,110\.18 L558,120 L40,120 Z" class="ch-area ts-stacked-area" style="color:#e5584f/)
  })

  it('can show stacked lines without their area fill', async () => {
    const html = await render({ series, displayMode: 'stacked-lines', fill: false })
    expect(html).toContain('class="ch-line ts-line"')
    expect(html).not.toContain('class="ch-area ts-stacked-area"')
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

  it('uses the saved stacked layout in the dashboard wrapper', async () => {
    const html = await renderToString(createSSRApp(WidgetWrapper, {
      title: 'Requests',
      type: 'timeseries',
      displayMode: 'stacked-lines',
      data: { type: 'timeseries', series },
    }))
    expect(html).toContain('class="ch-area ts-stacked-area"')
  })
})
