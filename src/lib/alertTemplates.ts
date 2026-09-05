import type { MonitorComparator } from '../types'

export type MonitorType = 'metric' | 'log' | 'apm' | 'composite'
export type AlertTemplateGroup = 'apm' | 'logs' | 'infrastructure'

interface AlertTemplateBase {
  id: string
  name: string
  description: string
  group: AlertTemplateGroup
  monitorName: string
  message: string
  evalWindow: number
  comparator: MonitorComparator
  criticalThreshold: number
  warningThreshold: number | null
  criticalRecovery: number | null
  warningRecovery: number | null
  priority: number | null
}

export type AlertTemplate = AlertTemplateBase & (
  | {
      monitorType: 'apm'
      query: {
        service?: string
        metric: string
        endpointFilter?: string
        groupBy?: string[]
      }
    }
  | {
      monitorType: 'log'
      query: {
        search?: string
        service?: string
        severities?: string[]
        filters?: Array<{ field: string; op: '=' | '!=' | 'LIKE'; value: string }>
        groupBy?: string[]
      }
    }
  | {
      monitorType: 'metric'
      query: {
        metricName: string
        aggregation: 'avg' | 'sum' | 'max' | 'min' | 'count' | 'rate'
        filters?: Array<{ key: string; value: string }>
        groupBy?: string[]
      }
    }
)

export const ALERT_TEMPLATE_GROUPS: ReadonlyArray<{
  id: AlertTemplateGroup
  label: string
  description: string
}> = [
  { id: 'apm', label: 'APM', description: 'Latency, errors, and traffic' },
  { id: 'logs', label: 'Logs', description: 'Volume and suspicious patterns' },
  { id: 'infrastructure', label: 'Infrastructure', description: 'Host resource pressure' },
]

