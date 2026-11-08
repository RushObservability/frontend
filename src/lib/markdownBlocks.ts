// A small markdown subset parsed into plain data, so notes render as typed
// elements instead of injected HTML.

export type Inline = { kind: 'text' | 'strong' | 'code'; text: string }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }

/** `**bold**` and `` `code` ``; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+?\*\*)/)) {
    if (!part) continue
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) out.push({ kind: 'code', text: part.slice(1, -1) })
    else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push({ kind: 'strong', text: part.slice(2, -2) })
    else out.push({ kind: 'text', text: part })
  }
  return out
}

/** Headings (#, ##, ###), lists (-, *, 1.), fenced code, and paragraphs. */
export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!)
      i++
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = line.match(/^(#{1,3}) (.+)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, inline: parseInline(heading[2]!) })
      i++
      continue
    }
    const listItem = /^(?:[-*]|(\d+)\.) (.+)$/
    const first = line.match(listItem)
    if (first) {
      const ordered = Boolean(first[1])
      const items: Inline[][] = []
      let m: RegExpMatchArray | null
      while (i < lines.length && (m = lines[i]!.match(listItem)) && Boolean(m[1]) === ordered) {
        items.push(parseInline(m[2]!))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (!line.trim()) { i++; continue }
    const para: Inline[][] = []
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,3} |[-*] |\d+\. )/.test(lines[i]!)) {
      para.push(parseInline(lines[i++]!))
    }
    blocks.push({ kind: 'paragraph', lines: para })
  }
  return blocks
}
