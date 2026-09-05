import { describe, expect, it } from 'vitest'
import source from './MonitorDetailView.vue?raw'

describe('monitor detail chart layout', () => {
  it('gives the live plot an explicit responsive height', () => {
    expect(source).toContain('class="detail-section detail-live-panel"')
    expect(source).toContain('.detail-live-panel :deep(.ts-widget)')
    expect(source).toContain('height: clamp(320px, 36vw, 440px)')
    expect(source).not.toContain('min-height: clamp(280px, 38vw, 450px)')
  })
})
