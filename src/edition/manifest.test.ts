import { describe, expect, it } from 'vitest'
import { frontendEdition } from './manifest'
import routerSource from '../router.ts?raw'

describe('open-source frontend edition', () => {
  it('does not register licensed modules', () => {
    expect(frontendEdition.addons).toEqual([])
    expect(frontendEdition.routes).toEqual([])
    expect(frontendEdition.navigationItems).toEqual([])
    expect(frontendEdition.settingsIntegrations).toEqual([])
  })

  it('does not statically import licensed views from the core router', () => {
    expect(routerSource).not.toContain("import('./views/KubernetesAccessView.vue')")
    expect(routerSource).not.toContain("import('./views/KubernetesLoginView.vue')")
  })
})
