import { describe, expect, it } from 'vitest'
import source from './TraceView.vue?raw'

describe('trace view insights', () => {
  it('holds the trace shallowly and renders grouped error insights', () => {
    expect(source).toContain('const trace = shallowRef<TraceResponse | null>(null)')
    expect(source).toContain('for (const text of errorSpanInsights(flatSpans.value.map(({ span }) => span))) {')
  })
})
