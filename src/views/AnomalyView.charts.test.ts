import { describe, expect, it } from 'vitest'
import listSource from './AnomalyView.vue?raw'
import detailSource from './AnomalyDetailView.vue?raw'

const GEOMETRY_CALL = /\b(?:c?LinePath|linePath|c?AreaPath|areaPath|c?BandPath|bandPath|c?AnomalyRects|anomalyRects|c?YTicks|yTicks|c?TimeLabels|timeLabels|panelSeries|correlationPanelSeries)\(/

function template(source: string): string {
  return source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'))
}

describe('anomaly chart rendering', () => {
  it('builds chart geometry in computeds, not in template calls that rerun on every crosshair move', () => {
    expect(template(listSource)).not.toMatch(GEOMETRY_CALL)
    expect(template(detailSource)).not.toMatch(GEOMETRY_CALL)
    expect(template(listSource)).toContain('<path :d="m.paths.line" class="ch-line"')
    expect(template(detailSource)).toContain('<path :d="svc.paths.line" class="ch-line"')
  })

  it('caps each detector at MAX_CHART_SERIES after picking anomalous series and says how many were hidden', () => {
    expect(listSource).toContain('charts: charts.slice(0, MAX_CHART_SERIES).map(withGeometry)')
    expect(listSource).toContain("anomalous: chartView(charts.filter(m => m.anomalyCount > 0), 'anomalous series')")
    expect(listSource).toContain('Showing the first ${MAX_CHART_SERIES} of ${charts.length.toLocaleString()} ${noun}.')
    expect(template(listSource)).toContain('{{ anomalousChartsFor(config.id).capNote }}')
    expect(template(listSource)).toContain('{{ detectorChartsFor(config.id).capNote }}')

    expect(detailSource).toContain('chartData.value.slice(0, MAX_CHART_SERIES).map(')
    expect(template(detailSource)).toContain('{{ chartCapNote }}')
  })
})
