import { describe, expect, it, vi } from 'vitest'
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
  it.each(['UTC', 'America/Los_Angeles', 'Europe/Berlin'])('keeps API timestamps in UTC in %s', timezone => {
    vi.stubEnv('TZ', timezone)
    try {
      for (const timestamp of ['2026-11-08 16:52:41.435000000', '2026-11-08T16:52:41.435Z', '2026-11-08T08:52:41.435-08:00']) {
        expect(relatedProfileLocation('articles', timestamp, 89_000_000)?.query).toEqual({
          service: 'articles', from: '2026-11-08T16:51:41.435Z', to: '2026-11-08T16:53:41.524Z',
        })
      }
      expect(relatedProfileLocation('api', '2026-11-01 01:30:00.000000000', 0)?.query.from).toBe('2026-11-01T01:29:00.000Z')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
