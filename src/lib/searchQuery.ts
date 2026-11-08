import type { Filter } from '../types'

const OPS: Record<string, string> = { '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=', '~': 'LIKE' }
const TOKENS = Object.fromEntries(Object.entries(OPS).map(([token, op]) => [op, token]))

/**
 * Split a search box value into `field<op>value` filters and free-text words.
 * `service_name=checkout level!=debug timeout` → two filters and ["timeout"].
 */
export function parseSearchQuery(raw: string): { filters: Filter[]; text: string[] } {
  const filters: Filter[] = []
  const text: string[] = []
  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    const match = part.match(/^([a-zA-Z0-9_.]+)(=|!=|>=|<=|>|<|~)(.+)$/)
    if (match) filters.push({ field: match[1]!, op: OPS[match[2]!] || '=', value: match[3]! })
    else text.push(part)
  }
  return { filters, text }
}

/**
 * The reverse of `parseSearchQuery`: write filters as search text. Filters the
 * text can't hold (IN, an empty value, a value with spaces) come back in `rest`.
 */
export function filtersToSearch(filters: Filter[]): { search: string; rest: Filter[] } {
  const words: string[] = []
  const rest: Filter[] = []
  for (const f of filters) {
    const value = String(f.value ?? '')
    const token = TOKENS[f.op]
    if (token && /^[a-zA-Z0-9_.]+$/.test(f.field) && value && !/\s/.test(value) && !/^[=!<>~]/.test(value)) words.push(`${f.field}${token}${value}`)
    else rest.push(f)
  }
  return { search: words.join(' '), rest }
}
