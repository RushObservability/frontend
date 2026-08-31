// Static add-on catalog. Each entry yields a left-rail item in the Integrations
// area, its set of pages (rendered via <component :is>), and the license
// entitlement that gates it. Adding an add-on = one entry + its page components.
// (Promote to a backend config_addons table later with no UI rework.)
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'

export interface AddonPage {
  key: string
  label: string
  component: Component
  /** Optional grouping used when an integration has too many views for one tab row. */
  group?: string
}

export interface AddonDef {
  key: string
  label: string
  icon: string // emoji/glyph for the rail
  /** License entitlement required to show this add-on. Omitted/empty for free add-ons. */
  entitlement?: string
  /** Free add-ons need no entitlement — always available, gated only by an enable toggle. */
  free?: boolean
  /** localStorage key backing the enable/disable toggle (free add-ons). */
  enabledKey?: string
  /** Optional: PromQL metric whose `service_name` label enumerates instances. */
  serverDiscoveryMetric?: string
  /** Optional: PromQL metric whose `db` label enumerates databases (per-instance). */
  dbDiscoveryMetric?: string
  /** Shown when entitled but no instance is reporting yet (deploy guide). */
  setupComponent?: Component
  pages: AddonPage[]
}

const pg = (name: string) =>
  defineAsyncComponent(() => import(`../views/integrations/postgres/${name}.vue`))

const mysqlPage = (view: string) => defineAsyncComponent(async () => {
  const page = await import('../views/integrations/mysql/MySqlPage.vue')
  return defineComponent({
    name: `MySql${view[0]?.toUpperCase() || ''}${view.slice(1)}`,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h(page.default, { ...attrs, view })
    },
  })
})

const mysql = (name: string) =>
  defineAsyncComponent(() => import(`../views/integrations/mysql/${name}.vue`))

