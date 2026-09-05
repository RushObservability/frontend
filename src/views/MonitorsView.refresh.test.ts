import { describe, expect, it } from 'vitest'
import source from './MonitorsView.vue?raw'

describe('monitor list refresh', () => {
  it('refreshes rows through the shared polling scheduler', () => {
    expect(source).toContain("category: 'alert_list'")
    expect(source).toContain('intervalMs: 10_000')
    expect(source).toContain('api.listMonitors(signal)')
    expect(source).toContain('refreshLoop.start()')
    expect(source).toContain('onUnmounted(() => refreshLoop.stop())')
  })
})
