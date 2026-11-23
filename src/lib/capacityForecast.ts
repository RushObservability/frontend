import type { CapacityForecastConfig, ForecastResource } from '../types'

export type ForecastDraft = Omit<CapacityForecastConfig, 'resource'> & { resource: ForecastResource | null }

export function defaultForecast(): ForecastDraft {
  return { metric_name: 'system.filesystem.utilization', resource: null, input_unit: 'ratio', horizon_secs: 86_400 }
}

export function forecastResourceLabel(resource: ForecastResource): string {
  const labels = { ...resource.resource_attributes, ...resource.attributes }
  const host = labels['host.name'] || labels.instance || labels.host || labels['k8s.node.name'] || resource.service
  const volume = labels.mountpoint || labels.mount_point || labels.device || labels['system.filesystem.mountpoint']
  const role = labels.state
  const title = [host, volume, role].filter(Boolean).join(' · ')
  return title || 'Unlabeled series'
}

export function forecastLabelDetail(resource: ForecastResource): string {
  return [
    ...Object.entries(resource.attributes).map(([key, value]) => `${key}=${value}`),
    ...Object.entries(resource.resource_attributes).map(([key, value]) => `resource.${key}=${value}`),
  ].join(', ')
}

export function forecastResourceKey(resource: ForecastResource): string {
  const entries = (labels: Record<string, string>) => Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([resource.service, entries(resource.attributes), entries(resource.resource_attributes)])
}
