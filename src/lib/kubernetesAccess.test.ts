import { describe, expect, it } from 'vitest'
import type { KubernetesAccessEvent } from '../types'
import {
  evidenceForSource,
  eventActor,
  actorTypeLabel,
  formatAccessTarget,
  kubectlCommand,
  normalizeAccessDetailResponse,
  normalizeAccessListResponse,
  recordingLabel,
  requestedCommand,
  sessionOutput,
  statusGroup,
} from './kubernetesAccess'

const event: KubernetesAccessEvent = {
  id: 'event-1',
  source_kind: 'gateway',
  verb: 'create',
  resource: 'pods',
  subresource: 'exec',
  namespace: 'payments',
  name: 'api-7f8c',
  kube_username: 'mike@example.com',
  recording_state: 'partial',
  created_at: '2026-08-21T12:00:00Z',
}

describe('Kubernetes access presentation', () => {
  it('keeps evidence sources distinct', () => {
    expect(evidenceForSource('gateway')).toBe('gateway')
    expect(evidenceForSource('kubernetes_audit_webhook')).toBe('kubernetes_audit')
    expect(evidenceForSource('kubernetes_audit')).toBe('kubernetes_audit')
    expect(evidenceForSource('rush_cli')).toBe('rush_cli')
  })

  it('formats request identity without inventing missing details', () => {
    expect(formatAccessTarget(event)).toBe('pods/exec/api-7f8c')
    expect(eventActor(event)).toBe('mike@example.com')
    expect(recordingLabel(event.recording_state)).toBe('Partial')
    expect(actorTypeLabel({ ...event, actor_type: 'api_key' })).toBe('API key')
    expect(actorTypeLabel(event)).toBe('Unknown credential')
    expect(requestedCommand({ ...event, request_query: { command: ['sh', '-lc', 'uptime'] } })).toEqual(['sh', '-lc', 'uptime'])
  })

  it('reconstructs an interactive kubectl exec command', () => {
    expect(kubectlCommand({
      ...event,
      verb: 'exec',
      request_query: {
        command: ['sh', '-lc', 'echo ready'],
        container: ['api'],
        stdin: ['true'],
        tty: ['true'],
      },
    })).toEqual({
      command: "kubectl exec -n payments -it api-7f8c -c api -- sh -lc 'echo ready'",
      source: 'reconstructed',
    })
  })

  it('reconstructs common get, watch, logs, and port-forward commands', () => {
    expect(kubectlCommand({ ...event, verb: 'get', subresource: '', request_query: {} }).command)
      .toBe('kubectl get pod api-7f8c -n payments')
    expect(kubectlCommand({ ...event, verb: 'watch', subresource: '', name: '', request_query: {} }).command)
      .toBe('kubectl get pods -n payments --watch')
    expect(kubectlCommand({
      ...event,
      verb: 'log',
      subresource: 'log',
      request_query: { container: 'api', follow: 'true', tailLines: '50' },
    }).command).toBe('kubectl logs -n payments api-7f8c -c api --follow --tail=50')
    expect(kubectlCommand({
      ...event,
      verb: 'portforward',
      subresource: 'portforward',
      request_query: { ports: ['8080', '9090'] },
    }).command).toBe('kubectl port-forward -n payments pod/api-7f8c 8080 9090')
    expect(kubectlCommand({
      ...event,
      verb: 'list',
      resource: '',
      subresource: '',
      name: '',
      namespace: 'payments',
    }).command).toBe('kubectl get namespace payments')
    expect(kubectlCommand({
      ...event,
      verb: 'list',
      resource: '',
      subresource: '',
      name: '',
      namespace: '',
    }).command).toBe('kubectl api-resources')
  })

  it('prefers a client-reported argv and quotes unsafe shell arguments', () => {
    expect(kubectlCommand({
      ...event,
      client_reported: { argv: ['kubectl', 'get', 'pod', 'api server'] },
    })).toEqual({
      command: "kubectl get pod 'api server'",
      source: 'reported',
    })
  })

  it('groups status codes for table badges', () => {
    expect(statusGroup(200)).toBe('success')
    expect(statusGroup(403)).toBe('warning')
    expect(statusGroup(503)).toBe('error')
    expect(statusGroup()).toBe('unknown')
  })

  it('accepts wrapped and bare API responses', () => {
    expect(normalizeAccessListResponse([event])).toEqual({ events: [event], total: 1 })
    expect(normalizeAccessDetailResponse(event)).toEqual({ event, session: undefined })
    expect(normalizeAccessDetailResponse({ event, session: { output: 'ok' } }).session?.output).toBe('ok')
  })

  it('joins separate terminal streams when no combined output exists', () => {
    expect(sessionOutput(event, { stdout: 'pod ready', stderr: 'warning' })).toBe('pod ready\nwarning')
  })
})
