export type CompletionKind = 'metric' | 'function' | 'label' | 'value'
export interface PromqlCompletion { text: string; kind: CompletionKind }
export interface CompletionContext {
  kind: 'expression' | 'label' | 'value'
  prefix: string
  start: number
  end: number
  metric?: string
  label?: string
}

export const promqlFunctions = [
  'abs', 'absent', 'avg', 'avg_over_time', 'ceil', 'changes', 'clamp',
  'count', 'count_over_time', 'delta', 'deriv', 'exp', 'floor',
  'histogram_quantile', 'holt_winters', 'idelta', 'increase', 'irate',
  'label_join', 'label_replace', 'ln', 'log2', 'log10',
  'max', 'max_over_time', 'min', 'min_over_time', 'minute',
  'predict_linear', 'quantile', 'quantile_over_time', 'rate', 'resets',
  'round', 'scalar', 'sort', 'sort_desc', 'sqrt', 'stddev',
  'stddev_over_time', 'stdvar', 'stdvar_over_time', 'sum', 'sum_over_time',
  'time', 'timestamp', 'topk', 'bottomk', 'vector', 'year',
]

/** Find the token around the caret, respecting quoted label values and escapes. */
export function completionContext(text: string, cursor: number): CompletionContext | null {
  let brace = -1
  let segment = -1
  let quote = ''
  let quoteStart = -1
  let escaped = false
  let brackets = 0
  for (let i = 0; i < cursor; i++) {
    const c = text[i]!
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (c === '\\' && quote !== '`') { escaped = true; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; quoteStart = i }
    else if (c === '{') { brace = i; segment = i + 1 }
    else if (c === '}') { brace = -1; segment = -1 }
    else if (c === ',' && brace >= 0) segment = i + 1
    else if (c === '[') brackets++
    else if (c === ']') brackets--
  }
  if (brackets > 0 || (quote && brace < 0)) return null
  if (brace >= 0) {
    const metric = text.slice(0, brace).match(/[a-zA-Z_:][a-zA-Z0-9_:]*\s*$/)?.[0].trim()
    const matcher = text.slice(segment, cursor).match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!~|!=|=)\s*/)
    if (matcher) {
      const start = segment + matcher[0].length
      if (quote && quoteStart === start) {
        let end = cursor
        let escape = escaped
        for (; end < text.length; end++) {
          const c = text[end]
          if (escape) { escape = false; continue }
          if (c === '\\' && quote !== '`') { escape = true; continue }
          if (c === quote) { end++; break }
        }
        let prefix = text.slice(start + 1, cursor)
        if (quote === '"') {
          try { prefix = JSON.parse(`"${prefix}"`) as string } catch { /* incomplete escape */ }
        }
        return { kind: 'value', metric, label: matcher[1], prefix, start, end }
      }
      // A closed quoted value is complete; don't replace it when typing a comma.
      if (/^["'`]/.test(text.slice(start))) return null
      let end = cursor
      while (end < text.length && !/[\s,}]/.test(text[end]!)) end++
      return { kind: 'value', metric, label: matcher[1], prefix: text.slice(start, cursor), start, end }
    }
    if (quote) return null
    let start = cursor
    let end = cursor
    while (start > segment && /[a-zA-Z0-9_]/.test(text[start - 1]!)) start--
    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end]!)) end++
    if (text.slice(segment, start).trim()) return null
    return { kind: 'label', metric, prefix: text.slice(start, cursor), start, end }
  }
  let start = cursor
  let end = cursor
  while (start > 0 && /[a-zA-Z0-9_:]/.test(text[start - 1]!)) start--
  while (end < text.length && /[a-zA-Z0-9_:]/.test(text[end]!)) end++
  if (text[start - 1] === '$' || /^\d/.test(text.slice(start, cursor))) return null
  return { kind: 'expression', prefix: text.slice(start, cursor), start, end }
}

export function matchCompletions(context: CompletionContext, names: string[]): PromqlCompletion[] {
  const prefix = context.prefix.toLowerCase()
  const matching = (values: string[], kind: CompletionKind, limit: number) => [...new Set(values)]
    .filter(value => value.toLowerCase().includes(prefix))
    .sort((a, b) => Number(b.toLowerCase().startsWith(prefix)) - Number(a.toLowerCase().startsWith(prefix)) || a.localeCompare(b))
    .slice(0, limit).map(text => ({ text, kind }))
  if (context.kind === 'expression') {
    // Reserve room for functions even when many metrics share the prefix.
    return [...matching(names, 'metric', 10), ...matching(promqlFunctions, 'function', 6)]
  }
  return matching(context.kind === 'label' ? names.filter(name => name !== '__name__') : names, context.kind, 16)
}

export function insertCompletion(text: string, context: CompletionContext, item: PromqlCompletion) {
  const after = text.slice(context.end)
  let insertion = item.kind === 'value' ? JSON.stringify(item.text) : item.text
  if (item.kind === 'function' && !/^\s*\(/.test(after)) insertion += '('
  return { text: text.slice(0, context.start) + insertion + after, cursor: context.start + insertion.length }
}
