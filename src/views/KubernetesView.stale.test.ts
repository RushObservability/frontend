import { describe, expect, it } from 'vitest'
import source from './KubernetesView.vue?raw'

describe('Kubernetes resource lists', () => {
  it('ignores resources for a previous namespace or page', () => {
    const loadGroup = source.slice(source.indexOf('async function loadGroup()'), source.indexOf('onMounted('))
    expect(loadGroup).toContain('const generation = ++groupGeneration')
    const guard = loadGroup.indexOf('if (generation !== groupGeneration) return')
    expect(guard).toBeGreaterThan(loadGroup.indexOf('await Promise.all('))
    expect(guard).toBeLessThan(loadGroup.indexOf('data.value = next'))
  })
})
