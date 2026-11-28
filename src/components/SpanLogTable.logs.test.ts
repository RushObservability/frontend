import { describe, expect, it } from 'vitest'
import source from './SpanLogTable.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('span log table', () => {
  it('parses each span event once and does not copy every log row per page', () => {
    expect(source).toContain('const spanEventAttributesCache = new WeakMap<RushEvent, Record<string, unknown>[]>()')
    const logs = between('const logs = computed<LogEntry[]>(', 'entries.sort(')
    expect(logs).toContain('const eventAttributes = spanEventAttributes(row)')
    expect(logs).not.toContain('JSON.parse(')
    expect(source).not.toContain('({ ...log })')
    expect(source).toContain(':rows="logs"')
  })

  it('says when the parent stopped paging before the end of the window', () => {
    expect(source).toMatch(/v-else-if="!searchActive && capped"[^>]*>Showing the newest \{\{ logs\.length\.toLocaleString\(\) \}\} logs\. Narrow the time range/)
    const capped = source.indexOf('v-else-if="!searchActive && capped"')
    expect(capped).toBeLessThan(source.indexOf('End of selected time window'))
  })
})
