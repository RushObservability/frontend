import { describe, expect, it } from 'vitest'
import { formatKubectlFallback, formatKubectlResult, formatKubernetesAge } from './kubernetesResult'

const now = Date.parse('2026-08-23T12:00:00Z')

describe('kubectl result formatting', () => {
  it('uses Kubernetes Table responses and hides wide-only columns', () => {
    const result = formatKubectlResult({
      kind: 'Table',
      columnDefinitions: [
        { name: 'Name', type: 'string', priority: 0 },
        { name: 'Ready', type: 'string', priority: 0 },
        { name: 'Images', type: 'string', priority: 1 },
      ],
      rows: [
        { cells: ['api-7f8c', '1/1', 'registry.example/api:1.2.3'] },
      ],
    }, { resource: 'pods' })

    expect(result?.columns.map(column => column.label)).toEqual(['NAME', 'READY'])
    expect(result?.rows).toEqual([['api-7f8c', '1/1']])
    expect(result?.resourceLabel).toBe('pod')
  })

  it('unwraps a stored response envelope before formatting its table', () => {
    const result = formatKubectlResult({
      capture: 'stored',
      body: {
        kind: 'Table',
        columnDefinitions: [{ name: 'Name', type: 'string', priority: 0 }],
        rows: [{ cells: ['grafana'] }],
      },
    }, { resource: 'services' })

    expect(result?.columns.map(column => column.label)).toEqual(['NAME'])
    expect(result?.rows).toEqual([['grafana']])
  })

  it('formats a PodList like kubectl get pods', () => {
    const result = formatKubectlResult({
      kind: 'PodList',
      items: [{
        metadata: { name: 'api-7f8c', namespace: 'payments', creationTimestamp: '2026-08-23T10:00:00Z' },
        spec: { containers: [{ name: 'api' }] },
        status: {
          phase: 'Running',
          containerStatuses: [{ name: 'api', ready: true, restartCount: 2 }],
        },
      }],
    }, { namespace: 'payments', now })

    expect(result?.columns.map(column => column.label)).toEqual(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'])
    expect(result?.rows[0]).toEqual(['api-7f8c', '1/1', 'Running', '2', '2h'])
  })

  it('adds namespace and service columns for an all-namespaces result', () => {
    const result = formatKubectlResult({
      kind: 'ServiceList',
      items: [{
        metadata: { name: 'grafana', namespace: 'monitoring', creationTimestamp: '2026-08-22T12:00:00Z' },
        spec: {
          type: 'NodePort',
          clusterIP: '10.96.1.20',
          ports: [{ port: 3000, nodePort: 30300, protocol: 'TCP' }],
        },
      }],
    }, { now })

    expect(result?.columns.map(column => column.label)).toEqual([
      'NAMESPACE', 'NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE',
    ])
    expect(result?.rows[0]).toEqual([
      'monitoring', 'grafana', 'NodePort', '10.96.1.20', '<none>', '3000:30300/TCP', '1d',
    ])
  })

  it('falls back to name, namespace, status, and age for CRDs', () => {
    const result = formatKubectlResult({
      kind: 'WidgetList',
      items: [{
        kind: 'Widget',
        metadata: { name: 'primary', namespace: 'tools', creationTimestamp: '2026-08-23T11:55:00Z' },
        status: { phase: 'Ready' },
      }],
    }, { now })

    expect(result?.columns.map(column => column.label)).toEqual(['NAMESPACE', 'NAME', 'STATUS', 'AGE'])
    expect(result?.rows[0]).toEqual(['tools', 'primary', 'Ready', '5m'])
  })

  it('returns no table for non-resource metadata envelopes', () => {
    expect(formatKubectlResult({ capture: 'omitted', reason: 'streaming_response' })).toBeNull()
    expect(formatKubectlResult('plain terminal output')).toBeNull()
  })

  it('formats Kubernetes discovery responses without exposing JSON', () => {
    const result = formatKubectlResult({
      kind: 'APIResourceList',
      groupVersion: 'apps/v1',
      resources: [{
        name: 'deployments',
        shortNames: ['deploy'],
        namespaced: true,
        kind: 'Deployment',
        verbs: ['get', 'list'],
      }],
    })

    expect(result?.columns.map(column => column.label)).toEqual([
      'NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND', 'VERBS',
    ])
    expect(result?.rows[0]).toEqual([
      'deployments', 'deploy', 'apps/v1', 'true', 'Deployment', 'get,list',
    ])
  })

  it('renders Kubernetes Status failures like kubectl errors', () => {
    const fallback = formatKubectlFallback({
      kind: 'Status',
      status: 'Failure',
      reason: 'Forbidden',
      code: 403,
      message: 'services "grafana" is forbidden',
    })

    expect(fallback.tone).toBe('error')
    expect(fallback.output).toBe('Error from server (Forbidden): services "grafana" is forbidden')
  })

  it('explains omitted captures instead of dumping their JSON envelope', () => {
    const fallback = formatKubectlFallback({
      capture: 'omitted',
      body_omitted_reason: 'non_json',
      byte_count: 120,
    })

    expect(fallback.output).toBeUndefined()
    expect(fallback.title).toBe('Result body was not stored.')
    expect(fallback.detail).toContain('not JSON')
  })

  it('uses compact Kubernetes-style ages', () => {
    expect(formatKubernetesAge('2026-08-23T11:59:42Z', now)).toBe('18s')
    expect(formatKubernetesAge('2026-08-23T10:30:00Z', now)).toBe('1h')
    expect(formatKubernetesAge('2025-08-20T12:00:00Z', now)).toBe('1y')
    expect(formatKubernetesAge('invalid', now)).toBe('<unknown>')
  })
})
