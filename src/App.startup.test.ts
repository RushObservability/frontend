import { describe, expect, it } from 'vitest'
import source from './App.vue?raw'

describe('app startup loads', () => {
  it('loads features and license once, together, after tenants resolve', () => {
    const mounted = source.slice(source.indexOf('onMounted(async () => {'), source.indexOf('watch(isAuthenticated'))
    expect(mounted).not.toContain('loadFeatures()')
    expect(mounted).not.toContain('loadLicense()')
    const authed = source.slice(source.indexOf('watch(isAuthenticated'), source.indexOf('</script>'))
    expect(authed).toMatch(/await loadTenants\(\)[\s\S]*await Promise\.all\(\[loadFeatures\(\), loadLicense\(\)\]\)/)
    expect(source.match(/loadFeatures\(\)/g)).toHaveLength(1)
    expect(source.match(/loadLicense\(\)/g)).toHaveLength(1)
  })
})
