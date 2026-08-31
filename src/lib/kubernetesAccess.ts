import type {
  KubernetesAccessDetailResponse,
  KubernetesAccessEvent,
  KubernetesAccessListResponse,
  KubernetesAccessSourceKind,
  KubernetesRecordingState,
  KubernetesSessionArtifact,
} from '../types'

export type KubernetesEvidenceKind =
  | 'gateway'
  | 'kubernetes_audit'
  | 'rush_cli'
  | 'ip_derived'
  | 'user_provided'

export interface KubectlCommandDisplay {
  command: string
  source: 'reported' | 'reconstructed'
}

const evidenceLabels: Record<KubernetesEvidenceKind, string> = {
  gateway: 'Gateway observed',
  kubernetes_audit: 'Kubernetes audit',
  rush_cli: 'Rush CLI reported',
  ip_derived: 'IP-derived, approximate',
  user_provided: 'User-provided label',
}

export function evidenceLabel(kind: KubernetesEvidenceKind): string {
  return evidenceLabels[kind]
}

export function evidenceForSource(source: KubernetesAccessSourceKind): KubernetesEvidenceKind {
  if ((source || '').includes('audit')) return 'kubernetes_audit'
  if (source === 'rush_cli') return 'rush_cli'
  return 'gateway'
}

export function recordingLabel(state: KubernetesRecordingState): string {
  switch (state) {
    case 'complete': return 'Complete'
    case 'partial': return 'Partial'
    case 'failed': return 'Failed'
    case 'not_recorded': return 'Not recorded'
    default: return state ? state.replace(/_/g, ' ') : 'Unknown'
  }
}

export function formatAccessTarget(event: KubernetesAccessEvent): string {
  const resource = event.subresource
    ? `${event.resource}/${event.subresource}`
    : event.resource
  return event.name ? `${resource}/${event.name}` : resource || 'Kubernetes API'
}

export function eventActor(event: KubernetesAccessEvent): string {
  return event.actor_name
    || event.actor_username
    || event.kube_username
    || event.actor_user_id
    || 'Unknown actor'
}

export function actorTypeLabel(event: KubernetesAccessEvent): string {
  switch (event.actor_type) {
    case 'user': return 'User session'
    case 'api_key': return 'API key'
    case 'system': return 'System identity'
    default: return event.actor_type ? event.actor_type.replace(/_/g, ' ') : 'Unknown credential'
  }
}

export function eventCluster(event: KubernetesAccessEvent): string {
  return event.cluster_name || event.cluster_id || 'Unknown cluster'
}

export function requestedCommand(event: KubernetesAccessEvent): string[] {
  if (event.requested_command?.length) return event.requested_command
  const command = event.request_query?.command
  if (Array.isArray(command)) return command.filter((part): part is string => typeof part === 'string')
  return typeof command === 'string' && command ? [command] : []
}

const singularResources: Record<string, string> = {
  configmaps: 'configmap',
  cronjobs: 'cronjob',
  daemonsets: 'daemonset',
  deployments: 'deployment',
  endpoints: 'endpoint',
  endpointslices: 'endpointslice',
  jobs: 'job',
  namespaces: 'namespace',
  nodes: 'node',
  persistentvolumeclaims: 'persistentvolumeclaim',
  persistentvolumes: 'persistentvolume',
  pods: 'pod',
  replicasets: 'replicaset',
  secrets: 'secret',
  services: 'service',
  statefulsets: 'statefulset',
}

function queryValues(event: KubernetesAccessEvent, key: string): string[] {
  const value = event.request_query?.[key]
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof item))
      .map(String)
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) return [String(value)]
  return []
}

function queryValue(event: KubernetesAccessEvent, key: string): string {
  return queryValues(event, key)[0] || ''
}

function queryEnabled(event: KubernetesAccessEvent, key: string): boolean {
  return ['1', 'true', 'yes'].includes(queryValue(event, key).toLowerCase())
}

