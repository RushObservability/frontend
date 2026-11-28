import { describe, expect, it, vi } from 'vitest'
import source from './InvestigationPanel.vue?raw'
import { addDisplayFields } from './InvestigationPanel.vue'

// Node has no DOM for DOMPurify; record that the summary still goes through it.
const sanitize = vi.hoisted(() => vi.fn((html: string, _options?: unknown) => html))
vi.mock('dompurify', () => ({ default: { sanitize } }))

describe('investigation event rendering', () => {
  it('derives each display field once, matching the expressions the template used to run', () => {
    const args = { query: 'service_name = "api"', limit: 50 }
    const call = { type: 'tool_call', args }
    const data = `first line\n${'x'.repeat(1000)}\nthird`
    const result = { type: 'tool_result', data }
    const empty = { type: 'tool_result' }
    const summary = { type: 'summary', text: '## Cause\n**db** is slow' }
    const thinking = { type: 'thinking_delta', text: 'checking' }
    for (const event of [call, result, empty, summary, thinking]) addDisplayFields(event)

    expect(call).toMatchObject({ argsText: JSON.stringify(args, null, 2) })
    expect(result).toMatchObject({ preview: data.split('\n')[0] })
    expect(empty).toMatchObject({ preview: '' })
    expect(summary).toMatchObject({ html: expect.stringContaining('<h2>Cause</h2>') })
    expect((summary as { html?: string }).html).toContain('<strong>db</strong>')
    expect(sanitize).toHaveBeenCalledTimes(1)
    expect(sanitize.mock.calls[0]?.[1]).toEqual({ ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'code', 'pre', 'ul', 'li'], ALLOWED_ATTR: [] })
    expect(thinking).not.toHaveProperty('html')
    expect(thinking).not.toHaveProperty('preview')
  })

  it('reads the derived fields in the template instead of recomputing them per render', () => {
    const template = source.slice(source.indexOf('<template>'), source.indexOf('<script lang="ts">'))
    expect(template).toContain('<div class="summary-text"')
    expect(template).toContain('html="event.html"></div>')
    expect(template).toContain('{{ event.argsText }}')
    expect(template).toContain('{{ event.preview }}...')
    expect(template).not.toContain('renderMarkdown(')
    expect(template).not.toContain('JSON.stringify(')
    expect(template).not.toContain(".split('\\n')")
  })
})
