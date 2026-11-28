import { describe, expect, it } from 'vitest'
import source from './RumDetailView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('RUM app detail', () => {
  it('ignores app data for an older time range', () => {
    const fetchData = between('async function fetchData()', 'async function openSession(')
    expect(fetchData).toContain('const generation = ++dataGeneration')
    const guard = fetchData.indexOf('if (generation !== dataGeneration) return')
    expect(guard).toBeGreaterThan(fetchData.indexOf('await Promise.all('))
    expect(guard).toBeLessThan(fetchData.indexOf('vitals.value = vitalsRes.vitals'))
    expect(fetchData).toContain('if (generation === dataGeneration) loadingData.value = false')
  })

  it('ignores a previously opened session', () => {
    const openSession = between('async function openSession(', 'function closeSessionDetail(')
    expect(openSession).toContain('const generation = ++sessionGeneration')
    expect(openSession).toContain('if (generation === sessionGeneration) sessionEvents.value = res.events')
    expect(openSession).toContain('if (generation === sessionGeneration) sessionEvents.value = []')
    expect(openSession).toContain('if (generation === sessionGeneration) sessionDetailLoading.value = false')
  })
})
