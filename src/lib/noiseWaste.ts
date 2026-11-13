import type { RouteLocationRaw } from 'vue-router'
import type { QualitySource } from './telemetryQuality'

export interface WasteRule extends Record<string, unknown> {
  id: string
  title: string
  signal: 'logs' | 'traces' | 'metrics'
  threshold: string
  recommendation: string
  safeguard: string
}
export interface WasteFinding extends Record<string, unknown> {
  id: string
  rule_id: string
  service: string
  signal: 'logs' | 'traces' | 'metrics'
  source: string
  subject: string
  confidence: 'review' | 'strong'
  candidate_records: number
  sampled_records: number
  candidate_body_bytes: number | null
  first_observed: string
  last_observed: string
  evidence: Array<{ label: string; value: string }>
}
export interface WasteCheck {
  rule_id: string
  status: 'finding' | 'no_candidates' | 'not_evaluated'
  evaluated_groups: number
  insufficient_groups: number
  findings: number
}
export interface WasteResponse {
  evaluated_at: string
  from: string
  to: string
  minutes: number
  sample_limit_per_source: number
  cache_hit: boolean
  cache_ttl_seconds: number
  partial: boolean
  sources: QualitySource[]
  rules: WasteRule[]
  checks: WasteCheck[]
  findings: WasteFinding[]
  finding_count: number
  omitted_findings: number
  services: string[]
  omitted_services: number
  sampled_records: number
  sampled_log_body_bytes: number
  methodology: string
}
export function candidateShare(finding: Pick<WasteFinding, 'candidate_records' | 'sampled_records'>): number {
  return finding.sampled_records > 0 ? Math.min(100, Math.max(0, finding.candidate_records / finding.sampled_records * 100)) : 0
}
export function formatBodyBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Not available'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  const index = bytes > 0 ? Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))) : 0
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`
}
export function evidenceLink(finding: WasteFinding, report: Pick<WasteResponse, 'from' | 'to'>): RouteLocationRaw {
  if (finding.signal === 'metrics') {
    const metric = finding.evidence.find(e => e.label === 'Metric')?.value
    return metric && !['.', '..'].includes(metric) ? { name: 'metric-detail', params: { metricName: metric } } : { name: 'metrics' }
  }
  return { name: 'explore', query: { mode: finding.signal === 'logs' ? 'logs' : 'spans', service: finding.service || undefined, from: report.from, to: report.to } }
}
