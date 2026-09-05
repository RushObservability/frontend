import { describe, expect, it } from 'vitest'
import routerSource from '../router.ts?raw'
import navigationSource from '../navigation.ts?raw'
import commandPaletteSource from './CommandPalette.vue?raw'
import wizardSource from './MonitorWizard.vue?raw'
import { ALERT_TEMPLATE_GROUPS, ALERT_TEMPLATES } from '../lib/alertTemplates'

describe('alert templates', () => {
  it('provides a useful set of templates across every supported signal group', () => {
    expect(ALERT_TEMPLATES).toHaveLength(12)
    expect(new Set(ALERT_TEMPLATES.map(template => template.group))).toEqual(
      new Set(ALERT_TEMPLATE_GROUPS.map(group => group.id)),
    )
  })

  it('provides an editable p95 latency monitor in milliseconds', () => {
    const template = ALERT_TEMPLATES.find(item => item.id === 'p95-latency')

    expect(template).toMatchObject({
      monitorType: 'apm',
      evalWindow: 300,
      comparator: 'above',
      criticalThreshold: 500,
      warningThreshold: 300,
      query: { metric: 'p95_latency' },
    })
  })

  it('carries the former log and infrastructure detections into alert templates', () => {
    expect(ALERT_TEMPLATES.find(item => item.id === 'failed-login-brute-force')).toMatchObject({
      monitorType: 'log',
      criticalThreshold: 10,
      query: {
        filters: [{ field: 'mat_action', op: '=', value: 'login_failed' }],
        groupBy: ['mat_source_ip'],
      },
    })
    expect(ALERT_TEMPLATES.find(item => item.id === 'cpu-saturation')).toMatchObject({
      monitorType: 'metric',
      criticalThreshold: 0.9,
      query: { metricName: 'system.cpu.utilization', aggregation: 'avg' },
    })
  })

  it('removes Detection from navigation and sends old links to Alerts', () => {
    expect(navigationSource).not.toContain("id: 'detection'")
    expect(commandPaletteSource).not.toContain('New Detection Rule')
    expect(routerSource).not.toContain("import('./views/DetectionView.vue')")
    expect(routerSource).toContain("path: '/detection/:pathMatch(.*)*'")
    expect(routerSource).toContain("redirect: '/alerts'")
  })

  it('keeps templates in an accessible slide-down drawer', () => {
    expect(wizardSource).toContain(':aria-expanded="templatesExpanded"')
    expect(wizardSource).toContain('id="alert-template-drawer"')
    expect(wizardSource).toContain(':inert="!templatesExpanded"')
    expect(wizardSource).toContain('templatesExpanded.value = false')
    expect(wizardSource).toContain('class="mf-template-drawer"')
  })
})
