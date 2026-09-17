const EXPLICIT_TIMEZONE = /(?:z|[+-]\d{2}:?\d{2})$/i

/** ClickHouse sends UTC timestamps without a timezone suffix. */
export function parseUtcTimestamp(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN

  const iso = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  const milliseconds = iso.replace(/(\.\d{3})\d+/, '$1')
  return Date.parse(EXPLICIT_TIMEZONE.test(milliseconds) ? milliseconds : `${milliseconds}Z`)
}
