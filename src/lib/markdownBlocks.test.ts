import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdownBlocks'

describe('parseMarkdown', () => {
  it('parses headings, lists, paragraphs and code', () => {
    expect(parseMarkdown('## Impact\n\nErrors on **checkout**.\nRolled back.\n\n- EU only\n- `card declined` spike\n1. first\n```\nSELECT 1\n```')).toEqual([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Impact' }] },
      { kind: 'paragraph', lines: [
        [{ kind: 'text', text: 'Errors on ' }, { kind: 'strong', text: 'checkout' }, { kind: 'text', text: '.' }],
        [{ kind: 'text', text: 'Rolled back.' }],
      ] },
      { kind: 'list', ordered: false, items: [
        [{ kind: 'text', text: 'EU only' }],
        [{ kind: 'code', text: 'card declined' }, { kind: 'text', text: ' spike' }],
      ] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'first' }]] },
      { kind: 'code', text: 'SELECT 1' },
    ])
  })

  it('keeps markup as plain text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }])
    expect(parseMarkdown('')).toEqual([])
  })
})
