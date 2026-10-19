import type { Filter } from '../types'
import { isErrorSpan } from './spanStatus'

/** The filter Explore's "Traces only" toggle adds so each trace is listed once, by its root span. */
export const TRACE_ROOT_FILTER: Filter = { field: 'parent_span_id', op: '=', value: '' }

export function isTraceRootFilter(filter: Filter): boolean {
  return filter.field === TRACE_ROOT_FILTER.field && filter.op === TRACE_ROOT_FILTER.op && filter.value === ''
}

/**
 * The same search in span mode: drop the root-span filter. Used to tell the user
 * when "Traces only" finds no root span but matching spans exist (e.g. the
 * selected service only ever appears as a child span).
 */
export function spanModeFilters(filters: Filter[]): Filter[] | null {
  if (!filters.some(isTraceRootFilter)) return null
  return filters.filter(filter => !isTraceRootFilter(filter))
}

export function spanModeHint(count: number, capped: boolean): string {
  const label = `${count.toLocaleString()}${capped ? '+' : ''} matching span${count === 1 && !capped ? '' : 's'}`
  return `No root span matches these filters, but ${label} exist in this range. Turn off Traces only to see them.`
}

/**
 * Filters to show as removable chips. The root-span filter is driven by the
 * "Traces only" toggle, not typed by the user, so it is not shown as a chip.
 */
export function visibleFilters<T extends Filter>(filters: T[]): T[] {
  return filters.filter(filter => !isTraceRootFilter(filter))
}

/**
 * In Traces only mode a row is the trace's root span, which can succeed while a
 * downstream span in the same trace failed. Mark those rows; a root that failed
 * itself already shows a red status.
 */
export function failedInsideTrace(row: { trace_error?: boolean; status?: string | null; http_status_code?: number | null }): boolean {
  return Boolean(row.trace_error) && !isErrorSpan(row)
}
