import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'
import { failedInsideTrace, spanModeFilters, spanModeHint, visibleFilters } from './tracesOnly'

const view = readFileSync(new URL('../views/ExploreView.vue', import.meta.url), 'utf8')
const state = readFileSync(new URL('../components/ExploreResultsState.vue', import.meta.url), 'utf8')

describe('traces-only span-mode fallback', () => {
  it('drops only the root-span filter', () => {
    const service = { field: 'service_name', op: '=', value: 'payments' }
    const status = { field: 'http_status_code', op: '>=', value: 500 }
    expect(spanModeFilters([service, status, { field: 'parent_span_id', op: '=', value: '' }]))
      .toEqual([service, status])
  })

  it('does nothing outside traces-only mode', () => {
    expect(spanModeFilters([{ field: 'service_name', op: '=', value: 'gateway' }])).toBeNull()
    expect(spanModeFilters([{ field: 'parent_span_id', op: '!=', value: '' }])).toBeNull()
  })

  it('describes the matching span count', () => {
    expect(spanModeHint(2132, false)).toContain('2,132 matching spans')
    expect(spanModeHint(1, false)).toContain('1 matching span exist')
    expect(spanModeHint(10000, true)).toContain('10,000+ matching spans')
  })

  it('shows the hint and a span-mode action when Traces only is empty', () => {
    expect(view).toContain('if (!isLogs && !results.value.length) void checkSpanModeFallback(activeFilters, searchParam)')
    expect(view).toContain(':hint="spanModeFallback ? spanModeHint(spanModeFallback.count, spanModeFallback.capped) : null"')
    expect(view).toContain('@click="tracesOnly = false">Show matching spans</button>')
    expect(state).toContain('if (props.hint) return props.hint')
  })
})

describe('traces-only rows and chips', () => {
  it('does not show the Traces only root filter as a removable chip', () => {
    const service = { field: 'service_name', op: '=', value: 'gateway' }
    const root = { field: 'parent_span_id', op: '=', value: '' }
    expect(visibleFilters([service, root])).toEqual([service])
    expect(visibleFilters([{ field: 'parent_span_id', op: '!=', value: '' }])).toHaveLength(1)
  })

  it('marks a successful root whose trace failed further down', () => {
    expect(failedInsideTrace({ trace_error: true, status: 'STATUS_CODE_OK', http_status_code: 201 })).toBe(true)
    expect(failedInsideTrace({ trace_error: false, status: 'STATUS_CODE_OK', http_status_code: 201 })).toBe(false)
    expect(failedInsideTrace({ status: 'STATUS_CODE_OK', http_status_code: 200 })).toBe(false)
  })

  it('leaves a failed root to its own red status', () => {
    expect(failedInsideTrace({ trace_error: true, status: 'STATUS_CODE_OK', http_status_code: 503 })).toBe(false)
    expect(failedInsideTrace({ trace_error: true, status: 'STATUS_CODE_ERROR', http_status_code: 0 })).toBe(false)
  })

  it('renders the marker in the result row status cell', () => {
    expect(view).toContain('v-if="failedInsideTrace(row)"')
    expect(view).toContain('return visibleFilters(filters.value).map(')
  })
})
