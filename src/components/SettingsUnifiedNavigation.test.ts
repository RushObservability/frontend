import { describe, expect, it } from 'vitest'
import appNavigationSource from './AppNavigation.vue?raw'
import settingsNavigationSource from './SettingsNavigation.vue?raw'
import settingsViewSource from '../views/SettingsView.vue?raw'

describe('unified Settings navigation', () => {
  it('uses the main sidebar for Settings sections', () => {
    expect(appNavigationSource).toContain('v-if="settingsMode"')
    expect(appNavigationSource).toContain('SETTINGS_TAB_GROUPS')
    expect(appNavigationSource).toContain('aria-label="Settings navigation"')
    expect(settingsViewSource).toContain(':show-rail="false"')
  })

  it('keeps the normal app navigation collapsed while Settings is open', () => {
    expect(appNavigationSource).toContain('class="app-menu-disclosure"')
    expect(appNavigationSource).toContain(':aria-expanded="appMenuOpen"')
    expect(appNavigationSource).toContain('class="collapsed-app-menu"')
    expect(appNavigationSource).toContain("item.id !== 'settings'")
  })

  it('keeps deep links and integration sub-pages available', () => {
    expect(appNavigationSource).toContain('settingsItemActive')
    expect(appNavigationSource).toContain('settingsIntegrationActive')
    expect(appNavigationSource).toContain('SETTINGS_INTEGRATIONS')
    expect(settingsViewSource).toContain('watch(() => route.hash, onHashChange)')
  })

  it('treats Integrations as a submenu instead of an overview page', () => {
    expect(appNavigationSource).toContain('class="settings-navigation-item settings-navigation-disclosure"')
    expect(appNavigationSource).toContain('aria-controls="settings-integration-links"')
    expect(settingsNavigationSource).toContain("group.items.filter(item => item.id !== 'integrations')")
    expect(settingsViewSource).not.toContain('class="int-table"')
    expect(settingsViewSource).not.toContain('selectIntegrations')
    expect(settingsViewSource).toContain("hash: `#integrations/${integration.key}`")
  })

  it('switches to one mobile picker when the main sidebar becomes bottom navigation', () => {
    expect(settingsNavigationSource).toContain('v-if="showRail"')
    expect(settingsNavigationSource).toContain('@media (max-width: 760px)')
    expect(settingsNavigationSource).toContain('class="settings-section-picker"')
  })
})
