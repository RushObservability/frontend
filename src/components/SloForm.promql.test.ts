import { describe, expect, it } from 'vitest'
import source from './SloForm.vue?raw'

describe('metric SLO PromQL form', () => {
  it('uses total and error PromQL for metric availability and latency', () => {
    expect(source).toContain("sloType.value === 'metric' && ['availability', 'latency'].includes(indicatorType.value)")
    expect(source).toContain('v-model="totalPromql"')
    expect(source).toContain('v-model="errorPromql"')
    expect(source).toContain(':placeholder="errorPromqlPlaceholder"')
    expect(source).toContain("validationError.value = 'Total PromQL is required for metric SLOs.'")
    expect(source).toContain("validationError.value = 'Error PromQL is required for metric SLOs.'")
  })

  it('keeps filters on non-PromQL SLO paths', () => {
    expect(source).toContain('<div v-else class="sf-section">')
    expect(source).toContain('<QueryNlInput')
  })

  it('keeps the latency threshold in the payload', () => {
    expect(source).toContain("threshold_ms: indicatorType.value === 'latency' ? thresholdMs.value : null")
  })
})
