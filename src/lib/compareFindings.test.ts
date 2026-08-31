import { describe, expect, it } from 'vitest'
import type { BubbleUpResponse } from '../types'
import { compareFindingStrength, compareFindingSummary, rankCompareFindings } from './compareFindings'

const response: BubbleUpResponse = {
  selection_count: 100,
  baseline_count: 900,
  dimensions: [
    {
      name: 'Version',
      values: [
        { value: 'v42', selection_count: 60, baseline_count: 45, selection_pct: 60, baseline_pct: 5, lift: 12 },
        { value: 'v41', selection_count: 20, baseline_count: 360, selection_pct: 20, baseline_pct: 40, lift: 0.5 },
      ],
    },
    {
      name: 'Region',
      values: [
        { value: 'west', selection_count: 30, baseline_count: 180, selection_pct: 30, baseline_pct: 20, lift: 1.5 },
        { value: '', selection_count: 1, baseline_count: 1, selection_pct: 1, baseline_pct: 0.1, lift: 10 },
      ],
    },
  ],
}

describe('rankCompareFindings', () => {
  it('ranks high-coverage differences ahead of sparse high-lift values', () => {
    const findings = rankCompareFindings(response)
    expect(findings.map((finding) => finding.value)).toEqual(['v42', 'west', '(empty)'])
  })

  it('removes values that are not overrepresented in the selected cohort', () => {
    expect(rankCompareFindings(response).some((finding) => finding.value === 'v41')).toBe(false)
  })

  it('honors the result limit', () => {
    expect(rankCompareFindings(response, 1)).toHaveLength(1)
  })
})

describe('compare finding copy', () => {
  it('classifies evidence using lift and support', () => {
    expect(compareFindingStrength(4, 20)).toBe('strong')
    expect(compareFindingStrength(2, 8)).toBe('notable')
    expect(compareFindingStrength(8, 2)).toBe('directional')
  })

  it('formats lift and prevalence delta consistently', () => {
    expect(compareFindingSummary({ lift: 2.86, delta: 53.4 })).toBe('2.9x more common · +53 pts')
  })
})
