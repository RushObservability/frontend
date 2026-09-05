const SERVICE_GROUP_FIELDS = new Set(['service', 'service_name'])
const ENDPOINT_GROUP_FIELDS = new Set(['endpoint', 'http_path'])

export function normalizeApmGroups(
  service: string,
  endpointFilter: string,
  groupBy: string[],
): string[] {
  const endpoint = endpointFilter.trim()
  const groups = [...new Set(groupBy)].filter(field => (
    endpoint.length > 0 || !ENDPOINT_GROUP_FIELDS.has(field)
  ))

  if (service.includes('*') && !groups.some(field => SERVICE_GROUP_FIELDS.has(field))) {
    groups.unshift('service_name')
  }
  if (endpoint.includes('*') && !groups.some(field => ENDPOINT_GROUP_FIELDS.has(field))) {
    const serviceIndex = groups.findIndex(field => SERVICE_GROUP_FIELDS.has(field))
    groups.splice(serviceIndex >= 0 ? serviceIndex + 1 : 0, 0, 'endpoint')
  }

  return groups
}
