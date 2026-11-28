import { describe, expect, it } from 'vitest'
import source from './AnomalyView.vue?raw'

describe('anomaly live refresh', () => {
  it('fetches anomalous detectors a few at a time', () => {
    expect(source).toContain('const DETECTOR_FETCH_CONCURRENCY = 4')
    expect(source).toContain('settleWithLimit(visible, DETECTOR_FETCH_CONCURRENCY, c => fetchConfigData(c, activeRangeIdx(), signal))')
    expect(source).toContain('settleWithLimit(visible, DETECTOR_FETCH_CONCURRENCY, c => fetchConfigData(c))')
    expect(source).not.toContain('Promise.allSettled(visible.map(')
  })
})

describe('anomaly detector writes', () => {
  it('keeps the rule window on edit and shows why a save failed', () => {
    expect(source).not.toContain('window_secs: 3600')
    expect(source).toContain('window_secs: config.windowSecs')
    expect(source).toContain('eval_interval_secs: config.evalIntervalSecs')
    expect(source).not.toContain('catch { /* best effort */ }\n  config.name = newName')
    expect(source).toContain('<span v-if="editError" class="edit-error" role="alert">{{ editError }}</span>')
  })

  it('sends to every channel in turn and reports failures', () => {
    expect(source).not.toContain('failed silently')
    expect(source).not.toContain('await Promise.all(channels.value.map(')
    expect(source).toContain('await sendInTurn(targets, ch => api.notifyChannel(')
    expect(source).toContain('class="alert-picker-notice" role="status"')
  })
})