function shellArgument(value: string): string {
  if (!value) return "''"
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shellCommand(parts: string[]): string {
  return parts.filter(Boolean).map(shellArgument).join(' ')
}

function namespaceArgs(event: KubernetesAccessEvent): string[] {
  return event.namespace ? ['-n', event.namespace] : []
}

function resourceName(event: KubernetesAccessEvent): string {
  const resource = event.resource || 'resource'
  return event.name ? singularResources[resource] || resource : resource
}

function reconstructedKubectlCommand(event: KubernetesAccessEvent): string {
  const verb = (event.verb || '').toLowerCase()
  const subresource = (event.subresource || '').toLowerCase()
  const pod = event.pod || event.name || ''
  const container = event.container || queryValue(event, 'container')
  const namespace = namespaceArgs(event)

  // Older gateway events parsed `/api/v1/namespaces/{name}` as a namespace
  // scope with no resource. Preserve a useful command for those rows.
  if (!event.resource && event.namespace && !event.name && (verb === 'get' || verb === 'list')) {
    return shellCommand(['kubectl', 'get', 'namespace', event.namespace])
  }
  if (!event.resource) return 'kubectl api-resources'

  if (subresource === 'exec' || verb === 'exec') {
    const parts = ['kubectl', 'exec', ...namespace]
    const stdin = queryEnabled(event, 'stdin')
    const tty = queryEnabled(event, 'tty')
    if (stdin && tty) parts.push('-it')
    else {
      if (stdin) parts.push('-i')
      if (tty) parts.push('-t')
    }
    if (pod) parts.push(pod)
    if (container) parts.push('-c', container)
    const command = requestedCommand(event)
    if (command.length) parts.push('--', ...command)
    return shellCommand(parts)
  }

  if (subresource === 'attach' || verb === 'attach') {
    const parts = ['kubectl', 'attach', ...namespace]
    const stdin = queryEnabled(event, 'stdin')
    const tty = queryEnabled(event, 'tty')
    if (stdin && tty) parts.push('-it')
    else {
      if (stdin) parts.push('-i')
      if (tty) parts.push('-t')
    }
    if (pod) parts.push(pod)
    if (container) parts.push('-c', container)
    return shellCommand(parts)
  }

  if (subresource === 'log' || subresource === 'logs' || verb === 'log' || verb === 'logs') {
    const parts = ['kubectl', 'logs', ...namespace]
    if (pod) parts.push(pod)
    if (container) parts.push('-c', container)
    if (queryEnabled(event, 'follow')) parts.push('--follow')
    if (queryEnabled(event, 'previous')) parts.push('--previous')
    const tail = queryValue(event, 'tailLines')
    const since = queryValue(event, 'sinceSeconds')
    if (tail) parts.push(`--tail=${tail}`)
    if (since) parts.push(`--since=${since}s`)
    if (queryEnabled(event, 'timestamps')) parts.push('--timestamps')
    return shellCommand(parts)
  }

  if (subresource === 'portforward' || verb === 'portforward') {
    const parts = ['kubectl', 'port-forward', ...namespace]
    if (pod) parts.push(`pod/${pod}`)
    parts.push(...queryValues(event, 'ports'))
    return shellCommand(parts)
  }

  const resource = resourceName(event)
  const name = event.name || ''
  const parts = ['kubectl']
  switch (verb) {
    case 'get':
    case 'list':
      parts.push('get', resource)
      break
    case 'watch':
      parts.push('get', resource)
      break
    case 'deletecollection':
      parts.push('delete', resource, '--all')
      break
    case 'update':
      parts.push('replace', resource)
      break
    default:
      parts.push(verb || event.http_method?.toLowerCase() || 'request', resource)
  }
  if (name && verb !== 'deletecollection') parts.push(name)
  parts.push(...namespace)
  if (verb === 'watch') parts.push('--watch')
  return shellCommand(parts)
}

export function kubectlCommand(event: KubernetesAccessEvent): KubectlCommandDisplay {
  const reported = event.client_reported?.argv?.filter((part): part is string => typeof part === 'string' && Boolean(part))
  if (reported?.length) {
    return { command: shellCommand(reported), source: 'reported' }
  }
  return { command: reconstructedKubectlCommand(event), source: 'reconstructed' }
}

export function statusGroup(status?: number): 'success' | 'warning' | 'error' | 'unknown' {
  if (status == null || !Number.isFinite(status)) return 'unknown'
  if (status >= 500) return 'error'
  if (status >= 400) return 'warning'
  return 'success'
}

export function sessionOutput(
  event: KubernetesAccessEvent,
  session?: KubernetesSessionArtifact | null,
): string {
  const artifact = session || event.session
  return artifact?.terminal_output
    || artifact?.output
    || [artifact?.stdout, artifact?.stderr].filter(Boolean).join('\n')
    || event.terminal_output
    || ''
}

export function normalizeAccessListResponse(
  response: KubernetesAccessListResponse | KubernetesAccessEvent[],
): KubernetesAccessListResponse {
  if (Array.isArray(response)) return { events: response, total: response.length }
  return {
    ...response,
    events: Array.isArray(response.events) ? response.events : [],
  }
}

export function normalizeAccessDetailResponse(
  response: KubernetesAccessDetailResponse | KubernetesAccessEvent,
): KubernetesAccessDetailResponse {
  const wrapped = response as KubernetesAccessDetailResponse
  if (wrapped.event && typeof wrapped.event === 'object') return wrapped
  const event = response as KubernetesAccessEvent
  return { event, session: event.session }
}
