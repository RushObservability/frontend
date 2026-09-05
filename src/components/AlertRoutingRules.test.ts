import { describe, expect, it } from 'vitest'
import source from './AlertRoutingRules.vue?raw'
import settingsSource from '../views/SettingsView.vue?raw'
import apiSource from '../composables/useApi.ts?raw'
import monitorListSource from '../views/MonitorsView.vue?raw'
import monitorWizardSource from './MonitorWizard.vue?raw'

describe('alert routing rules', () => {
  it('explains additive delivery and AND tag matching', () => {
    expect(source).toContain('Rush sends to every matching route')
    expect(source).toContain('Conditions inside this route use AND')
    expect(source).toContain('One delivery per channel')
    expect(source).toContain('team:devops')
  })

  it('supports priority, tag, channel, edit, enable, and delete controls', () => {
    expect(source).toContain('v-for="priority in [1, 2, 3, 4, 5]"')
    expect(source).toContain('draft.value.matchers')
    expect(source).toContain('toggleChannel(channel.id)')
    expect(source).toContain('updateAlertRoute(route.id')
    expect(source).toContain('DeleteConfirmationModal')
  })

  it('is wired into alerting settings and the route API', () => {
    expect(settingsSource).toContain("import AlertRoutingRules from '../components/AlertRoutingRules.vue'")
    expect(settingsSource).toContain('<AlertRoutingRules :channels="alertChannels" />')
    expect(apiSource).toContain("request('/alert-routes')")
    expect(apiSource).toContain('createAlertRoute')
    expect(apiSource).toContain('updateAlertRoute')
    expect(apiSource).toContain('deleteAlertRoute')
    expect(monitorListSource).toContain('to="/settings#alerting"')
    expect(monitorWizardSource).toContain('to="/settings#alerting"')
  })
})
