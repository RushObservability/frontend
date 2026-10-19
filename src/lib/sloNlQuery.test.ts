import { describe, expect, it, vi } from 'vitest'
import { nlModeForSloType, parseNaturalLanguageFilters, ruleBasedFilters } from './sloNlQuery'
import queryNlInputSource from '../components/QueryNlInput.vue?raw'
import sloFormSource from '../components/SloForm.vue?raw'

const strip = (r: { filters: { field: string; op: string; value: string }[] }) =>
  r.filters.map(({ field, op, value }) => ({ field, op, value }))

const noLlm = () => vi.fn(async () => new Response('LLM not configured', { status: 501 }))

describe('nlModeForSloType', () => {
  it('parses trace SLO filters against spans', () => {
    expect(nlModeForSloType('trace')).toBe('spans')
  })

  it('never uses log levels for metric SLOs', () => {
    expect(nlModeForSloType('metric')).toBe('spans')
  })
})

describe('ruleBasedFilters — spans (trace SLOs)', () => {
  it('turns "errors" into a 5xx status filter, not level=error', () => {
    const r = ruleBasedFilters('errors from checkout', 'spans')
    expect(strip(r)).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'http_status_code', op: '>=', value: '500' },
    ])
    expect(r.filters.some(f => f.field === 'level')).toBe(false)
    expect(r.source).toBe('rules')
  })

  it('consumes "server errors" without leaving "server" as free text', () => {
    const r = ruleBasedFilters('server errors', 'spans')
    expect(strip(r)).toEqual([{ field: 'http_status_code', op: '>=', value: '500' }])
    expect(r.search).toBe('')
  })

  it('maps 5xx, client errors / 4xx, and an exact code', () => {
    expect(strip(ruleBasedFilters('5xx', 'spans'))).toEqual([{ field: 'http_status_code', op: '>=', value: '500' }])
    expect(strip(ruleBasedFilters('client errors', 'spans'))).toEqual([{ field: 'http_status_code', op: '>=', value: '400' }])
    expect(strip(ruleBasedFilters('4xx', 'spans'))).toEqual([{ field: 'http_status_code', op: '>=', value: '400' }])
    expect(strip(ruleBasedFilters('503 in production', 'spans'))).toEqual([
      { field: 'http_status_code', op: '=', value: '503' },
      { field: 'environment', op: '=', value: 'production' },
    ])
  })

  it('emits QueryFilter rows with ids and string values', () => {
    const [f] = ruleBasedFilters('5xx', 'spans').filters
    expect(typeof f!.id).toBe('string')
    expect(f!.id.length).toBeGreaterThan(0)
    expect(f!.value).toBe('500')
  })
})

describe('ruleBasedFilters — logs', () => {
  it('turns "errors" into level=error', () => {
    expect(strip(ruleBasedFilters('errors from checkout', 'logs'))).toEqual([
      { field: 'service_name', op: '=', value: 'checkout' },
      { field: 'level', op: '=', value: 'error' },
    ])
  })
})

describe('parseNaturalLanguageFilters', () => {
  it.each(['spans', 'logs'] as const)('sends mode=%s to /api/v1/parse-query', async (mode) => {
    const fetcher = noLlm()
    await parseNaturalLanguageFilters('errors', mode, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/parse-query')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'errors', mode })
  })

  it('falls back to the spans rule parse when the LLM is not configured', async () => {
    const r = await parseNaturalLanguageFilters('errors', 'spans', noLlm())
    expect(r.source).toBe('rules')
    expect(strip(r)).toEqual([{ field: 'http_status_code', op: '>=', value: '500' }])
  })

  it('falls back to the logs rule parse when the request throws', async () => {
    const r = await parseNaturalLanguageFilters('errors', 'logs', vi.fn(async () => { throw new Error('offline') }))
    expect(r.source).toBe('rules')
    expect(strip(r)).toEqual([{ field: 'level', op: '=', value: 'error' }])
  })

  it('keeps the rule parse when the LLM returns no filters', async () => {
    const fetcher = vi.fn(async () => Response.json({ filters: [], search: 'errors', confidence: 0.2 }))
    const r = await parseNaturalLanguageFilters('errors', 'spans', fetcher)
    expect(r.source).toBe('rules')
    expect(strip(r)).toEqual([{ field: 'http_status_code', op: '>=', value: '500' }])
  })

  it('uses LLM filters when it finds some', async () => {
    const fetcher = vi.fn(async () => Response.json({
      filters: [{ field: 'http_status_code', op: '>=', value: 500 }],
      search: 'checkout',
      confidence: 0.85,
    }))
    const r = await parseNaturalLanguageFilters('checkout server errors', 'spans', fetcher)
    expect(r.source).toBe('AI')
    expect(strip(r)).toEqual([{ field: 'http_status_code', op: '>=', value: '500' }])
    expect(r.search).toBe('checkout')
    expect(r.confidence).toBe(0.85)
  })
})

describe('QueryNlInput wiring', () => {
  it('uses the shared mode-aware parser instead of a local copy', () => {
    expect(queryNlInputSource).toContain('parseNaturalLanguageFilters(text.value, props.nlMode, authenticatedFetch)')
    expect(queryNlInputSource).not.toContain('ruleBasedParse')
    expect(queryNlInputSource).not.toContain("'level'")
    expect(queryNlInputSource).toContain('nlMode: NlMode')
  })

  it('SloForm passes the SLO type\'s parser mode to every filter box', () => {
    expect(sloFormSource).toContain('const nlMode = computed(() => nlModeForSloType(sloType.value))')
    const boxes = sloFormSource.split('\n').filter(l => l.includes('<QueryNlInput'))
    expect(boxes).toHaveLength(2)
    for (const line of boxes) expect(line).toContain(':nl-mode="nlMode"')
  })
})
