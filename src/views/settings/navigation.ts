export type SettingsTabId = 'keys' | 'auth' | 'links' | 'integrations' | 'agent' | 'tenants' | 'retention' | 'groups' | 'users' | 'alerting' | 'general' | 'performance' | 'firewall' | 'license' | 'config'
export type AgentSubtabId = 'access' | 'models' | 'limits' | 'skills'

export interface SettingsTabDef {
  id: SettingsTabId
  label: string
  hint: string
  group: string
}

export interface SettingsTabGroup {
  name: string
  items: SettingsTabDef[]
}

export interface SettingsIntegrationNavItem {
  key: string
  label: string
  desc: string
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'general', label: 'General', group: 'Workspace', hint: 'Workspace-wide preferences and defaults.' },
  { id: 'performance', label: 'Query limits', group: 'Workspace', hint: 'Protect interactive work with admission, time-range, and ClickHouse resource budgets.' },
  { id: 'config', label: 'Configuration', group: 'Workspace', hint: 'Runtime wiring, loaded integrations, and redacted secrets.' },
  { id: 'license', label: 'License', group: 'Workspace', hint: 'Review license status and entitled add-ons.' },
  { id: 'integrations', label: 'Integrations', group: 'Workspace', hint: 'Connect external tools and observability add-ons.' },
  { id: 'agent', label: 'AI Agent', group: 'Workspace', hint: 'Configure investigation access, models, budgets, and playbooks.' },
  { id: 'users', label: 'Users', group: 'Access & Identity', hint: 'Manage local user accounts and access.' },
  { id: 'groups', label: 'Groups', group: 'Access & Identity', hint: 'Bundle scopes, permissions, and tenant access.' },
  { id: 'auth', label: 'Authentication', group: 'Access & Identity', hint: 'Configure local accounts and single sign-on.' },
  { id: 'keys', label: 'API Keys', group: 'Access & Identity', hint: 'Manage tokens for programmatic API access.' },
  { id: 'tenants', label: 'Tenants', group: 'Data & Routing', hint: 'Manage data isolation for teams and customers.' },
  { id: 'retention', label: 'Retention', group: 'Data & Routing', hint: 'Set data retention limits for each signal.' },
  { id: 'links', label: 'Service Links', group: 'Data & Routing', hint: 'Connect services to source repositories.' },
  { id: 'alerting', label: 'Alerting', group: 'Data & Routing', hint: 'Configure alert delivery channels.' },
  { id: 'firewall', label: 'Metric Firewall', group: 'Data & Routing', hint: 'Block metric series or remove labels during ingest.' },
]

const SETTINGS_GROUP_ORDER = ['Workspace', 'Access & Identity', 'Data & Routing']

export const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = SETTINGS_GROUP_ORDER.map(name => ({
  name,
  items: SETTINGS_TABS.filter(tab => tab.group === name),
}))

export const SETTINGS_INTEGRATIONS: SettingsIntegrationNavItem[] = [
  { key: 'postgresql', label: 'PostgreSQL', desc: 'Database health, query workload, schema, and maintenance.' },
  { key: 'mysql', label: 'MySQL', desc: 'Query workload, waits, blocking, indexes, replication, and settings.' },
  { key: 'argocd', label: 'ArgoCD', desc: 'Application health and sync status from ArgoCD.' },
  { key: 'fluxcd', label: 'FluxCD', desc: 'Flux v2 Kustomizations, HelmReleases, and Sources.' },
  { key: 'kubernetes', label: 'Kubernetes', desc: 'Read-only browser for cluster workloads and resources.' },
  { key: 'kubernetes-logging', label: 'Kubernetes logging', desc: 'Record kubectl activity and manage authenticated clients.' },
  { key: 'cloudwatch', label: 'CloudWatch Logs', desc: 'Ingest AWS CloudWatch Logs through Kinesis Data Firehose.' },
]