export const catalog: AddonDef[] = [
  {
    key: 'mysql',
    label: 'MySQL',
    icon: 'DB',
    entitlement: 'mysql',
    serverDiscoveryMetric: 'mysql_collector_up',
    dbDiscoveryMetric: 'mysql_database_size_bytes',
    setupComponent: mysql('MySqlSetupGuide'),
    pages: [
      { key: 'overview', label: 'Overview', component: mysqlPage('overview'), group: 'Core' },
      { key: 'queries', label: 'Queries', component: mysqlPage('queries'), group: 'Workload' },
      { key: 'activity', label: 'Activity', component: mysqlPage('activity'), group: 'Workload' },
      { key: 'waits', label: 'Waits', component: mysqlPage('waits'), group: 'Workload' },
      { key: 'locks', label: 'Locks', component: mysqlPage('locks'), group: 'Workload' },
      { key: 'explain', label: 'Explain', component: mysql('MySqlExplain'), group: 'Workload' },
      { key: 'tables', label: 'Tables', component: mysqlPage('tables'), group: 'Storage' },
      { key: 'indexes', label: 'Indexes', component: mysqlPage('indexes'), group: 'Storage' },
      { key: 'replication', label: 'Replication', component: mysqlPage('replication'), group: 'Operations' },
      { key: 'capacity', label: 'Capacity', component: mysqlPage('capacity'), group: 'Operations' },
      { key: 'advisor', label: 'Advisor', component: mysqlPage('advisor'), group: 'Posture' },
      { key: 'errors', label: 'Error log', component: mysqlPage('errors'), group: 'Operations' },
    ],
  },
  {
    key: 'postgresql',
    label: 'PostgreSQL',
    icon: 'DB',
    entitlement: 'postgres',
    serverDiscoveryMetric: 'postgresql_backends',
    dbDiscoveryMetric: 'postgresql_table_size',
    setupComponent: pg('PgSetupGuide'),
    pages: [
      { key: 'overview', label: 'Overview', component: pg('PgOverview'), group: 'Core' },
      { key: 'checks', label: 'Health', component: pg('PgChecks'), group: 'Core' },
      { key: 'connections', label: 'Connections', component: pg('PgConnections'), group: 'Workload' },
      { key: 'queries', label: 'Queries', component: pg('PgQueries'), group: 'Workload' },
      { key: 'explain', label: 'Explain', component: pg('PgExplain'), group: 'Workload' },
      { key: 'tables', label: 'Tables', component: pg('PgTables'), group: 'Storage' },
      { key: 'indexes', label: 'Indexes', component: pg('PgIndexes'), group: 'Storage' },
      { key: 'vacuum', label: 'Vacuum', component: pg('PgVacuum'), group: 'Storage' },
      { key: 'advisor', label: 'Advisor', component: pg('PgAdvisor'), group: 'Posture' },
      { key: 'locks', label: 'Locks', component: pg('PgLocks'), group: 'Operations' },
      { key: 'replication', label: 'Replication', component: pg('PgReplication'), group: 'Operations' },
      { key: 'logical', label: 'Logical Replication', component: pg('PgLogical'), group: 'Operations' },
      { key: 'security', label: 'Security', component: pg('PgSecurity'), group: 'Posture' },
      { key: 'recovery', label: 'Recovery', component: pg('PgRecovery'), group: 'Operations' },
      { key: 'capacity', label: 'Capacity', component: pg('PgCapacity'), group: 'Operations' },
      { key: 'dashboard', label: 'Dashboard', component: pg('PgDashboard'), group: 'Core' },
    ],
  },
  {
    key: 'argocd',
    label: 'ArgoCD',
    icon: '🚀',
    free: true,
    enabledKey: 'rush-argocd-enabled',
    pages: [
      { key: 'applications', label: 'Applications', component: defineAsyncComponent(() => import('../views/ArgoView.vue')) },
    ],
  },
  {
    key: 'fluxcd',
    label: 'FluxCD',
    icon: '🔁',
    free: true,
    enabledKey: 'rush-fluxcd-enabled',
    pages: [
      { key: 'workloads', label: 'Workloads', component: defineAsyncComponent(() => import('../views/FluxView.vue')) },
      { key: 'sources', label: 'Sources', component: defineAsyncComponent(() => import('../views/FluxView.vue')) },
    ],
  },
  {
    key: 'kubernetes',
    label: 'Kubernetes',
    icon: '☸️',
    free: true,
    enabledKey: 'rush-kubernetes-enabled',
    pages: [
      { key: 'workloads', label: 'Workloads', component: defineAsyncComponent(() => import('../views/KubernetesView.vue')) },
      { key: 'networking', label: 'Networking', component: defineAsyncComponent(() => import('../views/KubernetesView.vue')) },
      { key: 'config', label: 'Config', component: defineAsyncComponent(() => import('../views/KubernetesView.vue')) },
      { key: 'cluster', label: 'Cluster', component: defineAsyncComponent(() => import('../views/KubernetesView.vue')) },
    ],
  },
  {
    key: 'cloudwatch',
    label: 'CloudWatch Logs',
    icon: '☁️',
    free: true,
    enabledKey: 'rush-cloudwatch-enabled',
    pages: [
      { key: 'setup', label: 'Setup', component: defineAsyncComponent(() => import('../views/CloudWatchView.vue')) },
    ],
  },
]

export function getAddon(key: string): AddonDef | undefined {
  return catalog.find((a) => a.key === key)
}

/** Catalog entries available to show: free add-ons plus any the license entitles. */
export function entitledAddons(hasEntitlement: (k: string) => boolean): AddonDef[] {
  return catalog.filter((a) => a.free || (!!a.entitlement && hasEntitlement(a.entitlement)))
}

/**
 * Add-ons visible in the Integrations rail/nav.
 *
 * A **free** add-on (argocd/fluxcd/kubernetes) is the platform's call first: it
 * only appears when the backend reports its feature flag on (`isFeatureEnabled`,
 * driven by the Helm chart / env) AND the user has toggled it on for this browser
 * (`isToggledOn`). A **licensed** add-on appears when the license entitles it.
 */
export function availableAddons(
  hasEntitlement: (k: string) => boolean,
  isFeatureEnabled: (k: string) => boolean,
  isToggledOn: (a: AddonDef) => boolean,
): AddonDef[] {
  return catalog.filter((a) =>
    a.free
      ? isFeatureEnabled(a.key) && isToggledOn(a)
      : !!a.entitlement && hasEntitlement(a.entitlement),
  )
}
