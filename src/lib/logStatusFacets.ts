import type { Filter } from '../types'

// Explore's Status facet reuses the span keys '2xx' / '4xx' / '5xx' in Logs
// mode, labelled Info / Warning / Error. The server counts each bucket by
// OpenTelemetry SeverityNumber (17+ error, 13-16 warn, below 13 info and
// anything lower), so the filters use the same ranges. SeverityNumber is set
// for every ingest path, so "ERROR", "Error" and "error" all filter alike.
const ERROR_MIN = 17
const WARN_MIN = 13

/** Server filters for the Logs-mode Status facet and its "Errors only" toggle. */
export function logStatusFacetFilters(range: string, errorsOnly: boolean): Filter[] {
  const filters: Filter[] = []
  if (range === '5xx') {
    filters.push({ field: 'severity_number', op: '>=', value: ERROR_MIN })
  } else if (range === '4xx') {
    filters.push({ field: 'severity_number', op: '>=', value: WARN_MIN })
    filters.push({ field: 'severity_number', op: '<', value: ERROR_MIN })
  } else if (range === '2xx') {
    filters.push({ field: 'severity_number', op: '<', value: WARN_MIN })
  }
  if (errorsOnly && range !== '5xx') {
    filters.push({ field: 'severity_number', op: '>=', value: ERROR_MIN })
  }
  return filters
}
