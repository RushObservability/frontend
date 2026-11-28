import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

describe('Explore detail chart hover', () => {
  it('keeps the hover state when the pointer stays on the same bucket and chart', () => {
    const handler = source.slice(source.indexOf('function dpChartMouseMove('), source.indexOf('function dpChartMouseLeave('))
    const guard = handler.indexOf('if (chartHover.value?.bucketIdx === idx && chartHover.value.chartType === chartType) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(handler.indexOf('chartHover.value = { bucketIdx: idx, chartType }'))
  })
})
