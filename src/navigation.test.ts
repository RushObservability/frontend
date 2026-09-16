import { describe, expect, it } from 'vitest'
import { NAVIGATION_ITEMS, navigationItemIsActive, navigationItemVisible, visibleNavigationGroups } from './navigation'

const baseContext = {
  isAdmin: false,
  features: { rum: true, sre_agent: false },
  hasIntegrations: false,
}

describe('visibleNavigationGroups', () => {
  it('hides administrative, disabled, and unavailable destinations', () => {
    const ids = visibleNavigationGroups(baseContext).flatMap(group => group.items.map(item => item.id))

    expect(ids).toContain('explore')
    expect(ids).toContain('profiles')
    expect(visibleNavigationGroups(baseContext).find(group => group.id === 'observe')?.items.map(item => item.id)).toEqual(['explore', 'services', 'dashboards', 'metrics', 'rum', 'profiles'])
    expect(ids).toContain('rum')
    expect(ids).not.toContain('settings')
    expect(ids).not.toContain('sre-agent')
    expect(ids).not.toContain('integrations')
  })

  it('shows entitled and administrative destinations from the same registry', () => {
    const ids = visibleNavigationGroups({
      isAdmin: true,
      features: { rum: false, sre_agent: true },
      hasIntegrations: true,
    }).flatMap(group => group.items.map(item => item.id))

    expect(ids).toContain('settings')
    expect(ids).toContain('sre-agent')
    expect(ids).toContain('integrations')
    expect(ids).not.toContain('rum')
    expect(visibleNavigationGroups({
      isAdmin: true,
      features: { rum: false, sre_agent: true },
      hasIntegrations: true,
    }).map(group => group.id)).toEqual(['observe', 'respond', 'integrations', 'investigate', 'control'])
  })
})

describe('navigationItemIsActive', () => {
  it('keeps detail and create routes attached to their parent destination', () => {
    const alerts = NAVIGATION_ITEMS.find(item => item.id === 'alerts')!
    const services = NAVIGATION_ITEMS.find(item => item.id === 'services')!

    expect(navigationItemIsActive(alerts, 'monitor-create')).toBe(true)
    expect(navigationItemIsActive(services, 'service-detail')).toBe(true)
    expect(navigationItemIsActive(services, 'alerts')).toBe(false)
  })
})

describe('paid navigation', () => {
  const paidItem = {
    id: 'paid-reports',
    label: 'Paid reports',
    path: '/paid-reports',
    icon: 'R',
    group: 'control' as const,
    routeNames: ['paid-reports'],
    entitlement: 'paid_reports',
  }

  it('shows a paid destination only for the matching entitlement', () => {
    expect(navigationItemVisible(paidItem, {
      ...baseContext,
      hasEntitlement: entitlement => entitlement === 'paid_reports',
    })).toBe(true)
    expect(navigationItemVisible(paidItem, {
      ...baseContext,
      hasEntitlement: () => false,
    })).toBe(false)
  })
})
