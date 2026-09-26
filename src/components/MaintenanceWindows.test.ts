import { describe, expect, it } from 'vitest'
import source from './MaintenanceWindows.vue?raw'
import settingsSource from '../views/SettingsView.vue?raw'
import apiSource from '../composables/useApi.ts?raw'

describe('maintenance windows panel', () => {
  it('explains what a window does', () => {
    expect(source).toContain('Silence alert notifications during planned work')
    expect(source).toContain('anything that differs from its last notification is sent once')
  })

  it('offers every scope and the window lifecycle actions', () => {
    expect(source).toContain('value="all"')
    expect(source).toContain('value="monitor"')
    expect(source).toContain('value="tag"')
    expect(source).toContain("'End now'")
    expect(source).toContain('DeleteConfirmationModal')
  })

  it('is wired into alerting settings and the maintenance API', () => {
    expect(settingsSource).toContain("import MaintenanceWindows from '../components/MaintenanceWindows.vue'")
    expect(settingsSource).toContain('<MaintenanceWindows />')
    expect(apiSource).toContain("request('/maintenance-windows')")
    expect(apiSource).toContain('deleteMaintenanceWindow')
  })
})
