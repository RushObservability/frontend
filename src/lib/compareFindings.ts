import type { BubbleUpResponse } from '../types'

export interface CompareFinding {
  dimension: string
  value: string
  rawValue: string
  selectionCount: number
  baselineCount: number
  selectionPct: number
  baselinePct: number
  lift: number
  delta: number
}

export function rankCompareFindings(result: BubbleUpResponse, limit = 8): CompareFinding[] {
  return result.dimensions
    .flatMap((dimension) => dimension.values.map((value) => ({
      dimension: dimension.name,
      value: value.value || '(empty)',
      rawValue: value.value,
      selectionCount: value.selection_count,
      baselineCount: value.baseline_count,
      selectionPct: value.selection_pct,
      baselinePct: value.baseline_pct,
      lift: value.lift,
      delta: value.selection_pct - value.baseline_pct,
    })))
    .filter((finding) => finding.lift >= 1.15 && finding.selectionCount > 0)
    .sort((a, b) => {
      const scoreA = Math.abs(a.delta) * Math.log2(a.selectionCount + 2)
      const scoreB = Math.abs(b.delta) * Math.log2(b.selectionCount + 2)
      return scoreB - scoreA
    })
    .slice(0, limit)
}

export function compareFindingStrength(lift: number, selectionCount: number): 'strong' | 'notable' | 'directional' {
  if (lift >= 3 && selectionCount >= 10) return 'strong'
  if (lift >= 1.75 && selectionCount >= 5) return 'notable'
  return 'directional'
}

export function compareFindingSummary(finding: Pick<CompareFinding, 'lift' | 'delta'>): string {
  const delta = Math.abs(finding.delta).toFixed(Math.abs(finding.delta) >= 10 ? 0 : 1)
  return `${finding.lift.toFixed(1)}x more common · +${delta} pts`
}
