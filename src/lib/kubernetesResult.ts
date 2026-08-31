export interface KubectlResultColumn {
  key: string
  label: string
  align: 'left' | 'right'
}

export interface KubectlResultTable {
  columns: KubectlResultColumn[]
  rows: string[][]
  resourceLabel: string
}

export interface KubectlResultContext {
  resource?: string
  namespace?: string
  now?: number
}

export interface KubectlResultFallback {
  title: string
  detail?: string
  output?: string
  tone: 'neutral' | 'error'
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function capturedBody(value: unknown): unknown {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) return parsed

  for (const key of ['body', 'preview', 'content']) {
    if (parsed[key] !== undefined) return parseJson(parsed[key])
  }
  return parsed
}

function text(value: unknown, fallback = '<none>'): string {
  if (value == null || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function metadata(item: JsonRecord): JsonRecord {
  return record(item.metadata)
}

function spec(item: JsonRecord): JsonRecord {
  return record(item.spec)
}

function status(item: JsonRecord): JsonRecord {
  return record(item.status)
}

function kindFor(body: JsonRecord, items: JsonRecord[], resource?: string): string {
  const firstKind = text(items[0]?.kind, '')
  const bodyKind = text(body.kind, '').replace(/List$/, '')
  const candidate = firstKind || bodyKind || resource || 'resource'
  return candidate.toLowerCase()
}

function pluralLabel(kind: string, count: number): string {
  const noun = kind || 'resource'
  if (count === 1) {
    if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`
    if (noun.endsWith('s') && !noun.endsWith('ss')) return noun.slice(0, -1)
    return noun
  }
  if (noun.endsWith('s')) return noun
  if (noun.endsWith('y')) return `${noun.slice(0, -1)}ies`
  return `${noun}s`
}

export function formatKubernetesAge(timestamp: unknown, now = Date.now()): string {
  if (typeof timestamp !== 'string' || !timestamp) return '<unknown>'
  const created = Date.parse(timestamp)
  if (!Number.isFinite(created)) return '<unknown>'
  const seconds = Math.max(0, Math.floor((now - created) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d`
  return `${Math.floor(days / 365)}y`
}

function tableResponse(body: JsonRecord, resource?: string): KubectlResultTable | null {
  if (body.kind !== 'Table') return null
  const definitions = array(body.columnDefinitions).filter(isRecord)
  const visibleIndexes = definitions
    .map((definition, index) => ({ definition, index }))
    .filter(({ definition }) => number(definition.priority) === 0)

  const columns = visibleIndexes.map(({ definition, index }) => ({
    key: `column-${index}`,
    label: text(definition.name, `Column ${index + 1}`).toUpperCase(),
    align: ['integer', 'number'].includes(text(definition.type, '').toLowerCase())
      ? 'right' as const
      : 'left' as const,
  }))
  const rows = array(body.rows)
    .filter(isRecord)
    .map(row => {
      const cells = array(row.cells)
      return visibleIndexes.map(({ index }) => text(cells[index], ''))
    })

  if (!columns.length) return null
  return {
    columns,
    rows,
    resourceLabel: pluralLabel((resource || 'resource').toLowerCase(), rows.length),
  }
}

function apiResourceTable(body: JsonRecord): KubectlResultTable | null {
  if (body.kind !== 'APIResourceList') return null
  const resources = array(body.resources).filter(isRecord)
  return {
    columns: [
      { key: 'name', label: 'NAME', align: 'left' },
      { key: 'shortnames', label: 'SHORTNAMES', align: 'left' },
      { key: 'api-version', label: 'APIVERSION', align: 'left' },
      { key: 'namespaced', label: 'NAMESPACED', align: 'left' },
      { key: 'kind', label: 'KIND', align: 'left' },
      { key: 'verbs', label: 'VERBS', align: 'left' },
    ],
    rows: resources.map(resource => [
      text(resource.name),
      array(resource.shortNames).map(value => text(value, '')).filter(Boolean).join(',') || '<none>',
      text(body.groupVersion),
      resource.namespaced === true ? 'true' : 'false',
      text(resource.kind),
      array(resource.verbs).map(value => text(value, '')).filter(Boolean).join(',') || '<none>',
    ]),
    resourceLabel: resources.length === 1 ? 'API resource' : 'API resources',
  }
}

function withNamespace(
  columns: KubectlResultColumn[],
  rows: string[][],
  items: JsonRecord[],
  context: KubectlResultContext,
): KubectlResultTable {
  const namespaces = items.map(item => text(metadata(item).namespace, '')).filter(Boolean)
  const showNamespace = !context.namespace && namespaces.length > 0
  if (!showNamespace) return { columns, rows, resourceLabel: '' }
  return {
    columns: [{ key: 'namespace', label: 'NAMESPACE', align: 'left' }, ...columns],
    rows: rows.map((row, index) => [text(metadata(items[index] || {}).namespace, '<none>'), ...row]),
    resourceLabel: '',
  }
}

function podStatus(item: JsonRecord): string {
  const itemMetadata = metadata(item)
  const itemStatus = status(item)
  if (itemMetadata.deletionTimestamp) return 'Terminating'
  const containerStatuses = array(itemStatus.containerStatuses).filter(isRecord)
  for (const container of containerStatuses) {
    const state = record(container.state)
    const waiting = record(state.waiting)
    const terminated = record(state.terminated)
    if (waiting.reason) return text(waiting.reason)
    if (terminated.reason && itemStatus.phase !== 'Succeeded') return text(terminated.reason)
  }
  return text(itemStatus.phase, 'Unknown')
}

function podTable(items: JsonRecord[], context: KubectlResultContext): KubectlResultTable {
  const columns: KubectlResultColumn[] = [
    { key: 'name', label: 'NAME', align: 'left' },
    { key: 'ready', label: 'READY', align: 'right' },
    { key: 'status', label: 'STATUS', align: 'left' },
    { key: 'restarts', label: 'RESTARTS', align: 'right' },
    { key: 'age', label: 'AGE', align: 'right' },
  ]
  const rows = items.map(item => {
    const itemSpec = spec(item)
    const itemStatus = status(item)
    const containerStatuses = array(itemStatus.containerStatuses).filter(isRecord)
    const total = array(itemSpec.containers).length || containerStatuses.length
    const ready = containerStatuses.filter(container => container.ready === true).length
    const restarts = containerStatuses.reduce((sum, container) => sum + number(container.restartCount), 0)
    return [
      text(metadata(item).name),
      `${ready}/${total}`,
      podStatus(item),
      String(restarts),
      formatKubernetesAge(metadata(item).creationTimestamp, context.now),
    ]
  })
  const table = withNamespace(columns, rows, items, context)
  return { ...table, resourceLabel: pluralLabel('pod', items.length) }
}

function serviceTable(items: JsonRecord[], context: KubectlResultContext): KubectlResultTable {
  const columns: KubectlResultColumn[] = [
    { key: 'name', label: 'NAME', align: 'left' },
    { key: 'type', label: 'TYPE', align: 'left' },
    { key: 'cluster-ip', label: 'CLUSTER-IP', align: 'left' },
    { key: 'external-ip', label: 'EXTERNAL-IP', align: 'left' },
    { key: 'ports', label: 'PORT(S)', align: 'left' },
    { key: 'age', label: 'AGE', align: 'right' },
  ]
  const rows = items.map(item => {
    const itemSpec = spec(item)
    const itemStatus = status(item)
    const loadBalancer = record(itemStatus.loadBalancer)
    const ingress = array(loadBalancer.ingress).filter(isRecord)
    const external = ingress.map(value => text(value.ip || value.hostname, '')).filter(Boolean)
    if (!external.length) external.push(...array(itemSpec.externalIPs).map(value => text(value, '')).filter(Boolean))
    const ports = array(itemSpec.ports).filter(isRecord).map(port => {
      const servicePort = text(port.port, '')
      const nodePort = text(port.nodePort, '')
      const protocol = text(port.protocol, 'TCP')
      return `${servicePort}${nodePort ? `:${nodePort}` : ''}/${protocol}`
    })
    return [
      text(metadata(item).name),
      text(itemSpec.type, 'ClusterIP'),
      text(itemSpec.clusterIP),
      external.length ? external.join(',') : '<none>',
      ports.length ? ports.join(',') : '<none>',
      formatKubernetesAge(metadata(item).creationTimestamp, context.now),
    ]
  })
  const table = withNamespace(columns, rows, items, context)
  return { ...table, resourceLabel: pluralLabel('service', items.length) }
}

function deploymentTable(items: JsonRecord[], context: KubectlResultContext): KubectlResultTable {
  const columns: KubectlResultColumn[] = [
    { key: 'name', label: 'NAME', align: 'left' },
    { key: 'ready', label: 'READY', align: 'right' },
    { key: 'up-to-date', label: 'UP-TO-DATE', align: 'right' },
    { key: 'available', label: 'AVAILABLE', align: 'right' },
    { key: 'age', label: 'AGE', align: 'right' },
  ]
  const rows = items.map(item => {
    const desired = number(spec(item).replicas, 1)
    const itemStatus = status(item)
    return [
      text(metadata(item).name),
      `${number(itemStatus.readyReplicas)}/${desired}`,
      String(number(itemStatus.updatedReplicas)),
      String(number(itemStatus.availableReplicas)),
      formatKubernetesAge(metadata(item).creationTimestamp, context.now),
    ]
  })
  const table = withNamespace(columns, rows, items, context)
  return { ...table, resourceLabel: pluralLabel('deployment', items.length) }
}

function namespaceTable(items: JsonRecord[], context: KubectlResultContext): KubectlResultTable {
  return {
    columns: [
      { key: 'name', label: 'NAME', align: 'left' },
      { key: 'status', label: 'STATUS', align: 'left' },
      { key: 'age', label: 'AGE', align: 'right' },
    ],
    rows: items.map(item => [
      text(metadata(item).name),
      text(status(item).phase, 'Unknown'),
      formatKubernetesAge(metadata(item).creationTimestamp, context.now),
    ]),
    resourceLabel: pluralLabel('namespace', items.length),
  }
}

function nodeTable(items: JsonRecord[], context: KubectlResultContext): KubectlResultTable {
  return {
    columns: [
      { key: 'name', label: 'NAME', align: 'left' },
      { key: 'status', label: 'STATUS', align: 'left' },
      { key: 'roles', label: 'ROLES', align: 'left' },
      { key: 'age', label: 'AGE', align: 'right' },
      { key: 'version', label: 'VERSION', align: 'left' },
    ],
    rows: items.map(item => {
      const itemMetadata = metadata(item)
      const itemStatus = status(item)
      const ready = array(itemStatus.conditions).filter(isRecord)
        .find(condition => condition.type === 'Ready')
      const labels = record(itemMetadata.labels)
      const roles = Object.keys(labels)
        .filter(label => label.startsWith('node-role.kubernetes.io/'))
        .map(label => label.slice('node-role.kubernetes.io/'.length))
        .filter(Boolean)
      return [
        text(itemMetadata.name),
        ready?.status === 'True' ? 'Ready' : 'NotReady',
        roles.length ? roles.join(',') : '<none>',
        formatKubernetesAge(itemMetadata.creationTimestamp, context.now),
        text(record(itemStatus.nodeInfo).kubeletVersion),
      ]
    }),
    resourceLabel: pluralLabel('node', items.length),
  }
}

function genericTable(items: JsonRecord[], kind: string, context: KubectlResultContext): KubectlResultTable {
  const hasStatus = items.some(item => Boolean(status(item).phase || status(item).state))
  const columns: KubectlResultColumn[] = [
    { key: 'name', label: 'NAME', align: 'left' },
    ...(hasStatus ? [{ key: 'status', label: 'STATUS', align: 'left' } as KubectlResultColumn] : []),
    { key: 'age', label: 'AGE', align: 'right' },
  ]
  const rows = items.map(item => {
    const itemStatus = status(item)
    return [
      text(metadata(item).name),
      ...(hasStatus ? [text(itemStatus.phase || itemStatus.state, 'Unknown')] : []),
      formatKubernetesAge(metadata(item).creationTimestamp, context.now),
    ]
  })
  const table = withNamespace(columns, rows, items, context)
  return { ...table, resourceLabel: pluralLabel(kind, items.length) }
}

export function formatKubectlResult(value: unknown, context: KubectlResultContext = {}): KubectlResultTable | null {
  const parsed = capturedBody(value)
  if (!isRecord(parsed)) return null

  const nativeTable = tableResponse(parsed, context.resource)
  if (nativeTable) return nativeTable

  const discoveryTable = apiResourceTable(parsed)
  if (discoveryTable) return discoveryTable

  const listedItems = array(parsed.items).filter(isRecord)
  const items = listedItems.length || Array.isArray(parsed.items)
    ? listedItems
    : metadata(parsed).name
      ? [parsed]
      : []
  const hasKubernetesShape = Array.isArray(parsed.items) || metadata(parsed).name
  if (!hasKubernetesShape) return null

  const kind = kindFor(parsed, items, context.resource)
  switch (kind) {
    case 'pod':
    case 'pods': return podTable(items, context)
    case 'service':
    case 'services': return serviceTable(items, context)
    case 'deployment':
    case 'deployments': return deploymentTable(items, context)
    case 'namespace':
    case 'namespaces': return namespaceTable(items, context)
    case 'node':
    case 'nodes': return nodeTable(items, context)
    default: return genericTable(items, kind, context)
  }
}

export function formatKubectlFallback(value: unknown): KubectlResultFallback {
  const parsed = capturedBody(value)

  if (parsed == null || parsed === '') {
    return {
      title: 'No result body was stored.',
      detail: 'Rush did not capture response content for this request.',
      tone: 'neutral',
    }
  }

  if (typeof parsed === 'string') {
    return {
      title: 'Command output',
      output: parsed,
      tone: 'neutral',
    }
  }

  if (isRecord(parsed) && parsed.kind === 'Status') {
    const reason = text(parsed.reason, '')
    const message = text(parsed.message, 'The Kubernetes API rejected the request.')
    const failed = parsed.status === 'Failure' || number(parsed.code) >= 400
    return {
      title: failed ? 'Kubernetes API error' : 'Kubernetes API status',
      output: failed
        ? `Error from server${reason ? ` (${reason})` : ''}: ${message}`
        : message,
      tone: failed ? 'error' : 'neutral',
    }
  }

  if (isRecord(parsed)) {
    const omittedReason = text(parsed.body_omitted_reason || parsed.reason, '')
    if (omittedReason) {
      const detail = omittedReason === 'non_json'
        ? 'The response was not JSON, so Rush did not store a resource table.'
        : omittedReason === 'streaming_response'
          ? 'Streaming command output is available in the Session tab.'
          : `Capture reason: ${omittedReason.replace(/_/g, ' ')}.`
      return {
        title: 'Result body was not stored.',
        detail,
        tone: 'neutral',
      }
    }
  }

  return {
    title: 'No kubectl-style table is available.',
    detail: 'Use JSON to inspect the captured response.',
    tone: 'neutral',
  }
}
