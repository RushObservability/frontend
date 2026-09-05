import { describe, expect, it } from 'vitest'
import source from './SloDetailView.vue?raw'

describe('SLO detail panel queries', () => {
  it('uses the dashboard workload budget for long SLO windows', () => {
    expect(source).toContain("}, 'dashboard', signal)")
    expect(source).not.toContain('}, undefined, signal)')
  })

  it('uses latency percentile panels and the configured limit for trace latency SLOs', () => {
    expect(source).toContain("isTraceLatencySlo.value ? ['avg', 'p50', 'p95', 'p99'] : ['rate', 'error', 'sli']")
    expect(source).toContain("latencyChartDef('avg', 'Average Latency', averageLatencyValues.value)")
    expect(source).toContain("latencyChartDef('p50', 'P50 Latency', p50Values.value)")
    expect(source).toContain("latencyChartDef('p95', 'P95 Latency', p95Values.value)")
    expect(source).toContain("latencyChartDef('p99', 'P99 Latency', p99Values.value)")
    expect(source).toContain('Dashed line marks the slow-request limit')
    expect(source).toContain("isTraceLatencySlo.value ? 'Over limit' : 'Errors'")
  })

  it('gives the latency panel grid more room', () => {
    expect(source).toContain("'sd-charts-row--latency': isTraceLatencySlo")
    expect(source).toContain('const CH = 180')
  })

  it('uses the configured SLO error filters for availability charts', () => {
    expect(source).toContain("slo.value.indicator_type === 'availability' && slo.value.error_filters.length > 0")
    expect(source).toContain('filters: slo.value.error_filters')
    expect(source).toContain('buildAvailabilityChartPoints(')
  })

  it('gives request SLO charts a two-column layout', () => {
    expect(source).toContain("'sd-charts-row--availability': isAvailabilitySlo || isMetricPromqlSlo")
  })

  it('charts metric SLOs from their PromQL expressions', () => {
    expect(source).toContain('api.promQueryRange(slo.value.total_promql')
    expect(source).toContain('api.promQueryRange(slo.value.error_promql')
    expect(source).toContain("title: isMetricPromqlSlo.value ? 'Total' : 'Request Rate'")
    expect(source).toContain("'Error PromQL as a percentage of Total PromQL.'")
  })
})
