export interface QualityRule {
  id: string
  title: string
  impact: 'high' | 'medium' | 'low'
  signals: string
  description: string
  remediation: string
}

export interface QualityFinding {
  id: string
  rule_id: string
  service: string
  subject: string
  affected: number
  sampled: number
  first_observed: string
  last_observed: string
  observed: string
  expected: string
  versions: Array<{ version: string; sampled: number; affected: number }>
}

export interface QualityCheck {
  rule_id: string
  status: 'pass' | 'finding' | 'not_evaluated'
  sampled: number
  affected: number
}

export interface QualityService extends Record<string, unknown> {
  service: string
  status: 'unknown' | 'findings' | 'no_findings_in_sample'
  sampled_records: number
  finding_count: number
  checks: QualityCheck[]
}

export interface QualitySource extends Record<string, unknown> {
  table: string
  signal: string
  status: 'available' | 'unavailable'
  sampled_records: number
  capped: boolean
}

export interface QualityResponse {
  evaluated_at: string
  from: string
  to: string
  minutes: number
  sample_limit_per_source: number
  sampling: string
  sources: QualitySource[]
  inventory_available: boolean
  inventory_capped: boolean
  partial: boolean
  finding_count: number
  high_impact_findings: number
  assessed_services: number
  unknown_services: number
  omitted_findings: number
  omitted_services: number
  rules: QualityRule[]
  findings: QualityFinding[]
  services: QualityService[]
}

export function samplePercentage(affected: number, sampled: number): string {
  return sampled > 0 ? `${(affected / sampled * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : 'Not evaluated'
}

export function serviceLabel(service: string): string {
  return service || 'Unattributed telemetry'
}
