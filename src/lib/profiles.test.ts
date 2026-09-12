import { describe, expect, it } from 'vitest'
import { buildFlameTree, layoutFlameTree, profileFunctions, relatedProfileLocation } from './profiles'
describe('profiles', () => {
  const stacks = [{ frames: ['main', 'parse'], cpu_seconds: 3 }, { frames: ['main', 'encode'], cpu_seconds: 1 }]
  it('merges shared ancestors without summing inclusive CPU twice', () => {
    const root = buildFlameTree(stacks)
    expect(root.total).toBe(4)
    expect(root.children[0]?.total).toBe(4)
    expect(layoutFlameTree(root).find(r => r.node.name === 'parse')?.width).toBe(75)
  })
  it('distinguishes self and total CPU and handles recursion', () => {
    const rows = profileFunctions([{ frames: ['recurse', 'recurse'], cpu_seconds: 2 }])
    expect(rows[0]).toMatchObject({ self: 2, total: 2, share: 100 })
    expect(profileFunctions(stacks).find(r => r.name === 'main')).toMatchObject({ self: 0, total: 4 })
  })
  it('compares normalized self-CPU shares, including disappeared functions', () => {
    const rows = profileFunctions(stacks, [{ frames: ['main', 'gone'], cpu_seconds: 40 }])
    expect(rows.find(r => r.name === 'parse')?.delta).toBe(75)
    expect(rows.find(r => r.name === 'gone')?.delta).toBe(-100)
  })
  it('handles empty and zero CPU without invalid geometry', () => {
    expect(layoutFlameTree(buildFlameTree([]))).toEqual([])
    expect(buildFlameTree([{ frames: ['main'], cpu_seconds: NaN }]).total).toBe(0)
  })
  it('links to related service samples without claiming span attribution', () => {
    expect(relatedProfileLocation('api', '2026-09-12T10:00:00Z', 1e9)?.query).toEqual({ service: 'api', from: '2026-09-12T09:59:00.000Z', to: '2026-09-12T10:01:01.000Z' })
    expect(relatedProfileLocation('api', 'invalid', 0)).toBeNull()
    expect(relatedProfileLocation('api', NaN, 0)).toBeNull()
    expect(relatedProfileLocation('api', '2026-09-12T10:00:00Z', Infinity)).toBeNull()
    expect(relatedProfileLocation('api', Date.parse('2026-09-12T10:00:00Z') * 1e6, 1e9)?.query.to).toBe('2026-09-12T10:01:01.000Z')
  })
})
