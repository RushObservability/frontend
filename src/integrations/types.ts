import type { Component } from 'vue'

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
  icon: string
  /** License entitlement required to show this add-on. */
  entitlement?: string
  /** Free add-ons need no entitlement and are controlled by a deploy feature flag. */
  free?: boolean
  /** Restrict the integration navigation and page to administrators. */
  adminOnly?: boolean
  /** Browser preference key backing the enable or disable toggle for free add-ons. */
  enabledKey?: string
  /** PromQL metric whose service_name label enumerates instances. */
  serverDiscoveryMetric?: string
  /** PromQL metric whose db label enumerates databases within an instance. */
  dbDiscoveryMetric?: string
  /** Shown when an entitled integration has no reporting instance yet. */
  setupComponent?: Component
  pages: AddonPage[]
}
