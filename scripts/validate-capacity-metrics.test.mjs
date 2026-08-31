import { describe, expect, it } from 'vitest'
import { CAPACITY_METRICS_CONTRACT, validateMetrics } from './capacity-metrics-contract.mjs'

function fixture(contract) {
  const lines = []
  for (const [family, expectation] of Object.entries(contract.metrics)) {
    lines.push(`# TYPE ${family} ${expectation.type}`)
    const labels = expectation.labels.length ? `{${expectation.labels.map((label) => `${label}="value"`).join(',')}}` : ''
    if (expectation.type === 'histogram') {
      lines.push(`${family}_bucket{${expectation.labels.map((label) => `${label}="value"`).concat('le="+Inf"').join(',')}} 1`)
      lines.push(`${family}_sum${labels} 1`)
      lines.push(`${family}_count${labels} 1`)
    } else {
      lines.push(`${family}${labels} 1`)
    }
  }
  return lines.join('\n')
}

describe('capacity metric contract', () => {
  it('accepts the query-api and sre-agent metric shapes', () => {
    expect(validateMetrics(fixture(CAPACITY_METRICS_CONTRACT.queryApi), CAPACITY_METRICS_CONTRACT.queryApi).ok).toBe(true)
    expect(validateMetrics(fixture(CAPACITY_METRICS_CONTRACT.sreAgent), CAPACITY_METRICS_CONTRACT.sreAgent).ok).toBe(true)
  })

  it('catches a missing family and an unexpected label', () => {
    const contract = CAPACITY_METRICS_CONTRACT.queryApi
    const lines = fixture(contract).split('\n')
    const missing = 'rush_ch_active_queries'
    const withoutFamily = lines.filter((line) => !line.startsWith(`${missing} `) && !line.includes(`# TYPE ${missing} `)).join('\n')
    const missingResult = validateMetrics(withoutFamily, contract)
    expect(missingResult.missing).toContain(missing)
    expect(missingResult.ok).toBe(false)

    const withTenant = `${fixture(contract)}\nrush_process_open_fds{tenant_id="default"} 1`
    const labelResult = validateMetrics(withTenant, contract)
    expect(labelResult.forbiddenLabels).toContain('rush_process_open_fds: tenant_id')
    expect(labelResult.ok).toBe(false)
  })
})
