import { describe, expect, it } from 'vitest'
import { formatInvestigationActivity, parseInvestigationTimestamp } from './investigationTime'

const now = Date.parse('2026-09-03T20:00:00Z')

describe('investigation activity timestamps', () => {
  it('treats ClickHouse timestamps without a timezone as UTC', () => {
    expect(parseInvestigationTimestamp('2026-09-03 18:00:00')).toBe(
      Date.parse('2026-09-03T18:00:00Z'),
    )
    expect(formatInvestigationActivity('2026-09-03 18:00:00', now)).toBe('2h ago')
  })

  it('preserves explicit timezone offsets', () => {
    expect(parseInvestigationTimestamp('2026-09-03T11:00:00-07:00')).toBe(
      Date.parse('2026-09-03T18:00:00Z'),
    )
  })

  it('handles fractional seconds and invalid values', () => {
    expect(formatInvestigationActivity('2026-09-03 19:42:00.123456', now)).toBe('17m ago')
    expect(formatInvestigationActivity('not-a-date', now)).toBe('Unknown')
  })

  it('uses a relative day label for recent sessions', () => {
    expect(formatInvestigationActivity('2026-08-31 20:00:00', now)).toBe('3d ago')
  })
})
