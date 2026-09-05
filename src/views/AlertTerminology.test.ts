import { describe, expect, it } from 'vitest'
import wizardSource from '../components/MonitorWizard.vue?raw'
import createSource from './MonitorCreateView.vue?raw'
import detailSource from './MonitorDetailView.vue?raw'
import editSource from './MonitorEditView.vue?raw'
import listSource from './MonitorsView.vue?raw'

describe('alert route terminology', () => {
  it('uses alerts on the list and create pages', () => {
    expect(listSource).toContain('<h1 class="monitors-title">Alerts</h1>')
    expect(listSource).toContain('New alert')
    expect(createSource).toContain('Alerts')
    expect(createSource).toContain('New alert')
    expect(createSource).not.toContain('New Monitor')
  })

  it('uses alerts on the edit and detail pages', () => {
    expect(editSource).toContain('Back to alert')
    expect(editSource).toContain("monitorName || 'Alert'")
    expect(detailSource).toContain('Alert state (OK / alerting / no-data)')
    expect(detailSource).toContain('source-label="Alert events"')
    expect(detailSource).toContain('Investigate firing alert')
  })

  it('uses alert terminology throughout the shared form', () => {
    expect(wizardSource).toContain('Alert type')
    expect(wizardSource).toContain('No existing alerts')
    expect(wizardSource).toContain('Use letters to reference alerts.')
    expect(wizardSource).toContain("isEditing ? 'Update alert' : 'Save alert'")
    expect(wizardSource).not.toContain('Failed to save monitor')
  })
})
