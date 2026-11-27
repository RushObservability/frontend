import { describe, expect, it } from 'vitest'
import source from './InvestigationPanel.vue?raw'

describe('investigation stream auto-scroll', () => {
  it('watches the turn count and the last turn instead of every event deeply', () => {
    // A deep watch walked up to 10k events per turn on every new event.
    expect(source).not.toMatch(/watch\(turns,[^)]*deep: true/)
    expect(source).toContain('watch([() => turns.value.length, () => turns.value.at(-1)?.events.length, () => turns.value.at(-1)?.done], scrollToBottom)')
  })
})
