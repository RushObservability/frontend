import type { Filter } from '../types'

const OPS: Record<string, string> = { '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=', '~': 'LIKE' }

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
