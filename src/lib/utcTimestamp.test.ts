import { describe, expect, it } from 'vitest'
import { parseUtcTimestamp } from './utcTimestamp'

describe('parseUtcTimestamp', () => {
  it('treats timezone-free ClickHouse values as UTC', () => {
    expect(parseUtcTimestamp('2026-09-17 00:30:00')).toBe(Date.parse('2026-09-17T00:30:00Z'))
    expect(parseUtcTimestamp('2026-09-17T00:30:00.123456')).toBe(Date.parse('2026-09-17T00:30:00.123Z'))
  })

  it('preserves explicit timezone offsets', () => {
    expect(parseUtcTimestamp('2026-09-16T17:30:00-07:00')).toBe(Date.parse('2026-09-17T00:30:00Z'))
    expect(parseUtcTimestamp('2026-09-17T00:30:00Z')).toBe(Date.parse('2026-09-17T00:30:00Z'))
  })
})
