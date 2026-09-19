import { describe, expect, it } from 'vitest'
import { dashboardViewDefaults } from './dashboardDefaults'

const saved = { time_range_minutes: 10080, refresh_interval_secs: 30 }

describe('dashboard view defaults', () => {
  it('prefers saved values over browser preferences', () => {
    expect(dashboardViewDefaults(saved, {}, 15)).toEqual(saved)
  })
  it('supports URL overrides including explicitly disabling refresh', () => {
    expect(dashboardViewDefaults(saved, { t: '360', refresh: '0' })).toEqual({ time_range_minutes: 360, refresh_interval_secs: 0 })
  })
  it('ignores invalid or duplicate URL values', () => {
    for (const value of ['', 'NaN', '-1', '0.5', '525601', ['60', '360']]) {
      expect(dashboardViewDefaults(saved, { t: value, refresh: value })).toEqual(saved)
    }
  })
  it('keeps compatibility with APIs without defaults', () => {
    expect(dashboardViewDefaults(undefined, {}, 180)).toEqual({ time_range_minutes: 180, refresh_interval_secs: 0 })
  })
})
