import { describe, expect, it } from 'vitest'
import { sanitizeRumEvent } from './rumPrivacy'

describe('RUM privacy', () => {
  it('removes exception text and stack frames', () => {
    expect(sanitizeRumEvent({
      event_type: 'error',
      error_message: 'Request failed for tenant customer-a using token secret-value',
      error_stack: 'Error: secret-value\n at SettingsView.vue:1',
      error_type: 'TypeError',
    }, '/services')).toEqual({
      event_type: 'error',
      error_message: 'Client error',
      error_type: 'TypeError',
    })
  })

  it('keeps only the element type from interaction targets', () => {
    expect(sanitizeRumEvent({
      event_type: 'interaction',
      interaction_type: 'click',
      interaction_target: 'button#customer-a.open-modal "Show production token"',
    }, '/services')).toEqual({
      event_type: 'interaction',
      interaction_type: 'click',
      interaction_target: 'button',
    })
  })

  it.each([
    '/login',
    '/setup/sso',
    '/settings',
    '/settings/users',
    '/kubernetes-access/login/ABC123',
  ])('drops private interaction and error telemetry on %s', pathname => {
    expect(sanitizeRumEvent({ event_type: 'interaction' }, pathname)).toBeNull()
    expect(sanitizeRumEvent({ event_type: 'frustration' }, pathname)).toBeNull()
    expect(sanitizeRumEvent({ event_type: 'error' }, pathname)).toBeNull()
  })

  it('retains non-sensitive performance events on private pages', () => {
    expect(sanitizeRumEvent({ event_type: 'web_vital', vital_name: 'LCP', vital_value: 120 }, '/login'))
      .toEqual({ event_type: 'web_vital', vital_name: 'LCP', vital_value: 120 })
  })
})