export const ALERT_TEMPLATES: readonly AlertTemplate[] = [
  {
    id: 'error-rate-spike',
    name: 'Error rate spike',
    description: 'More than 5% of requests are failing.',
    group: 'apm',
    monitorType: 'apm',
    monitorName: 'Error rate spike',
    message: '{{service}} {{endpoint}} error rate is {{value}}%, above {{threshold}}%.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 5,
    warningThreshold: 2,
    criticalRecovery: 3,
    warningRecovery: null,
    priority: 2,
    query: { service: '*', metric: 'error_rate', endpointFilter: '*', groupBy: ['service_name', 'endpoint'] },
  },
  {
    id: 'p95-latency',
    name: 'High p95 latency',
    description: '95% of requests should finish within 500 ms.',
    group: 'apm',
    monitorType: 'apm',
    monitorName: 'High p95 latency',
    message: '{{service}} {{endpoint}} P95 latency is {{value}} ms, above {{threshold}} ms.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 500,
    warningThreshold: 300,
    criticalRecovery: 450,
    warningRecovery: null,
    priority: 2,
    query: { service: '*', metric: 'p95_latency', endpointFilter: '*', groupBy: ['service_name', 'endpoint'] },
  },
  {
    id: 'p99-latency-regression',
    name: 'P99 latency regression',
    description: 'The slowest 1% of requests exceed 500 ms.',
    group: 'apm',
    monitorType: 'apm',
    monitorName: 'P99 latency regression',
    message: '{{service}} {{endpoint}} P99 latency is {{value}} ms, above {{threshold}} ms.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 500,
    warningThreshold: 350,
    criticalRecovery: 450,
    warningRecovery: null,
    priority: 2,
    query: { service: '*', metric: 'p99_latency', endpointFilter: '*', groupBy: ['service_name', 'endpoint'] },
  },
  {
    id: 'request-rate-drop',
    name: 'Request rate drop',
    description: 'Traffic falls below one request per second.',
    group: 'apm',
    monitorType: 'apm',
    monitorName: 'Request rate drop',
    message: '{{service}} {{endpoint}} request rate is {{value}} req/s, below {{threshold}} req/s.',
    evalWindow: 300,
    comparator: 'below',
    criticalThreshold: 1,
    warningThreshold: 5,
    criticalRecovery: 2,
    warningRecovery: null,
    priority: 2,
    query: { service: '*', metric: 'request_rate', endpointFilter: '*', groupBy: ['service_name', 'endpoint'] },
  },
  {
    id: 'failed-login-brute-force',
    name: 'Failed login brute force',
    description: 'More than 10 failed logins from one source IP in five minutes.',
    group: 'logs',
    monitorType: 'log',
    monitorName: 'Failed login brute force',
    message: 'Repeated login failures were recorded from one source IP.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 10,
    warningThreshold: 5,
    criticalRecovery: 7,
    warningRecovery: null,
    priority: 1,
    query: {
      filters: [{ field: 'mat_action', op: '=', value: 'login_failed' }],
      groupBy: ['mat_source_ip'],
    },
  },
  {
    id: 'high-severity-log-volume',
    name: 'High severity log volume',
    description: 'More than 100 error or fatal logs in five minutes.',
    group: 'logs',
    monitorType: 'log',
    monitorName: 'High severity log volume',
    message: 'Error and fatal log volume is above the expected limit.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 100,
    warningThreshold: 50,
    criticalRecovery: 80,
    warningRecovery: null,
    priority: 3,
    query: {
      severities: ['ERROR', 'FATAL'],
      groupBy: ['ServiceName', 'SeverityText'],
    },
  },
  {
    id: 'trace-linked-errors',
    name: 'Trace-linked log errors',
    description: 'Error logs carrying trace context occur repeatedly.',
    group: 'logs',
    monitorType: 'log',
    monitorName: 'Trace-linked log errors',
    message: 'Repeated error logs with trace IDs were recorded.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 5,
    warningThreshold: 3,
    criticalRecovery: 4,
    warningRecovery: null,
    priority: 2,
    query: {
      severities: ['ERROR', 'FATAL'],
      filters: [{ field: 'TraceId', op: '!=', value: '' }],
      groupBy: ['ServiceName'],
    },
  },
  {
    id: 'repeated-error-pattern',
    name: 'Repeated error message',
    description: 'The same error message appears more than three times.',
    group: 'logs',
    monitorType: 'log',
    monitorName: 'Repeated error message',
    message: 'An error message repeated several times in the current window.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 3,
    warningThreshold: null,
    criticalRecovery: 2,
    warningRecovery: null,
    priority: 3,
    query: {
      severities: ['ERROR', 'FATAL'],
      groupBy: ['ServiceName', 'Body'],
    },
  },
  {
    id: 'cpu-saturation',
    name: 'CPU saturation',
    description: 'Average host CPU utilization exceeds 90%.',
    group: 'infrastructure',
    monitorType: 'metric',
    monitorName: 'CPU saturation',
    message: 'Host CPU utilization is above 90%.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 0.9,
    warningThreshold: 0.8,
    criticalRecovery: 0.85,
    warningRecovery: null,
    priority: 2,
    query: {
      metricName: 'system.cpu.utilization',
      aggregation: 'avg',
      groupBy: ['host.name'],
    },
  },
  {
    id: 'memory-pressure',
    name: 'Memory pressure',
    description: 'Average host memory utilization exceeds 90%.',
    group: 'infrastructure',
    monitorType: 'metric',
    monitorName: 'Memory pressure',
    message: 'Host memory utilization is above 90%.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 0.9,
    warningThreshold: 0.8,
    criticalRecovery: 0.85,
    warningRecovery: null,
    priority: 2,
    query: {
      metricName: 'system.memory.utilization',
      aggregation: 'avg',
      groupBy: ['host.name'],
    },
  },
  {
    id: 'disk-capacity',
    name: 'Disk nearly full',
    description: 'Filesystem utilization exceeds 90%.',
    group: 'infrastructure',
    monitorType: 'metric',
    monitorName: 'Disk nearly full',
    message: 'Filesystem utilization is above 90%.',
    evalWindow: 300,
    comparator: 'above',
    criticalThreshold: 0.9,
    warningThreshold: 0.8,
    criticalRecovery: 0.85,
    warningRecovery: null,
    priority: 2,
    query: {
      metricName: 'system.filesystem.utilization',
      aggregation: 'max',
      groupBy: ['host.name', 'mountpoint'],
    },
  },
  {
    id: 'host-unavailable',
    name: 'Host unavailable',
    description: 'The Prometheus up metric falls below one.',
    group: 'infrastructure',
    monitorType: 'metric',
    monitorName: 'Host unavailable',
    message: 'A monitored target is not responding to scrapes.',
    evalWindow: 300,
    comparator: 'below',
    criticalThreshold: 1,
    warningThreshold: null,
    criticalRecovery: 1,
    warningRecovery: null,
    priority: 1,
    query: {
      metricName: 'up',
      aggregation: 'min',
      groupBy: ['instance'],
    },
  },
]
