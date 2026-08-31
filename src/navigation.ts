import type { Features } from './composables/useFeatures'

export type NavigationGroupId = 'observe' | 'respond' | 'investigate' | 'control'

export interface NavigationItem {
  id: string
  label: string
  path: string
  icon: string
  group: NavigationGroupId
  routeNames: string[]
  adminOnly?: boolean
  feature?: keyof Features
  enabledByDefault?: boolean
  requiresIntegrations?: boolean
  mobilePrimary?: boolean
  keywords?: string[]
}

export interface NavigationGroup {
  id: NavigationGroupId
  label: string
  items: NavigationItem[]
}

export interface NavigationContext {
  isAdmin: boolean
  features: Partial<Features>
  hasIntegrations: boolean
}

export const NAVIGATION_GROUPS: Array<{ id: NavigationGroupId; label: string }> = [
  { id: 'observe', label: 'Observe' },
  { id: 'respond', label: 'Respond' },
  { id: 'investigate', label: 'Investigate' },
  { id: 'control', label: 'Control' },
]

export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: 'explore', label: 'Explore', path: '/', icon: '⌁', group: 'observe',
    routeNames: ['explore', 'trace', 'logs', 'traces'], mobilePrimary: true,
    keywords: ['search', 'traces', 'logs', 'apm'],
  },
  {
    id: 'services', label: 'Services', path: '/services', icon: '◇', group: 'observe',
    routeNames: ['services', 'service-detail'], mobilePrimary: true,
    keywords: ['catalog', 'service map'],
  },
  {
    id: 'dashboards', label: 'Dashboards', path: '/dashboards', icon: '▦', group: 'observe',
    routeNames: ['dashboards', 'dashboard'], mobilePrimary: true,
    keywords: ['charts', 'graphs'],
  },
  {
    id: 'metrics', label: 'Metrics', path: '/metrics', icon: '≋', group: 'observe',
    routeNames: ['metrics', 'metric-detail'], keywords: ['prometheus', 'timeseries'],
  },
  {
    id: 'rum', label: 'RUM', path: '/rum', icon: '◎', group: 'observe',
    routeNames: ['rum', 'rum-detail'], feature: 'rum', enabledByDefault: true,
    keywords: ['browser', 'sessions', 'frontend'],
  },
  {
    id: 'alerts', label: 'Alerts', path: '/alerts', icon: '!', group: 'respond',
    routeNames: ['alerts', 'monitor-create', 'monitor-detail', 'monitor-edit', 'alert-rule-add', 'alert-rule-edit', 'alert-channel-add'],
    mobilePrimary: true, keywords: ['monitors', 'notifications'],
  },
  {
    id: 'detection', label: 'Detection', path: '/detection', icon: '◆', group: 'respond',
    routeNames: ['detection', 'detection-rule-add', 'detection-rule-edit'], keywords: ['rules'],
  },
  {
    id: 'anomaly', label: 'Anomaly', path: '/anomaly', icon: '∿', group: 'respond',
    routeNames: ['anomaly', 'anomaly-detail', 'anomaly-add'], keywords: ['detection'],
  },
  {
    id: 'slos', label: 'SLOs', path: '/slos', icon: '◉', group: 'respond',
    routeNames: ['slos', 'slo-detail'], keywords: ['reliability', 'objectives'],
  },
  {
    id: 'deploys', label: 'Deploys', path: '/deploys', icon: '↑', group: 'respond',
    routeNames: ['deploys'], keywords: ['changes', 'releases'],
  },
  {
    id: 'sre-agent', label: 'SRE Agent', path: '/sre-agent', icon: '✦', group: 'investigate',
    routeNames: ['sre-agent', 'investigate'], feature: 'sre_agent', keywords: ['ai', 'troubleshoot', 'investigation'],
  },
  {
    id: 'integrations', label: 'Integrations', path: '/integrations', icon: '↔', group: 'control',
    routeNames: ['integrations', 'integration-page'], requiresIntegrations: true,
    keywords: ['postgresql', 'mysql', 'kubernetes', 'argocd'],
  },
  {
    id: 'usage', label: 'Usage', path: '/usage', icon: '◫', group: 'control',
    routeNames: ['usage'], keywords: ['storage', 'ingestion', 'stats'],
  },
  {
    id: 'capacity', label: 'Capacity', path: '/capacity', icon: '△', group: 'control',
    routeNames: ['capacity'], adminOnly: true, keywords: ['cluster', 'resources'],
  },
  {
    id: 'kubernetes-access', label: 'Kubernetes access', path: '/kubernetes-access', icon: '☸', group: 'control',
    routeNames: ['kubernetes-access'], adminOnly: true, keywords: ['kubectl', 'audit', 'sessions'],
  },
  {
    id: 'audit', label: 'Audit', path: '/audit', icon: '✓', group: 'control',
    routeNames: ['audit'], adminOnly: true, keywords: ['events', 'security'],
  },
  {
    id: 'settings', label: 'Settings', path: '/settings', icon: '⚙', group: 'control',
    routeNames: ['settings'], adminOnly: true, keywords: ['configuration', 'users', 'auth'],
  },
]

export function navigationItemVisible(item: NavigationItem, context: NavigationContext): boolean {
  if (item.adminOnly && !context.isAdmin) return false
  if (item.requiresIntegrations && !context.hasIntegrations) return false
  if (item.feature) {
    const value = context.features[item.feature]
    return value === undefined ? item.enabledByDefault === true : Boolean(value)
  }
  return true
}

export function visibleNavigationGroups(context: NavigationContext): NavigationGroup[] {
  return NAVIGATION_GROUPS.map(group => ({
    ...group,
    items: NAVIGATION_ITEMS.filter(item => item.group === group.id && navigationItemVisible(item, context)),
  })).filter(group => group.items.length > 0)
}

export function navigationItemIsActive(item: NavigationItem, routeName: string | null | undefined): boolean {
  return typeof routeName === 'string' && item.routeNames.includes(routeName)
}

