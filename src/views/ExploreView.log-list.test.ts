import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore log list', () => {
  it('holds rows shallowly and replaces the array on append', () => {
    expect(source).toContain('const otelLogs = shallowRef<LogRecord[]>([])')
    const loadMore = between('async function loadMore()', '} else {')
    expect(loadMore).toContain('otelLogs.value = otelLogs.value.concat(page.rows)')
    expect(loadMore).not.toContain('otelLogs.value.push(')
  })

  it('stops infinite scroll at the loaded-row cap and says so', () => {
    expect(source).toContain('const MAX_LOADED_LOG_ROWS = 10_000')
    expect(between('async function loadMore()', '} else {'))
      .toContain('paginationHasMore.value = page.has_more && Boolean(page.next_cursor) && otelLogs.value.length < MAX_LOADED_LOG_ROWS')
    expect(between('<div class="scroll-sentinel scroll-sentinel-logs">', '</VirtualTable>'))
      .toMatch(/v-else-if="otelLogs.length >= MAX_LOADED_LOG_ROWS"[^>]*>\s*Showing the first \{\{ MAX_LOADED_LOG_ROWS.toLocaleString\(\) \}\}[^<]*Narrow your query/)
  })

  it('reuses unchanged entries so appending or hydrating one row does not rebuild the rest', () => {
    const entries = between('const logEntries = computed(', 'entries.sort(')
    expect(entries).toContain('const cached = otelLogEntryCache.get(log)')
    expect(entries).toContain('if (cached?._sourceLogIndex === sourceLogIndex)')
    expect(entries).toContain('otelLogEntryCache.set(log, entry)')
    const hydrate = between('async function hydrateOtelLog(', 'function toggleLogRow(')
    expect(hydrate).not.toContain('[...otelLogs.value]')
    expect(hydrate).toContain('if (otelLogs.value[idx] !== row) return')
    expect(hydrate).toContain('otelLogs.value[idx] = { ...row, ...detail }')
    expect(hydrate).toContain('triggerRef(otelLogs)')
  })
})
