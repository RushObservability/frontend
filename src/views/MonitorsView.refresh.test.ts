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

  it('uses alert terminology in user-facing copy', () => {
    expect(source).toContain('<h1 class="monitors-title">Alerts</h1>')
    expect(source).toContain('New alert')
    expect(source).toContain('placeholder="Search alerts..."')
    expect(source).toContain('No alerts configured')
    expect(source).not.toContain('New Monitor')
    expect(source).not.toContain('Search monitors...')
  })
})
