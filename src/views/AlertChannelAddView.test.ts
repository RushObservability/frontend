import { describe, expect, it } from 'vitest'
import source from './AlertChannelAddView.vue?raw'

describe('add notification channel', () => {
  it('shows why a channel could not be saved', () => {
    expect(source).not.toContain('error in api.error')
    expect(source).toContain('saveError.value = e instanceof Error ? e.message')
    expect(source).toContain('<div v-if="saveError" class="save-error" role="alert">{{ saveError }}</div>')
  })
})
