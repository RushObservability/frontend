import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import MetricsExplore from './MetricsExplore.vue'
import source from './MetricsExplore.vue?raw'

describe('metrics explorer list', () => {
  it('renders cards in the same locale order the explorer always used', async () => {
    const metricNames = ['zeta_total', 'Alpha', 'http.server.duration', 'alpha_bytes', 'http_requests_total', 'Beta']
    const html = await renderToString(createSSRApp(MetricsExplore, { metricNames, timePreset: 60 }))
    const rendered = [...html.matchAll(/data-metric="([^"]+)"/g)].map(match => match[1])
    expect(rendered).toEqual([...metricNames].sort((a, b) => a.localeCompare(b)))
  })

  it('sorts once per name list and sort mode, then only filters on search', () => {
    const filtered = source.slice(source.indexOf('const filteredMetrics = computed('), source.indexOf('const visibleMetrics'))
    expect(filtered).toContain('let list = sortedMetrics.value')
    expect(filtered).not.toContain('.sort(')
  })

  it('forgets a card ref when Vue unmounts the card', () => {
    const setRef = source.slice(source.indexOf('function setCardRef('), source.indexOf('function setupObserver'))
    expect(setRef).toContain('cardRefs.value.delete(metric)')
  })
})
