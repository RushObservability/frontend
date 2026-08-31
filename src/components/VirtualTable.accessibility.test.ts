import { describe, expect, it } from 'vitest'
import component from './VirtualTable.vue?raw'

describe('VirtualTable accessibility contract', () => {
  it('publishes selection and global row position for recycled rows', () => {
    expect(component).toContain('role="listbox"')
    expect(component).toContain('role="option"')
    expect(component).toContain(':aria-posinset="index + 1"')
    expect(component).toContain(':aria-setsize="count"')
    expect(component).toContain(':aria-selected="selectedIndex === index"')
  })

  it('uses roving focus and keyboard activation', () => {
    expect(component).toContain(':tabindex="selectedIndex === index')
    expect(component).toContain('@keydown="onRowKeydown($event, index)"')
    expect(component).toContain("event.key === 'Enter' || event.key === ' '")
  })
})
