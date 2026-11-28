import { describe, expect, it } from 'vitest'
import source from './ProfilesView.vue?raw'

describe('profile function rows', () => {
  it('aggregates stacks once per result and only refilters and sorts on search', () => {
    expect(source).toContain('const result = shallowRef<ProfileResult | null>(null)')
    expect(source).toContain('const baseline = shallowRef<ProfileResult | null>(null)')
    expect(source).toContain('const functionRows = computed(() => profileFunctions(result.value?.stacks ?? [], baseline.value?.stacks ?? []))')
    const rows = source.slice(source.indexOf('const rows = computed('), source.indexOf('const hasCpu'))
    expect(rows).toContain('functionRows.value.filter(')
    expect(rows).not.toContain('profileFunctions(')
  })
})
