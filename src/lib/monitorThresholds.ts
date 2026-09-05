import type { MonitorComparator } from '../types'

export function normalizeThreshold(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function thresholdOrderError(
  comparator: MonitorComparator,
  critical: unknown,
  warning: unknown,
): string | null {
  const alertValue = normalizeThreshold(critical)
  const warningValue = normalizeThreshold(warning)
  if (alertValue === null || warningValue === null) return null

  if ((comparator === 'above' || comparator === 'above_or_equal') && warningValue > alertValue) {
    return 'Warning must be at or below the alert threshold.'
  }
  if ((comparator === 'below' || comparator === 'below_or_equal') && warningValue < alertValue) {
    return 'Warning must be at or above the alert threshold when lower values are worse.'
  }
  return null
}
