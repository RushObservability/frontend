import { describe, expect, it } from 'vitest'
import source from './SaveQueryDrawer.vue?raw'
import listSource from './SavedQueries.vue?raw'

describe('save query drawer', () => {
  it('opens as a right-side dialog with a title, description and sharing choice', () => {
    expect(source).toContain('<DetailDrawer :open="open"')
    expect(source).toContain('v-model="form.name"')
    expect(source).toContain('v-model="form.description"')
    expect(source).toContain('value="tenant"')
    expect(source).toContain('value="group"')
    expect(source).toContain('value="private"')
  })

  it('defaults new saves to the tenant only for users who may share', () => {
    expect(source).toContain("visibility: props.canShare ? 'tenant' : 'private'")
    expect(source).toContain(':disabled="!canShare || visibilityLocked"')
    expect(source).toContain(':disabled="!canShare || noGroups || visibilityLocked"')
  })

  it('requires a group when sharing with one and locks sharing for non-owners', () => {
    expect(source).toContain("form.value.visibility !== 'group' || !!form.value.groupId")
    expect(source).toContain('!!props.editing && !props.canChangeVisibility')
    expect(listSource).toContain(':can-change-visibility="!editing || isOwner(editing)"')
  })

  it('is used for both saving and editing from the Saved dropdown', () => {
    expect(listSource).toContain('@click="openDrawer(null)"')
    expect(listSource).toContain('@click="openDrawer(q)"')
    expect(listSource).not.toContain('sq-save-form')
  })
})
