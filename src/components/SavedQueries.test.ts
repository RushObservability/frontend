import { describe, expect, it } from 'vitest'
import formSource from './SaveQueryForm.vue?raw'
import source from './SavedQueries.vue?raw'
import exploreSource from '../views/ExploreView.vue?raw'

describe('saved queries', () => {
  it('saves straight from the toolbar without opening the list first', () => {
    expect(source).toContain('@click="openSave"')
    expect(source).toContain('function openSave() {\n  showForm(null, false)')
    expect(source).toContain('defineExpose({ openSave, openList })')
  })

  it('opens the saved list in a right-side drawer that can also save the current query', () => {
    expect(source).toContain('@click="openList"')
    expect(source).toContain('<DetailDrawer :open="drawerOpen"')
    expect(source).toContain('@click="showForm(null, true)">Save current query</button>')
    expect(source).toContain('aria-label="Back to saved queries"')
    expect(source).not.toContain('sq-dropdown')
  })

  it('labels each saved query as APM or Logs', () => {
    expect(source).toContain(":class=\"q.viewMode === 'logs' ? 'sq-kind-logs' : 'sq-kind-apm'\"")
    expect(source).toContain("{{ q.viewMode === 'logs' ? 'Logs' : 'APM' }}")
    expect(formSource).toContain("{{ preview.viewMode === 'logs' ? 'Logs' : 'APM' }}")
  })

  it('asks before deleting a saved query', () => {
    expect(source).toContain('@click="confirmingDelete = q.id"')
    expect(source).toContain('@click="confirmDelete(q.id)"')
  })

  it('binds s and Cmd/Ctrl+S in Explore to the save form', () => {
    expect(exploreSource).toContain("(e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's'")
    expect(exploreSource).toContain("if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey)")
    expect(exploreSource).toContain('ref="savedQueriesRef"')
    // Explore shortcuts stay quiet while a drawer owns the keyboard.
    expect(exploreSource).toContain("if (document.querySelector('.detail-drawer-overlay')) return")
  })
})

describe('save query form', () => {
  it('has a title, a description and a sharing choice', () => {
    expect(formSource).toContain('v-model="form.name"')
    expect(formSource).toContain('v-model="form.description"')
    expect(formSource).toContain('value="tenant"')
    expect(formSource).toContain('value="group"')
    expect(formSource).toContain('value="private"')
  })

  it('defaults new saves to the tenant only for users who may share', () => {
    expect(formSource).toContain("visibility: props.canShare ? 'tenant' : 'private'")
    expect(formSource).toContain(':disabled="!canShare || visibilityLocked"')
    expect(formSource).toContain(':disabled="!canShare || noGroups || visibilityLocked"')
  })

  it('requires a group when sharing with one and locks sharing for non-owners', () => {
    expect(formSource).toContain("form.value.visibility !== 'group' || !!form.value.groupId")
    expect(formSource).toContain('!!props.editing && !props.canChangeVisibility')
    expect(source).toContain(':can-change-visibility="!editing || isOwner(editing)"')
  })
})
