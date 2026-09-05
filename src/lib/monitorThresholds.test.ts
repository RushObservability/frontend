import { describe, expect, it } from 'vitest'
import { normalizeThreshold, thresholdOrderError } from './monitorThresholds'

describe('monitor threshold ordering', () => {
  it('keeps warning optional', () => {
    expect(normalizeThreshold('')).toBeNull()
    expect(thresholdOrderError('above', 500, null)).toBeNull()
  })

  it('requires an above warning to be no higher than the alert', () => {
    expect(thresholdOrderError('above', 500, 501)).toBe('Warning must be at or below the alert threshold.')
    expect(thresholdOrderError('above', 500, 500)).toBeNull()
    expect(thresholdOrderError('above', 500, 300)).toBeNull()
    expect(thresholdOrderError('above_or_equal', 500, 501)).toBe(
      'Warning must be at or below the alert threshold.',
    )
  })

  it('reverses the ordering when lower values are worse', () => {
    expect(thresholdOrderError('below', 20, 19)).toBe(
      'Warning must be at or above the alert threshold when lower values are worse.',
    )
    expect(thresholdOrderError('below', 20, 30)).toBeNull()
    expect(thresholdOrderError('below_or_equal', 20, 19)).toBe(
      'Warning must be at or above the alert threshold when lower values are worse.',
    )
  })

  it('allows independent exact-match warning and alert values', () => {
    expect(thresholdOrderError('equal', 0, 1)).toBeNull()
  })
})
