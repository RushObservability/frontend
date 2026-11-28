import { describe, expect, it } from 'vitest'
import source from './RumView.vue?raw'

describe('RUM app list', () => {
  it('fetches app vitals a few at a time', () => {
    expect(source).toContain("import { settleWithLimit } from '../lib/settleWithLimit'")
    expect(source).toContain('await settleWithLimit(res.apps, 4, (app) => {')
    expect(source).not.toMatch(/Promise\.all\(\s*apps\.value\.map/)
  })

  it('ignores responses for an older time range', () => {
    expect(source).toContain('const generation = ++loadGeneration')
    expect(source.match(/if \(generation !== loadGeneration\) return/g)).toHaveLength(2)
    expect(source).toContain('if (generation === loadGeneration) loading.value = false')
    expect(source).not.toContain('appVitals.value[app.AppName] =')
  })
})
