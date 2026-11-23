import type { Filter, ServiceTagDimension } from '../types'

export const SERVICE_TAG_FIELD = 'rush.service_tag'

export const serviceTagLabels: Record<ServiceTagDimension, string> = {
  region: 'Region',
  version: 'Version',
  endpoint: 'Endpoint',
}

export function isServiceTagDimension(value: unknown): value is ServiceTagDimension {
  return typeof value === 'string' && Object.hasOwn(serviceTagLabels, value)
}

export interface ServiceTagScope {
  service: string
  dimension: ServiceTagDimension
  selection: { kind: 'value'; value: string } | { kind: 'other'; excluded: string[] }
}

export function readServiceTagScope(raw: unknown): ServiceTagScope | null {
  if (typeof raw !== 'string' || raw.length > 12_000) return null
  try {
    const scope = JSON.parse(raw) as ServiceTagScope | null
    const bytes = new TextEncoder()
    const validTag = (value: unknown) => typeof value === 'string' && value.length > 0 && bytes.encode(value).length <= 256
    if (!scope || typeof scope.service !== 'string' || !scope.service || bytes.encode(scope.service).length > 1024
      || !isServiceTagDimension(scope.dimension)) return null
    const selection = scope.selection
    if (selection?.kind === 'value' && validTag(selection.value)) return scope
    if (selection?.kind === 'other' && Array.isArray(selection.excluded)
      && selection.excluded.length <= 3 && selection.excluded.every(validTag)) return scope
  } catch { /* Ignore malformed scopes. */ }
  return null
}

export function serviceTagFilter(scope: ServiceTagScope): Filter {
  return { field: SERVICE_TAG_FIELD, op: '=', value: JSON.stringify(scope) }
}
