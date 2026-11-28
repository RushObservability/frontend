import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import TimeseriesWidget from './TimeseriesWidget.vue'
import { MAX_CHART_SERIES, TOP_GROUPS_NOTE } from '../../lib/chart'

function series(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `pod-${i}`, points: [[0, i], [60, i + 1]] as [number, number][] }))
}

async function render(count: number, truncated?: boolean): Promise<string> {
  return renderToString(createSSRApp(TimeseriesWidget, { buckets: [], series: series(count), truncated }))
}

describe('time-series series cap', () => {
  it('draws only the first series of a high-cardinality result and says how many were hidden', async () => {
    const html = await render(3214)
    expect(html.match(/class="ch-line ts-line"/g)).toHaveLength(MAX_CHART_SERIES)
    expect(html.match(/class="ts-legend-item"/g)).toHaveLength(MAX_CHART_SERIES)
    expect(html).toContain(`pod-${MAX_CHART_SERIES - 1}`)
    expect(html).not.toContain(`pod-${MAX_CHART_SERIES}<`)
    expect(html).toContain(`Showing the first ${MAX_CHART_SERIES} of 3,214 series`)
  })

  it('shows no note when every series fits', async () => {
    const html = await render(MAX_CHART_SERIES)
    expect(html.match(/class="ch-line ts-line"/g)).toHaveLength(MAX_CHART_SERIES)
    expect(html).not.toContain('ts-series-cap')
  })

  it('says when the server kept only its top groups', async () => {
    expect(await render(24, true)).toContain(TOP_GROUPS_NOTE)
    expect(await render(24)).not.toContain('ts-series-cap')
  })
})
