import { describe, expect, it } from 'vitest'
import source from './ServiceDetailView.vue?raw'

describe('service detail existence check', () => {
  it('looks the service up by its own name, not the first page of suggestions', () => {
    // The suggest endpoint returns at most 20 names in sorted order; without a
    // prefix any service sorting after the 20th is reported missing.
    expect(source).toContain("api.suggestValues('service_name', serviceName.value)")
    expect(source).not.toMatch(/suggestValues\('service_name'\)/)
  })
})
