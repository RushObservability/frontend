import { describe, expect, it } from 'vitest'
import routerSource from './router.ts?raw'
import appSource from './App.vue?raw'
import settingsSource from './views/SettingsView.vue?raw'

describe('tenant links', () => {
  it('applies ?tenant= after sign-in, then removes it from the URL', () => {
    expect(routerSource).toContain("typeof to.query.tenant === 'string'")
    expect(routerSource).toContain('await useTenant().applyLinkedTenant(requestedTenant)')
    expect(routerSource).toContain('const { tenant: _tenant, ...query } = to.query')
    expect(routerSource).toContain('if (linkTenant) return { ...target, replace: true }')
  })

  it('reloads on a switch so no view keeps the old tenant', () => {
    expect(routerSource).toContain("if (outcome === 'switched') {")
    expect(routerSource).toContain('window.location.replace(router.resolve(target).href)')
  })

  it('keeps the requested tenant across the login redirect, which drops query strings', () => {
    expect(routerSource).toContain('if (linkTenant) rememberLinkTenant(linkTenant)')
    expect(routerSource).toContain('linkTenant || takeLinkTenant()')
    expect(routerSource).toContain("return { name: 'login', query: { redirect: to.path } }")
  })

  it('tells the user when a link names a tenant they cannot use', () => {
    expect(appSource).toContain('v-if="linkedTenantNotice" class="tenant-link-notice" role="alert"')
    expect(appSource).toContain('@click="dismissLinkedTenantNotice"')
  })
})

describe('API key roles', () => {
  it('lets admins pick viewer or write for query keys only', () => {
    expect(settingsSource).toContain('<select id="api-key-role" v-model="keyRole" class="form-input">')
    expect(settingsSource).toContain("...(keyType.value === 'query' ? { role: keyRole.value, agent: keyAgent.value } : {}),")
  })

  it('shows each query key role in the list', () => {
    expect(settingsSource).toContain("{{ k.role === 'write' ? 'write' : 'viewer' }}")
  })

  it('offers agent access on query keys only, off by default, and shows it in the list', () => {
    expect(settingsSource).toContain('const keyAgent = ref(false)')
    expect(settingsSource).toContain('<input id="api-key-agent" v-model="keyAgent" type="checkbox" />')
    // The checkbox lives in the query-key branch of the form, after the role picker.
    const roleSelect = settingsSource.indexOf('id="api-key-role"')
    const agentBox = settingsSource.indexOf('id="api-key-agent"')
    const ingestSignals = settingsSource.indexOf("v-for=\"signal in ['logs'")
    expect(agentBox).toBeGreaterThan(roleSelect)
    expect(ingestSignals).toBeLessThan(roleSelect)
    expect(settingsSource).toContain('<span v-if="k.agent" class="key-role-badge key-role-agent"')
  })
})
