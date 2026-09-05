import { describe, expect, it } from 'vitest'
import type { TimeseriesBucket } from '../types'
import { buildAvailabilityChartPoints, intervalSeconds } from './sloCharts'

function bucket(bucket: string, count: number): TimeseriesBucket {
  return {
    bucket,
    count,
    error_count: 0,
    avg_duration_ms: 0,
    p50_ms: 0,
    p95_ms: 0,
    p99_ms: 0,
  }
}

describe('SLO availability chart data', () => {
  it('converts bucket counts into request and error rates', () => {
    const points = buildAvailabilityChartPoints(
      [bucket('2026-09-05 10:00:00', 3_600)],
      [bucket('2026-09-05 10:00:00', 36)],
      3_600,
    )

    expect(points).toEqual([{
      bucket: '2026-09-05 10:00:00',
      total: 3_600,
      requestsPerSecond: 1,
      errorRate: 1,
      successRate: 99,
    }])
  })

  it('aligns error buckets by timestamp and treats missing buckets as zero errors', () => {
    const points = buildAvailabilityChartPoints(
      [bucket('10:00', 100), bucket('11:00', 200)],
      [bucket('11:00', 20)],
      100,
    )

    expect(points.map(point => point.errorRate)).toEqual([0, 10])
    expect(points.map(point => point.requestsPerSecond)).toEqual([1, 2])
  })

  it('does not understate the current partial bucket', () => {
    const points = buildAvailabilityChartPoints(
      [bucket('2026-09-05 10:00:00', 1_800)],
      [],
      3_600,
      Date.parse('2026-09-05T10:30:00Z'),
    )

    expect(points[0]?.requestsPerSecond).toBe(1)
  })

  it('parses the intervals used by SLO charts', () => {
    expect(intervalSeconds('1m')).toBe(60)
    expect(intervalSeconds('5m')).toBe(300)
    expect(intervalSeconds('1h')).toBe(3_600)
  })
})
