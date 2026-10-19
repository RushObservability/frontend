// Natural-language → structured filters for QueryNlInput (the SLO filter
// boxes). It reuses Explore's mode-aware rule parser (lib/nlQuery.ts) as the
// baseline and only lets /api/v1/parse-query replace it when the LLM returns
// filters, sending the same mode so both parsers target the same schema.

import type { QueryFilter, SloType } from '../types'
import { parseNaturalQuery, type NlChip, type NlMode } from './nlQuery'

/** Which schema an SLO's filters are evaluated against.
 *
 *  Trace SLOs are evaluated on spans, which have no log level, so "errors"
 *  must become an HTTP status filter. Metric SLOs have no log level either,
 *  so they use the non-log rules as well. There is no log-based SLO type; if
 *  one is added, this switch stops compiling until it is mapped to 'logs'. */
export function nlModeForSloType(sloType: SloType): NlMode {
  switch (sloType) {
    case 'trace': return 'spans'
    case 'metric': return 'spans'
  }
}

export interface NlFilterResult {
  filters: QueryFilter[]
  /** Free text the parser could not turn into a filter. */
  search: string
  confidence: number
  source: 'rules' | 'AI'
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>

function chipsToFilters(chips: NlChip[]): QueryFilter[] {
  return chips.map(c => ({ id: crypto.randomUUID(), field: c.field, op: c.op, value: String(c.value) }))
}

/** Client-side rule-based parse (works with no LLM configured). */
export function ruleBasedFilters(input: string, mode: NlMode): NlFilterResult {
  const { chips, search, confidence } = parseNaturalQuery(input, mode)
  return { filters: chipsToFilters(chips), search, confidence, source: 'rules' }
}

/** Rule-based baseline, replaced by the LLM result from /api/v1/parse-query
 *  when that endpoint is configured and actually finds filters. Any error or
 *  non-OK response (e.g. 501 with no LLM key) keeps the rule-based result. */
export async function parseNaturalLanguageFilters(
  input: string,
  mode: NlMode,
  fetcher: Fetcher,
): Promise<NlFilterResult> {
  const local = ruleBasedFilters(input, mode)
  try {
    const res = await fetcher('/api/v1/parse-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input, mode }),
    })
    if (!res.ok) return local
    const data = await res.json()
    const llm = chipsToFilters(data.filters ?? [])
    if (!llm.length) return local
    return { filters: llm, search: data.search ?? '', confidence: data.confidence ?? 0.9, source: 'AI' }
  } catch {
    return local
  }
}
