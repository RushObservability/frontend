import { describe, expect, it } from 'vitest'
import {
  appendCapacitySnapshot,
  evaluateCapacity,
  type CapacitySnapshot,
} from './capacityModel'

function snapshot(overrides: Partial<CapacitySnapshot> = {}): CapacitySnapshot {
  return {
    capturedAt: 1_000_000,
    queryP95Ms: 25,
    activeQueries: 0,
    queryLimit: null,
    spoolUsedPct: 0,
    spoolOldestAgeSecs: 0,
    diskUsedPct: 10,
    maxParts: 5,
    partsDelayThreshold: 1_000,
    delayedInserts: 0,
    rejectedInsertsTotal: 0,
    backgroundPoolTasks: 0,
    backgroundPoolSize: 16,
    oldestMutationSecs: 0,
    mutationPartsToDo: 0,
    failedMutations: 0,
    clickhouseMemoryBytes: 1_000,
    clickhouseMemoryLimitBytes: 10_000,
    apiMemoryBytes: 1_000,
    apiMemoryLimitBytes: 10_000,
    apiCpuUtilizationRatio: 0.1,
    openFds: 10,
    openFdsLimit: 1_000,
    ...overrides,
  }
}

function sustained(overrides: Partial<CapacitySnapshot>): CapacitySnapshot[] {
  return [0, 15_000, 30_000].map(offset => snapshot({ ...overrides, capturedAt: 1_000_000 + offset }))
}

describe('capacity model', () => {
  it('does not treat an unlimited active-query count as pressure', () => {
    const result = evaluateCapacity(sustained({ activeQueries: 20, queryLimit: null, queryP95Ms: null }))
    expect(result).toHaveLength(1)
    expect(result[0]?.severity).toBe('stable')
  })

  it('requires three samples before reporting read pressure', () => {
    const one = evaluateCapacity([snapshot({ queryP95Ms: 6_000 })])
    const three = evaluateCapacity(sustained({ queryP95Ms: 6_000 }))
    expect(one[0]?.title).toBe('Building a read baseline')
    expect(three).toContainEqual(expect.objectContaining({ severity: 'urgent', title: 'Sustained read pressure is high' }))
  })

  it('uses a configured query limit instead of fixed query counts', () => {
    const result = evaluateCapacity(sustained({ activeQueries: 7, queryLimit: 10, queryP95Ms: 20 }))
    expect(result).toContainEqual(expect.objectContaining({ severity: 'watch', title: 'Read headroom is narrowing' }))
  })

  it('uses separate watch and urgent spool thresholds', () => {
    expect(evaluateCapacity([snapshot({ spoolUsedPct: 70 })])).toContainEqual(
      expect.objectContaining({ severity: 'watch', title: 'Ingest buffer needs watching' }),
    )
    expect(evaluateCapacity([snapshot({ spoolUsedPct: 85 })])).toContainEqual(
      expect.objectContaining({ severity: 'urgent', title: 'Ingest is falling behind' }),
    )
  })

  it('does not use the raw active merge count as an alert', () => {
    const result = evaluateCapacity(sustained({ backgroundPoolTasks: 12, backgroundPoolSize: 16, maxParts: 5 }))
    expect(result.every(item => !item.title.toLowerCase().includes('part'))).toBe(true)
  })

  it('uses the configured part-delay boundary and delayed inserts', () => {
    expect(evaluateCapacity([snapshot({ maxParts: 150 })])).toContainEqual(
      expect.objectContaining({ severity: 'watch', title: 'Part growth needs watching' }),
    )
    expect(evaluateCapacity([snapshot({ maxParts: 1_000 })])).toContainEqual(
      expect.objectContaining({ severity: 'urgent', title: 'Inserts are reaching the parts boundary' }),
    )
  })

  it('compares memory with its actual limit', () => {
    const result = evaluateCapacity([snapshot({ apiMemoryBytes: 950, apiMemoryLimitBytes: 1_000 })])
    expect(result).toContainEqual(expect.objectContaining({ severity: 'urgent', title: 'Memory headroom is low' }))
  })

  it('replaces samples taken too close together and drops stale samples', () => {
    const first = snapshot({ capturedAt: 1_000_000, activeQueries: 1 })
    const replacement = snapshot({ capturedAt: 1_005_000, activeQueries: 2 })
    const later = snapshot({ capturedAt: 1_400_000, activeQueries: 3 })
    expect(appendCapacitySnapshot([first], replacement)).toEqual([replacement])
    expect(appendCapacitySnapshot([first, replacement], later)).toEqual([later])
  })
})
