// Static add-on catalog. Each entry yields a left-rail item in the Integrations
// area, its set of pages (rendered via <component :is>), and the license
// entitlement that gates it. Adding an add-on = one entry + its page components.
// (Promote to a backend config_addons table later with no UI rework.)
import { defineAsyncComponent, type Component } from 'vue'

export interface AddonPage {
  key: string
  label: string
  component: Component
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

export const catalog: AddonDef[] = [
  {
    key: 'postgresql',
    label: 'PostgreSQL',
    icon: 'DB',
    entitlement: 'postgres',
    serverDiscoveryMetric: 'postgresql_backends',
    dbDiscoveryMetric: 'postgresql_table_size',
    setupComponent: pg('PgSetupGuide'),
    pages: [
      { key: 'overview', label: 'Overview', component: pg('PgOverview') },
      { key: 'checks', label: 'Health', component: pg('PgChecks') },
      { key: 'connections', label: 'Connections', component: pg('PgConnections') },
      { key: 'queries', label: 'Queries', component: pg('PgQueries') },
      { key: 'explain', label: 'Explain', component: pg('PgExplain') },
      { key: 'tables', label: 'Tables', component: pg('PgTables') },
      { key: 'indexes', label: 'Indexes', component: pg('PgIndexes') },
      { key: 'vacuum', label: 'Vacuum', component: pg('PgVacuum') },
      { key: 'dashboard', label: 'Dashboard', component: pg('PgDashboard') },
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
