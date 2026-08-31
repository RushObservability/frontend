import { describe, expect, it } from 'vitest'
import { NAVIGATION_ITEMS, navigationItemIsActive, visibleNavigationGroups } from './navigation'

const baseContext = {
  isAdmin: false,
  features: { rum: true, sre_agent: false },
  hasIntegrations: false,
}

describe('visibleNavigationGroups', () => {
  it('hides administrative, disabled, and unavailable destinations', () => {
    const ids = visibleNavigationGroups(baseContext).flatMap(group => group.items.map(item => item.id))

    expect(ids).toContain('explore')
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

