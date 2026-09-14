import { describe, expect, it } from 'vitest'
import source from './AuditView.vue?raw'

describe('AuditView expanded event details', () => {
  it('groups event, request, payload, and integrity data', () => {
    expect(source).toContain('class="audit-detail-intro"')
    expect(source).toContain('aria-label="Event record"')
    expect(source).toContain('aria-label="Request context"')
    expect(source).toContain('class="audit-payloads"')
    expect(source).toContain('<details class="audit-integrity">')
  })

  it('makes rows keyboard accessible', () => {
    expect(source).toContain(':aria-expanded="isExpanded(ev.id)"')
    expect(source).toContain('@keydown.enter.prevent="toggleRow(ev.id)"')
    expect(source).toContain('@keydown.space.prevent="toggleRow(ev.id)"')
    expect(source).toContain('role="region"')
  })
})
