import type { TimeseriesBucket } from '../types'

export interface AvailabilityChartPoint {
  bucket: string
  requestsPerSecond: number
  errorRate: number
  successRate: number
}

export function intervalSeconds(interval: string): number {
  const match = interval.trim().match(/^(\d+)([smhd])$/)
  if (!match) return 60

  const value = Number(match[1])
  const multiplier = match[2] === 's'
    ? 1
    : match[2] === 'm'
      ? 60
      : match[2] === 'h'
        ? 3_600
        : 86_400
  return Math.max(1, value * multiplier)
}

export function buildAvailabilityChartPoints(
  totalBuckets: TimeseriesBucket[],
  errorBuckets: TimeseriesBucket[],
  bucketSeconds: number,
): AvailabilityChartPoint[] {
  const errorsByBucket = new Map(errorBuckets.map(bucket => [bucket.bucket, bucket.count]))
  const seconds = Math.max(1, bucketSeconds)

  return totalBuckets.map((bucket) => {
    const errors = Math.min(bucket.count, errorsByBucket.get(bucket.bucket) ?? 0)
    const errorRate = bucket.count > 0 ? (errors / bucket.count) * 100 : 0
    return {
      bucket: bucket.bucket,
      requestsPerSecond: bucket.count / seconds,
      errorRate,
      successRate: 100 - errorRate,
    }
  })
}
