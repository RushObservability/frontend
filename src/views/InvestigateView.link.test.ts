import { describe, expect, it } from 'vitest'
import { openedInApp } from '../lib/investigateLink'
import source from './InvestigateView.vue?raw'

describe('investigate links', () => {
  it('treats only router navigation as in-app', () => {
    expect(openedInApp(null)).toBe(false)
    expect(openedInApp({ back: null, current: '/investigate?q=x' })).toBe(false)
    expect(openedInApp({ back: '/monitors/1', current: '/investigate?q=x' })).toBe(true)
  })

  it('starts from the URL only after in-app navigation, otherwise fills the form for a click', () => {
    expect(source).toContain('const inApp = openedInApp(window.history.state)')
    expect(source).toContain('const started = ref(inApp && !!(eventId.value || question.value))')
    expect(source).toContain("const inputQuestion = ref(inApp ? '' : question.value)")
    expect(source).toContain('v-model="additionalContext"')
    expect(source).toContain('@click="startInvestigation"')
  })
})
