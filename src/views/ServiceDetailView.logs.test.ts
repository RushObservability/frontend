import { describe, expect, it } from 'vitest'
import source from './ServiceDetailView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('service detail Logs tab', () => {
  it('reloads on a window change even while a page is loading, and drops the old responses', () => {
    expect(between('async function loadData()', 'async function loadSecondaryCharts(')).toContain('if (logsSeen.value) loadLogTraces()')
    const load = between('async function loadLogTraces(', 'async function loadEndpoints(')
    expect(load).toContain('const generation = append ? logsGeneration : ++logsGeneration')
    expect(load.match(/if \(generation !== logsGeneration\) return/g)).toHaveLength(2)
    expect(load).toContain('if (generation === logsGeneration) {')
  })

  it('keeps only spans with events and stops paging at the span cap', () => {
    expect(source).toContain('const logTraces = shallowRef<RushEvent[]>([])')
    const load = between('async function loadLogTraces(', 'async function loadEndpoints(')
    expect(load).toContain('const rows = res.rows.filter((row) => row.event_names?.length)')
    expect(load).toContain('logTraces.value = rows')
    expect(load).toContain('logSpansScanned.value += res.rows.length')
    expect(source).toContain('const MAX_LOG_SOURCE_SPANS = 5_000')
    expect(source).toContain('const logsCapped = computed(() => !!logNextCursor.value && logSpansScanned.value >= MAX_LOG_SOURCE_SPANS)')
    const table = between('force-mode="logs"', '/>')
    expect(table).toContain(':has-more="!!logNextCursor && !logsCapped"')
    expect(table).toContain(':capped="logsCapped"')
  })
})
