const EXPLICIT_TIMEZONE = /(?:z|[+-]\d{2}:?\d{2})$/i

/** Parse API timestamps, which use UTC even when ClickHouse omits the `Z`. */
export function parseInvestigationTimestamp(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN

  const iso = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  const milliseconds = iso.replace(/(\.\d{3})\d+/, '$1')
  return Date.parse(EXPLICIT_TIMEZONE.test(milliseconds) ? milliseconds : `${milliseconds}Z`)
}

export function formatInvestigationActivity(value: string, now = Date.now()): string {
  const timestamp = parseInvestigationTimestamp(value)
  if (!Number.isFinite(timestamp)) return 'Unknown'

  const elapsed = Math.max(0, now - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(now).getUTCFullYear() === new Date(timestamp).getUTCFullYear()
      ? undefined
      : 'numeric',
  })
}
