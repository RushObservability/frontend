import { describe, expect, it } from 'vitest'
import { readRumConfiguration } from './rumConfig'

describe('RUM runtime configuration', () => {
  it('requires opt-in and uses the actual build version and mode', () => {
    expect(readRumConfiguration(undefined, { VITE_RUM_BUILD_VERSION: '1.2.3', MODE: 'production' }))
      .toMatchObject({ enabled: false, appVersion: '1.2.3', environment: 'production' })
  })
  it('lets runtime settings enable a prebuilt image and disable a build opt-in', () => {
    expect(readRumConfiguration({ enabled: true, environment: 'production' }, {})).toMatchObject({ enabled: true })
    expect(readRumConfiguration({ enabled: false }, { VITE_RUM_ENABLED: 'true' }).enabled).toBe(false)
  })
  it('preserves Vite development overrides', () => {
    expect(readRumConfiguration(undefined, { VITE_RUM_ENABLED: 'true', VITE_RUM_APP_NAME: 'dev-ui', MODE: 'development' }))
      .toMatchObject({ enabled: true, appName: 'dev-ui', environment: 'development' })
  })
  it.each(['https://other.example/ingest', '//other.example/ingest', '/x?token=secret', '/a/../ingest', '/a\\b', '/x#fragment'])('disables collection for an unsafe endpoint %s', endpoint => {
    expect(readRumConfiguration({ enabled: true, endpoint }, {}).enabled).toBe(false)
  })
  it('rejects unexpected runtime types and unbounded metadata', () => {
    expect(readRumConfiguration({ enabled: 'true' }, {}).enabled).toBe(false)
    expect(readRumConfiguration({ enabled: true, appName: 'x'.repeat(65) }, {}).enabled).toBe(false)
  })
})
