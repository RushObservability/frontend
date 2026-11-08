import { describe, expect, it } from 'vitest'
import { serviceQueryInterval, serviceQueryBucketSeconds } from './serviceQuery'

describe('service chart intervals', () => {
  it.each([
    [5, '1m', 60], [15, '1m', 60], [30, '1m', 60], [60, '1m', 60],
    [180, '5m', 300], [360, '5m', 300], [720, '15m', 900], [1440, '15m', 900],
    [2880, '1h', 3600], [10080, '1h', 3600], [43200, '1h', 3600],
  ])('uses a supported bucket at %i minutes', (minutes, token, seconds) => {
    expect(serviceQueryInterval(Number(minutes))).toBe(token)
    expect(serviceQueryBucketSeconds(Number(minutes))).toBe(seconds)
  })
})
