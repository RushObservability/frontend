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
