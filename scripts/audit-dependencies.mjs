import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const bulkUrl = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
const quickUrl = 'https://registry.npmjs.org/-/npm/v1/security/audits/quick'
const serverError = status => Number.isInteger(status) && status >= 500 && status <= 599

// An invalid-tree response alone is NOT an outage. Confirm that npm's primary
// endpoint is returning a server error before treating the fallback as one.
export async function classifyAudit(result, probeBulk) {
  let report
  try { report = JSON.parse(result.stdout) } catch { return 'error' }
  if (result.error || ![0, 1].includes(result.status)) return 'error'
  if (report?.metadata?.vulnerabilities && !report.error) {
    const counts = report.metadata.vulnerabilities
    if (!['info', 'low', 'moderate', 'high', 'critical', 'total'].every(key => Number.isInteger(counts[key]) && counts[key] >= 0)) return 'error'
    if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) return 'error'
    if (counts.high || counts.critical) return 'vulnerable'
    return result.status === 0 ? 'passed' : 'error'
  }
  if (result.status !== 1) return 'error'
  if ([bulkUrl, quickUrl].includes(report?.uri) && serverError(report.statusCode)) return 'unavailable'
  if (report?.uri === quickUrl && report.statusCode === 400) {
    try {
      if (serverError(await probeBulk())) return 'unavailable'
    } catch { /* A failed probe does not prove a registry server outage. */ }
  }
  return 'error'
}

export async function auditWithRetries({ run, probeBulk, wait = setTimeout, log = console.log }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run()
    const status = await classifyAudit(result, probeBulk)
    if (status === 'unavailable' && attempt < 3) {
      log(`npm audit service unavailable, retrying in 10 seconds (${attempt}/3).`)
      await wait(10_000)
      continue
    }
    const messages = {
      passed: 'Dependency audit completed with no high or critical vulnerabilities.',
      vulnerable: 'Dependency audit found high or critical vulnerabilities.',
      unavailable: 'Dependency audit unavailable after 3 attempts due to confirmed npm registry server errors. No scan result was obtained; this is not a clean audit. CI is continuing without a dependency audit result.',
      error: 'Dependency audit failed without a valid report or a confirmed registry server outage. Review the npm error and dependency configuration.',
    }
    if (status === 'passed' || status === 'vulnerable') log(result.stdout)
    else if (status === 'error') log(result.stderr || 'npm audit returned invalid or incomplete output.')
    return { status, message: messages[status], exitCode: ['passed', 'unavailable'].includes(status) ? 0 : 1 }
  }
}

async function main() {
  const outcome = await auditWithRetries({
    run: () => spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
    }),
    probeBulk: async () => {
      // A diagnostic probe only. Its response is never used as an audit result.
      const response = await fetch(bulkUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npm: ['10.9.2'] }), signal: AbortSignal.timeout(10_000),
      })
      await response.body?.cancel()
      return response.status
    },
  })
  const prefix = outcome.status === 'unavailable' ? '::warning::' : outcome.exitCode ? '::error::' : ''
  console.log(`${prefix}${outcome.message}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dependency audit\n\n${outcome.message}\n\n`)
  }
  process.exitCode = outcome.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
