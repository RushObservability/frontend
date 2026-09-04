import type { FrontendEdition } from './types'

/**
 * The open-source build ships only the shared Rush frontend.
 *
 * A licensed build overlays this file during composition and registers its
 * private integration pages and routes. Keeping the import static means Vite
 * cannot pull private modules into the open-source output by accident.
 */
export const frontendEdition: FrontendEdition = {
  addons: [],
  routes: [],
  navigationItems: [],
  settingsIntegrations: [],
}
