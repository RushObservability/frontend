import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

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

const headers = read('nginx-security-headers.conf')
for (const required of [
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Content-Security-Policy',
]) {
  if (!headers.includes(`add_header ${required}`)) {
    fail(`nginx-security-headers.conf is missing ${required}`)
  }
}
if (!read('nginx.conf').includes('include /etc/nginx/security-headers.conf;')) {
  fail('nginx.conf must include the shared security headers configuration')
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
for (const file of sourceFiles) {
  const content = read(file)
  if (/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]rush[_-]/.test(content)) {
    fail(`${file}: literal Rush localStorage keys must use storageScope helpers`)
  }
}

if (failures.length > 0) {
  console.error('Security checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Security checks passed (${workflowFiles.length} workflows, ${trackedFiles.length} tracked files scanned).`)
}
