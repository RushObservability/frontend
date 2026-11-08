/** Use only intervals supported by the versioned spans query contract. */
export function serviceQueryInterval(minutes: number): '1m' | '5m' | '15m' | '1h' {
  if (minutes <= 60) return '1m'
  if (minutes <= 360) return '5m'
  if (minutes <= 1440) return '15m'
  return '1h'
}

export function serviceQueryBucketSeconds(minutes: number): number {
  return { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 }[serviceQueryInterval(minutes)]
}
