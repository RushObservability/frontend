import type { DashboardDefaults } from '../types'

export const dashboardRefreshOptions = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

function queryNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

export function dashboardViewDefaults(
  defaults: DashboardDefaults | undefined,
  query: { t?: unknown; refresh?: unknown },
  fallbackMinutes = 60,
): DashboardDefaults {
  const minutes = queryNumber(query.t)
  const refresh = queryNumber(query.refresh)
  return {
    time_range_minutes: minutes !== undefined && minutes > 0 && minutes <= 525_600
      ? minutes : defaults?.time_range_minutes ?? fallbackMinutes,
    refresh_interval_secs: refresh !== undefined && dashboardRefreshOptions.some(option => option.value === refresh)
      ? refresh : defaults?.refresh_interval_secs ?? 0,
  }
}
