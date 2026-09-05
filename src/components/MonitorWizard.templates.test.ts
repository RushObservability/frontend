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
      query: {
        service: '*',
        metric: 'p95_latency',
        endpointFilter: '*',
        groupBy: ['service_name', 'endpoint'],
      },
      message: '{{service}} {{endpoint}} P95 latency is {{value}} ms, above {{threshold}} ms.',
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

  it('uses the reusable dashboard time-series panel for alert previews', () => {
    expect(wizardSource).toContain("import { TimeSeriesPanel } from './panels'")
    expect(wizardSource).toContain(':series="previewSeries"')
    expect(wizardSource).toContain(':thresholds="previewThresholds"')
    expect(wizardSource).toContain('show-chart-when-empty')
    expect(wizardSource).toContain('class="mf-preview-error"')
    expect(wizardSource).not.toContain('class="mf-chart-svg"')
  })

  it('keeps chart lookback separate and shows historical alert transitions', () => {
    expect(wizardSource).toContain('const previewLookbackSecs = ref(10_800)')
    expect(wizardSource).toContain("{ label: '12h', value: 43200 }")
    expect(wizardSource).toContain('lookback_secs: previewLookbackSecs.value')
    expect(wizardSource).toContain('Would this alert have fired?')
    expect(wizardSource).toContain('preview.value?.simulated_events || []')
    expect(wizardSource).toContain("return 'Recovered'")
    expect(wizardSource).not.toContain('mf-preview-current')
    expect(wizardSource).not.toContain(':range-label="previewRangeLabel"')
  })

  it('stacks optional warning before alert and blocks crossed thresholds', () => {
    expect(wizardSource.indexOf('for="monitor-warning-threshold"')).toBeLessThan(
      wizardSource.indexOf('for="monitor-alert-threshold"'),
    )
    expect(wizardSource).toContain('<small>Optional</small>')
    expect(wizardSource).toContain('thresholdValidationError')
    expect(wizardSource).toContain(':disabled="saving || !canSave"')
  })

  it('offers strict, inclusive, and equality comparators', () => {
    expect(wizardSource).toContain('value="above">greater than (&gt;)')
    expect(wizardSource).toContain('value="above_or_equal">greater than or equal to (&ge;)')
    expect(wizardSource).toContain('value="equal">equal to (=)')
    expect(wizardSource).toContain('value="below_or_equal">less than or equal to (&le;)')
    expect(wizardSource).toContain('value="below">less than (&lt;)')
  })

  it('groups wildcard APM templates by service and endpoint', () => {
    const apmTemplates = ALERT_TEMPLATES.filter(template => template.monitorType === 'apm')
    expect(apmTemplates.every(template => template.query.service === '*')).toBe(true)
    expect(apmTemplates.every(template => template.query.endpointFilter === '*')).toBe(true)
    expect(wizardSource).toContain('normalizeApmGroups(')
    expect(wizardSource).toContain('<code v-pre>{{service}}</code>')
    expect(wizardSource).toContain('<code v-pre>{{endpoint}}</code>')
  })

  it('uses service-level aggregation when the endpoint filter is empty', () => {
    expect(wizardSource).toContain('Leave blank to average across the whole service.')
    expect(wizardSource).toContain('@select="addApmGroupBy"')
  })
})
