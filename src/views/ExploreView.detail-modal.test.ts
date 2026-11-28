import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore detail modal', () => {
  it('starts a new generation whenever a row opens or the modal closes', () => {
    expect(between('function resetDetailData()', '}')).toContain('detailGeneration++')
    expect(between('function openDetailModal(', 'async function openLogDetailModal(')).toContain('resetDetailData()')
    expect(between('async function openLogDetailModal(', 'const modalLogEntry = computed(')).toContain('resetDetailData()')
    expect(between('function closeDetailPanel()', 'function investigateLogEntry(')).toContain('resetDetailData()')
  })

  it('drops trace and APM responses for a row that is no longer open', () => {
    for (const body of [
      between('async function loadApmData(', 'async function loadApmFromSpanNode('),
      between('async function loadTraceData(', 'function selectDetailTab('),
      between('// Standalone log with trace_id', 'const modalLogEntry = computed('),
    ]) {
      expect(body).toContain('const generation = detailGeneration')
      expect(body.match(/if \(generation === detailGeneration\) expanded(Apm|Trace)/g)).toHaveLength(3)
    }
  })
})
