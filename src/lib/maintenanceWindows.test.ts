import { describe, expect, it } from 'vitest'
import type { MaintenanceWindow } from '../types'
import {
  addMinutes,
  localInputToIso,
  scopeLabel,
  scopeReady,
  scopeValue,
  sortWindows,
  toLocalInput,
} from './maintenanceWindows'

function window(overrides: Partial<MaintenanceWindow>): MaintenanceWindow {
  return {
    id: 'w',
    name: 'w',
    scope: 'all',
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: '2026-10-01T01:00:00Z',
    created_at: '',
    created_by: 'admin',
    status: 'scheduled',
    ...overrides,
  }
}

describe('maintenance windows', () => {
  it('builds and validates scopes', () => {
    const base = { kind: 'all' as const, monitorId: '', tagKey: '', tagValue: '' }
    expect(scopeValue(base)).toBe('all')
    expect(scopeValue({ ...base, kind: 'monitor', monitorId: 'm1' })).toBe('monitor:m1')
    expect(scopeValue({ ...base, kind: 'tag', tagKey: ' service ', tagValue: 'checkout ' })).toBe('tag:service:checkout')
    expect(scopeReady({ ...base, kind: 'monitor' })).toBe(false)
    expect(scopeReady({ ...base, kind: 'tag', tagKey: 'service' })).toBe(false)
    expect(scopeReady(base)).toBe(true)
  })

  it('labels scopes', () => {
    const names = (id: string) => (id === 'm1' ? 'Checkout errors' : undefined)
    expect(scopeLabel('all', names)).toBe('All alerts')
    expect(scopeLabel('monitor:m1', names)).toBe('Checkout errors')
    expect(scopeLabel('monitor:gone', names)).toBe('Deleted alert')
    expect(scopeLabel('alert:m1', names)).toBe('Checkout errors')
    expect(scopeLabel('tag:service:checkout', names)).toBe('service:checkout')
  })

  it('sorts active, then upcoming, then recently ended', () => {
    const sorted = sortWindows([
      window({ id: 'ended-old', status: 'ended', ends_at: '2026-09-01T00:00:00Z' }),
      window({ id: 'later', status: 'scheduled', starts_at: '2026-10-05T00:00:00Z' }),
      window({ id: 'active', status: 'active' }),
      window({ id: 'ended-new', status: 'ended', ends_at: '2026-09-20T00:00:00Z' }),
      window({ id: 'sooner', status: 'scheduled', starts_at: '2026-10-02T00:00:00Z' }),
    ])
    expect(sorted.map(w => w.id)).toEqual(['active', 'sooner', 'later', 'ended-new', 'ended-old'])
  })

  it('converts between datetime-local values and UTC', () => {
    const local = toLocalInput(new Date(2026, 9, 1, 2, 5))
    expect(local).toBe('2026-10-01T02:05')
    expect(localInputToIso(local)).toBe(new Date(2026, 9, 1, 2, 5).toISOString())
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('nonsense')).toBeNull()
    expect(addMinutes('2026-10-01T23:30', 60)).toBe('2026-10-02T00:30')
  })
})
