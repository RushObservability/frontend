import { describe, expect, it } from 'vitest'
import { completionContext, insertCompletion, matchCompletions } from './promqlCompletion'

describe('PromQL completion', () => {
  it('replaces the full metric at the caret without touching the surrounding expression', () => {
    const text = 'sum(rate(http_req_old[5m]))'
    const ctx = completionContext(text, text.indexOf('_old'))!
    expect(ctx.prefix).toBe('http_req')
    expect(insertCompletion(text, ctx, { text: 'http_requests_total', kind: 'metric' }).text)
      .toBe('sum(rate(http_requests_total[5m]))')
  })
  it('keeps function suggestions when many metrics match', () => {
    const ctx = completionContext('ra', 2)!
    const matches = matchCompletions(ctx, Array.from({ length: 50 }, (_, i) => `rate_metric_${i}`))
    expect(matches).toContainEqual({ text: 'rate', kind: 'function' })
    expect(matches.length).toBeLessThanOrEqual(16)
  })
  it('prioritizes prefixes over substring matches', () => {
    expect(matchCompletions(completionContext('http', 4)!, ['z_http', 'http_total'])[0]?.text).toBe('http_total')
  })
  it('inserts functions without duplicating an existing opening parenthesis', () => {
    expect(insertCompletion('ra', completionContext('ra', 2)!, { text: 'rate', kind: 'function' })).toEqual({ text: 'rate(', cursor: 5 })
    expect(insertCompletion('ra(foo)', completionContext('ra(foo)', 2)!, { text: 'rate', kind: 'function' }).text).toBe('rate(foo)')
  })
  it('completes labels after earlier matchers containing punctuation', () => {
    const text = 'http_total{path="/a,b}c", ser}'
    const ctx = completionContext(text, text.length - 1)!
    expect(ctx).toMatchObject({ kind: 'label', metric: 'http_total', prefix: 'ser' })
    expect(matchCompletions(ctx, ['__name__', 'service_name'])).toEqual([{ text: 'service_name', kind: 'label' }])
  })
  it.each(['=', '!=', '=~', '!~'])('completes values for %s without duplicated quotes', op => {
    const text = `http_total{service${op}"pay-old",env="prod"}`
    const ctx = completionContext(text, text.indexOf('-old'))!
    expect(ctx).toMatchObject({ kind: 'value', metric: 'http_total', label: 'service', prefix: 'pay' })
    expect(insertCompletion(text, ctx, { text: 'payments', kind: 'value' }).text)
      .toBe(`http_total{service${op}"payments",env="prod"}`)
  })
  it('quotes and escapes values, including spaces and commas', () => {
    const text = 'http_total{path='
    const result = insertCompletion(text, completionContext(text, text.length)!, { text: 'a, b"\\c', kind: 'value' })
    expect(result.text).toBe(text + JSON.stringify('a, b"\\c'))
  })
  it('handles escaped quotes in existing values', () => {
    const text = 'http_total{path="a\\"b, c",service="pa"}'
    const ctx = completionContext(text, text.indexOf('pa"') + 2)!
    expect(ctx).toMatchObject({ kind: 'value', label: 'service', prefix: 'pa' })
  })
  it('does not suggest metrics inside durations, numbers, strings, or dashboard variables', () => {
    for (const text of ['rate(http_total[5m', '$service', 'histogram_quantile(0.9', 'label_replace(foo, "na']) {
      expect(completionContext(text, text.length)).toBeNull()
    }
  })
  it('does not reopen suggestions after a completed value', () => {
    const text = 'http_total{service="payments"'
    expect(completionContext(text, text.length)).toBeNull()
  })
})
