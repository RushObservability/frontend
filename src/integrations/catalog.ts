// The open-source catalog contains only integrations whose source ships here.
// Licensed builds overlay src/edition/manifest.ts and append private modules.
import { defineAsyncComponent } from 'vue'
import { frontendEdition } from '../edition/manifest'
import type { AddonDef } from './types'

export type { AddonDef, AddonPage } from './types'

export const catalog: AddonDef[] = [
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
    icon: 'K8S',
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
  ...frontendEdition.addons,
]

export function getAddon(key: string): AddonDef | undefined {
  return catalog.find((a) => a.key === key)
}

export function hasAddonEntitlement(
  hasEntitlement: (k: string) => boolean,
  entitlement: string,
): boolean {
  return hasEntitlement(entitlement) || (
    import.meta.env.DEV &&
    !!frontendEdition.developmentEntitlements?.includes(entitlement)
  )
}

/** Catalog entries available to show: free add-ons plus any the license entitles. */
export function entitledAddons(hasEntitlement: (k: string) => boolean): AddonDef[] {
  return catalog.filter((a) => a.free || (!!a.entitlement && hasAddonEntitlement(hasEntitlement, a.entitlement)))
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
  isAdmin = false,
): AddonDef[] {
  return catalog.filter((a) =>
    (!a.adminOnly || isAdmin) && (a.free
      ? isFeatureEnabled(a.key) && isToggledOn(a)
      : !!a.entitlement && hasAddonEntitlement(hasEntitlement, a.entitlement)),
  )
}
