import { describe, expect, it } from 'vitest'
import {
  VACUUM_PHASES,
  estimateVacuumPhase,
  formatDuration,
  phaseDefinition,
  phaseFromCode,
  phaseFromPostgresName,
  recentRate,
  timelineState,
} from './vacuumPresentation'

describe('PostgreSQL VACUUM presentation', () => {
  it('maps every collector phase code to a reader-friendly documented stage', () => {
    expect(VACUUM_PHASES).toHaveLength(7)
    expect(VACUUM_PHASES.every((phase) => phase.label && phase.meaning.length > 30)).toBe(true)
    expect(phaseFromCode(2)).toBe('scanning-heap')
    expect(phaseFromPostgresName('performing final cleanup')).toBe('final-cleanup')
    expect(phaseDefinition('vacuuming-indexes').meaning).toContain('index entries')
    expect(phaseFromCode(99)).toBe('unknown')
  })

  it('marks timeline stages relative to the active phase', () => {
    expect(timelineState('vacuuming-heap', 'scanning-heap')).toBe('complete')
    expect(timelineState('vacuuming-heap', 'vacuuming-heap')).toBe('current')
    expect(timelineState('vacuuming-heap', 'final-cleanup')).toBe('upcoming')
  })

  it('estimates the current heap scan from recent movement', () => {
    const estimate = estimateVacuumPhase({
      phase: 'scanning-heap',
      elapsedSeconds: 240,
      totalBlocks: 1_000,
      scannedBlocks: 500,
      vacuumedBlocks: 0,
      totalIndexes: 0,
      processedIndexes: 0,
      recentProgress: [[0, 100], [120, 300], [240, 500]],
    })

    expect(estimate.progress).toBe(0.5)
    expect(estimate.etaSeconds).toBeCloseTo(300)
    expect(estimate.confidence).toBe('high')
  })

  it('uses the latest monotonic segment after a repeated pass resets progress', () => {
    expect(recentRate([[0, 10], [60, 20], [120, 2], [180, 12]])).toEqual({
      value: 10 / 60,
      confidence: 'medium',
    })
  })

  it('does not invent an ETA for final cleanup', () => {
    const estimate = estimateVacuumPhase({
      phase: 'final-cleanup',
      elapsedSeconds: 500,
      totalBlocks: 1_000,
      scannedBlocks: 1_000,
      vacuumedBlocks: 1_000,
      totalIndexes: 4,
      processedIndexes: 4,
    })

    expect(estimate.etaSeconds).toBeNull()
    expect(estimate.status).toContain('no useful denominator')
  })

  it('formats estimates without false second-level precision', () => {
    expect(formatDuration(15)).toBe('under 1 min')
    expect(formatDuration(4_800)).toBe('1h 20m')
  })
})
