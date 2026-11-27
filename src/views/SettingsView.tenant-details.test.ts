import { describe, expect, it } from 'vitest'
import source from './SettingsView.vue?raw'

describe('settings tenant detail loading', () => {
  it('does not fetch per-tenant signals and retention when Settings opens', () => {
    const mounted = source.slice(source.indexOf('onMounted(async'), source.indexOf('onBeforeUnmount('))
    expect(mounted).not.toContain('loadAllTenantRetention()')
    expect(mounted).not.toContain('loadAllTenantSignals()')
  })

  it('loads them once the Tenants section is shown, with bounded concurrency', () => {
    expect(source).toContain("if (tenantDetailsLoaded || activeTab.value !== 'tenants' || !tenants.value.length) return")
    expect(source).not.toMatch(/Promise\.allSettled\(\s*tenants\.value\.map/)
    expect(source.match(/settleLimited\(tenants\.value, TENANT_DETAIL_CONCURRENCY,/g)).toHaveLength(2)
  })
})
