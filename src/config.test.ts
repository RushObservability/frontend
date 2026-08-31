import { describe, expect, it } from 'vitest'
import { normalizeApiOrigin } from './config'

describe('runtime API origin validation', () => {
  it('normalizes a root URL to an exact origin', () => {
    expect(normalizeApiOrigin('https://api.example.com/', 'https://rush.example.com', true))
      .toBe('https://api.example.com')
  })

  it.each([
    'https://user:secret@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com?tenant=a',
    'https://api.example.com/#fragment',
    'javascript:alert(1)',
  ])('rejects non-origin runtime value %s', (value) => {
    expect(() => normalizeApiOrigin(value, 'https://rush.example.com', true)).toThrow()
  })

  it('rejects insecure and cross-scheme origins in production', () => {
    expect(() => normalizeApiOrigin('http://api.example.com', 'https://rush.example.com', true))
      .toThrow()
    expect(normalizeApiOrigin('http://localhost:8080', 'http://localhost:5173', false))
      .toBe('http://localhost:8080')
  })
})
