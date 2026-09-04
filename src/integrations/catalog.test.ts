import { describe, it, expect } from 'vitest'
import { catalog, getAddon, entitledAddons, availableAddons, type AddonDef } from './catalog'

describe('getAddon', () => {
  it('looks up an add-on by key', () => {
    expect(getAddon('argocd')?.label).toBe('ArgoCD')
  })

  it('returns undefined for an unknown key', () => {
    expect(getAddon('nope')).toBeUndefined()
  })
})

describe('catalog invariants', () => {
  it('every entry has a unique key and at least one page', () => {
    const keys = catalog.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const a of catalog) expect(a.pages.length).toBeGreaterThan(0)
  })

  it('free add-ons carry an enabledKey; licensed add-ons carry an entitlement', () => {
    for (const a of catalog) {
      if (a.free) expect(a.enabledKey, `${a.key} should have enabledKey`).toBeTruthy()
      else expect(a.entitlement, `${a.key} should have entitlement`).toBeTruthy()
    }
  })
})

describe('entitledAddons', () => {
  it('always includes free add-ons regardless of entitlements', () => {
    const keys = entitledAddons(() => false).map((a) => a.key)
    expect(keys).toContain('argocd')
    expect(keys).toContain('fluxcd')
    expect(keys).toContain('kubernetes')
    expect(keys).not.toContain('postgresql')
  })

  it('does not include private integrations in the open-source edition', () => {
    const keys = catalog.map((a) => a.key)
    expect(keys).not.toContain('postgresql')
    expect(keys).not.toContain('mysql')
    expect(keys).toContain('kubernetes')
    expect(keys).not.toContain('kubernetes-logging')
  })
})

describe('availableAddons', () => {
  const hasEntitlement = (k: string) => k === 'postgres'

  it('shows a free add-on only when both feature-enabled AND toggled on', () => {
    const featureOn = (k: string) => k === 'argocd'
    const toggledOn = (a: AddonDef) => a.key === 'argocd'
    const keys = availableAddons(hasEntitlement, featureOn, toggledOn).map((a) => a.key)
    expect(keys).toContain('argocd')
    expect(keys).not.toContain('fluxcd') // neither feature-enabled nor toggled
  })

  it('hides a free add-on that is feature-enabled but not toggled on', () => {
    const featureOn = () => true
    const toggledOn = () => false
    const keys = availableAddons(hasEntitlement, featureOn, toggledOn).map((a) => a.key)
    expect(keys).not.toContain('argocd')
    expect(keys).not.toContain('argocd')
  })

  it('does not manufacture licensed add-ons from an entitlement alone', () => {
    const keys = availableAddons(hasEntitlement, () => false, () => false).map((a) => a.key)
    expect(keys).not.toContain('postgresql')
  })

  it('does not show an administrator-only add-on to a regular user', () => {
    const privateAddon: AddonDef = {
      key: 'private-test',
      label: 'Private test',
      icon: 'T',
      entitlement: 'private-test',
      adminOnly: true,
      pages: [{ key: 'overview', label: 'Overview', component: {} }],
    }
    catalog.push(privateAddon)
    try {
      expect(availableAddons(() => true, () => true, () => true, false)).not.toContain(privateAddon)
      expect(availableAddons(() => true, () => true, () => true, true)).toContain(privateAddon)
    } finally {
      catalog.pop()
    }
  })
})
