const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/verify-security-headers.mjs <url>')
  process.exit(2)
}

const response = await fetch(target, {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
})

if (!response.ok) {
  throw new Error(`Security-header target returned HTTP ${response.status}`)
}

const expectedHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
}

for (const [name, expected] of Object.entries(expectedHeaders)) {
  const actual = response.headers.get(name)
  if (actual !== expected) throw new Error(`${name} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const csp = response.headers.get('content-security-policy') || ''
for (const directive of [
  "script-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'none'",
  "font-src 'self'",
  "object-src 'none'",
]) {
  if (!csp.includes(directive)) throw new Error(`Content-Security-Policy is missing ${directive}`)
}
if (csp.includes("'unsafe-inline'") || /fonts\.(?:googleapis|gstatic)\.com/.test(csp)) {
  throw new Error('Content-Security-Policy contains an unsafe inline or third-party font allowance')
}

console.log(`Security headers verified for ${target}`)
