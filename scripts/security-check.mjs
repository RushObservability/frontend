import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

const root = process.cwd()
const failures = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function fail(message) {
  failures.push(message)
}

// Keep workflow supply-chain changes reviewable: every third-party action must
// be addressed by an immutable commit SHA, never a mutable tag or branch.
const workflowFiles = execFileSync('git', ['ls-files', '.github/workflows'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
for (const file of workflowFiles) {
  const content = read(file)
  for (const [index, line] of content.split('\n').entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)@([^\s#]+)/)
    if (!match) continue
    if (!/^[0-9a-f]{40}$/i.test(match[2])) {
      fail(`${file}:${index + 1}: action ${match[1]} must use a 40-character commit SHA`)
    }
  }
}

const packageLock = JSON.parse(read('package-lock.json'))
if (packageLock.lockfileVersion !== 3) {
  fail(`package-lock.json must use lockfileVersion 3 (found ${packageLock.lockfileVersion})`)
}

const dockerfile = read('Dockerfile')
const fromLines = dockerfile.split('\n').filter((line) => /^FROM\s+/i.test(line))
if (fromLines.length === 0 || fromLines.some((line) => !/@sha256:[0-9a-f]{64}(?:\s|$)/i.test(line))) {
  fail('Dockerfile base images must all be pinned by sha256 digest')
}
if ((dockerfile.match(/\bRUN\s+npm\s+ci\b/g) || []).length !== 1) {
  fail('Dockerfile must perform exactly one locked npm ci install')
}
if (/\bRUN\s+npm\s+install\b/.test(dockerfile)) {
  fail('Dockerfile must not use npm install; use the committed lockfile with npm ci')
}
const dockerignore = read('.dockerignore')
for (const required of ['.git', '.env', 'node_modules', 'dist', 'test-results', 'runtime-config.js']) {
  if (!dockerignore.split('\n').includes(required)) fail(`.dockerignore must exclude ${required}`)
}

const headers = read('nginx/nginx-security-headers.conf')
for (const required of [
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Content-Security-Policy',
]) {
  if (!headers.includes(`add_header ${required}`)) {
    fail(`nginx/nginx-security-headers.conf is missing ${required}`)
  }
}
if (!read('nginx/nginx.conf').includes('include /etc/nginx/security-headers.conf;')) {
  fail('nginx/nginx.conf must include the shared security headers configuration')
}
for (const directive of [
  "script-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
]) {
  if (!headers.includes(directive)) fail(`CSP is missing ${directive}`)
}
if (/style-src\s[^;]*'unsafe-inline'/.test(headers)) {
  fail("CSP must not grant broad style-src 'unsafe-inline'; keep the style attribute exception explicit")
}
if (!headers.includes('Content-Security-Policy-Report-Only') || !headers.includes('/api/v1/security/csp-report')) {
  fail('CSP report-only telemetry endpoint must remain configured')
}

// In the monorepo, Helm must consume the policy baked into this image rather
// than carrying another CSP copy that can drift. The Helm repository also runs
// the corresponding assertion when it is checked out independently.
const helmTemplate = join(dirname(root), 'helm-charts/charts/rushobservability/templates/frontend-nginx-configmap.yaml')
try {
  const helm = readFileSync(helmTemplate, 'utf8')
  if (helm.includes('Content-Security-Policy') || !helm.includes('include /etc/nginx/security-headers.conf;')) {
    fail('Helm frontend nginx config must include the image security policy without duplicating CSP')
  }
} catch {
  // Standalone web-ui checkout: Helm owns the mirror assertion in its CI.
}

// Scan tracked source/docs for credential formats that should never be
// committed. Deliberately use high-confidence formats to avoid blocking
// legitimate UI copy such as “enter your API key”.
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
]
const ignoredExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'])
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
for (const file of trackedFiles) {
  if (file.startsWith('node_modules/') || file.startsWith('dist/') || ignoredExtensions.has(extname(file))) continue
  let content
  try { content = read(file) } catch { continue }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) fail(`${file}: matches a committed credential format (${pattern})`)
  }
}

// Sensitive browser state must go through the user/tenant-scoped storage
// helpers. Literal legacy keys here would bypass logout and tenant cleanup.
const sourceFiles = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('.ts') || file.endsWith('.vue'))
const approvedHtmlSinks = new Set([
  'src/components/InvestigationPanel.vue',
  'src/components/MonitorWizard.vue',
])
for (const file of sourceFiles) {
  const content = read(file)
  if (/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]rush[_-]/.test(content)) {
    fail(`${file}: literal Rush localStorage keys must use storageScope helpers`)
  }
  if (content.includes('v-html')) {
    if (!approvedHtmlSinks.has(file)) {
      fail(`${file}: v-html is not an approved HTML sink; render typed components instead`)
    } else if (!content.includes("from 'dompurify'") || !content.includes('DOMPurify.sanitize(')) {
      fail(`${file}: approved v-html sink must sanitize with DOMPurify`)
    }
  }
  if (/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/.test(content)) {
    fail(`${file}: direct DOM HTML injection is forbidden`)
  }
  if (/(?:localStorage|sessionStorage)\.(?:getItem|setItem)\([^\n]*(?:token|session|password|secret)/i.test(content)) {
    fail(`${file}: authentication secrets must not be persisted in browser storage`)
  }
}

if (failures.length > 0) {
  console.error('Security checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Security checks passed (${workflowFiles.length} workflows, ${trackedFiles.length} tracked files scanned).`)
}
