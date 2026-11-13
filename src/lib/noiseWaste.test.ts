import { describe, expect, it } from 'vitest'
import { candidateShare, evidenceLink, formatBodyBytes, type WasteFinding } from './noiseWaste'
const finding: WasteFinding = { id: 'f', rule_id: 'repeated_logs', service: 'checkout with spaces', signal: 'logs', source: 'logs', subject: '', confidence: 'review', candidate_records: 39, sampled_records: 100, candidate_body_bytes: 1000, first_observed: '', last_observed: '', evidence: [] }
describe('advisor evidence presentation', () => {
  it('handles missing denominators and bounds visual shares', () => {
    expect(candidateShare(finding)).toBe(39)
    expect(candidateShare({ candidate_records: 1, sampled_records: 0 })).toBe(0)
    expect(candidateShare({ candidate_records: 200, sampled_records: 100 })).toBe(100)
  })
  it('labels content bytes independently of storage or billing', () => {
    expect(formatBodyBytes(0)).toBe('0 B')
    expect(formatBodyBytes(16384)).toBe('16 KiB')
    expect(formatBodyBytes(-1)).toBe('Not available')
  })
  it('preserves tenant-local service and exact sample window in Explore links', () => {
    expect(evidenceLink(finding, { from: 'from', to: 'to' })).toEqual({ name: 'explore', query: { mode: 'logs', service: 'checkout with spaces', from: 'from', to: 'to' } })
    expect(evidenceLink({ ...finding, signal: 'metrics', evidence: [{ label: 'Metric', value: '..' }] }, { from: '', to: '' })).toEqual({ name: 'metrics' })
  })
})
