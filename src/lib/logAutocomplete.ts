import type { Filter, LogRecord } from '../types'
import { logColumnValue, type LogViewColumn } from './logViews'

export function searchTokens(text: string): { token: string; start: number; end: number }[] {
  const tokens = []
  let start = 0
  let quote = ''
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i] ?? ' '
    if (quote && ch === '\\' && i + 1 < text.length) { i++; continue }
    if (quote && ch === quote) quote = ''
    else if (!quote && (ch === '"' || ch === "'")) quote = ch
    if (i === text.length || (!quote && /\s/.test(ch))) {
      if (i > start) tokens.push({ token: text.slice(start, i), start, end: i })
      start = i + 1
    }
  }
  return tokens
}

export function searchTokenAt(text: string, cursor: number) {
  const match = searchTokens(text).find(token => token.start <= cursor && token.end >= cursor)
  return match ? { ...match, token: text.slice(match.start, cursor) } : { token: '', start: cursor, end: cursor }
}

export function completionPrefix(value: string): string {
  const quote = value[0]
  if (quote !== '"' && quote !== "'") return value
  const content = value.slice(1, value.length > 1 && value.endsWith(quote) ? -1 : undefined)
  return content.replace(/\\([\\"'])/g, '$1')
}

export function filterValue(value: string): string | number {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) { try { return JSON.parse(value) } catch { /* incomplete escape */ } }
    return completionPrefix(value)
  }
  const number = Number(value)
  return Number.isNaN(number) ? value : number
}

export function logSearchFields(columns: LogViewColumn[], filters: Filter[], rows: LogRecord[]): string[] {
  const fields = new Set(['service_name', 'severity_text', 'severity_number', 'trace_id', 'span_id', 'scope_name', 'body'])
  function add(field: string) {
    if (!field || fields.size >= 160) return
    fields.add(field)
    if (field.startsWith('log.')) fields.add(field.slice(4))
  }
  columns.forEach(column => add(column.field))
  filters.forEach(filter => add(filter.field))
  function jsonFields(value: unknown, prefix: string, depth: number) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return
    for (const [key, child] of Object.entries(value)) {
      if (!/^[a-zA-Z_][\w]*$/.test(key)) continue
      const field = `${prefix}.${key}`
      if (child !== null && typeof child === 'object') jsonFields(child, field, depth + 1)
      else add(field)
      if (fields.size >= 160) break
    }
  }
  for (const row of rows.slice(0, 50)) {
    Object.keys(row.DisplayValues ?? {}).forEach(add)
    Object.keys(row.LogAttributes ?? {}).forEach(key => add(`log.${key}`))
    Object.keys(row.ResourceAttributes ?? {}).forEach(key => add(`resource.${key}`))
    if (row.Body.length <= 16_384) {
      try { jsonFields(JSON.parse(row.Body), 'body', 0) } catch { /* plain log text */ }
    }
    if (fields.size >= 160) break
  }
  return [...fields]
}

export function localLogSuggestions(rows: LogRecord[], field: string, prefix: string): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const value = logColumnValue(row, field) || (!field.includes('.') ? logColumnValue(row, `log.${field}`) || logColumnValue(row, `resource.${field}`) : '')
    if (value && value.length <= 512 && value.toLowerCase().startsWith(prefix.toLowerCase())) values.add(value)
  }
  return [...values].sort().slice(0, 20)
}
