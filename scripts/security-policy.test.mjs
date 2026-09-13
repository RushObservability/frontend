import { describe, expect, it } from 'vitest'
import { containsRemoteFontReference } from './security-policy.mjs'

describe('remote font reference checks', () => {
  it.each([
    'font-src https://fonts.gstatic.com;',
    'add_header Content-Security-Policy "style-src https://fonts.googleapis.com/css2" always;',
    '<link href="https://fonts.googleapis.com/css2?family=Example" rel="stylesheet">',
    '<link href="//FONTS.GSTATIC.COM/font.woff2">',
    'font-src https://sub.fonts.gstatic.com;',
    'font-src https://fonts.gstatic.com.example.net;',
    'font-src https://example.net/fonts.googleapis.com;',
  ])('rejects an embedded font reference: %s', text => {
    expect(containsRemoteFontReference(text)).toBe(true)
  })

  it.each(['', "font-src 'self';", '<link href="/assets/figtree.woff2">', 'fontsXgstaticYcom'])('allows text without a remote font reference: %s', text => {
    expect(containsRemoteFontReference(text)).toBe(false)
  })
})
