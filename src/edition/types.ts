import type { RouteRecordRaw } from 'vue-router'
import type { AddonDef } from '../integrations/types'
import type { NavigationItem } from '../navigation'
import type { SettingsConfigPanel, SettingsIntegrationNavItem, SettingsTabDef } from '../views/settings/navigation'

/** Build-time additions supplied by a Rush frontend edition. */
export interface FrontendEdition {
  addons: AddonDef[]
  routes: RouteRecordRaw[]
  navigationItems: NavigationItem[]
  settingsIntegrations: SettingsIntegrationNavItem[]
  settingsTabs: SettingsTabDef[]
  settingsConfigPanels: SettingsConfigPanel[]
  /** Route prefixes where user-visible RUM events must be discarded. */
  privateRumPathPrefixes?: string[]
  /** Entitlements exposed only by Vite's local development server. */
  developmentEntitlements?: string[]
}
