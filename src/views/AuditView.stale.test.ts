import { describe, expect, it } from 'vitest'
import source from './AuditView.vue?raw'

describe('AuditView event loading', () => {
  it('ignores events for an older filter, time range or page', () => {
    const loadEvents = source.slice(source.indexOf('async function loadEvents()'), source.indexOf('function applyFilters()'))
    expect(loadEvents).toContain('const generation = ++loadGeneration')
    expect(loadEvents.match(/if \(generation !== loadGeneration\) return/g)).toHaveLength(2)
    expect(loadEvents.indexOf('if (generation !== loadGeneration) return')).toBeLessThan(loadEvents.indexOf('events.value = res.events'))
    expect(loadEvents).toContain('if (generation === loadGeneration) loading.value = false')
  })
})
