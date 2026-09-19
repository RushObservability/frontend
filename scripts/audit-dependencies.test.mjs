import { test } from 'vitest'
import assert from 'node:assert/strict'
import { classifyAudit, auditWithRetries } from './audit-dependencies.mjs'

const quickUrl = 'https://registry.npmjs.org/-/npm/v1/security/audits/quick'
const result = (report, status = 1) => ({ status, stdout: JSON.stringify(report), stderr: '' })
const completed = (high = 0, critical = 0) => result({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
  vulnerabilities: {},
}, high || critical ? 1 : 0)
const fallbackError = result({ uri: quickUrl, statusCode: 400, error: { summary: 'Invalid package tree' } })

test('completed audits pass or block high/critical findings without probing the registry', async () => {
  const noProbe = () => { throw new Error('Should not probe a completed audit') }
  assert.equal(await classifyAudit(completed(), noProbe), 'passed')
  assert.equal(await classifyAudit(completed(1), noProbe), 'vulnerable')
  assert.equal(await classifyAudit(completed(0, 1), noProbe), 'vulnerable')
})

test('invalid-tree errors are advisory only when the primary endpoint confirms a server outage', async () => {
  assert.equal(await classifyAudit(fallbackError, async () => 503), 'unavailable')
  for (const status of [200, 400, 401, 403, 429]) {
    assert.equal(await classifyAudit(fallbackError, async () => status), 'error')
  }
  assert.equal(await classifyAudit(fallbackError, async () => { throw new Error('Network error') }), 'error')
})

test('unknown errors, malformed reports, and command failures stay blocking', async () => {
  const probe = async () => 503
  for (const value of [
    { status: 0, stdout: 'not json' }, result(null), result({}),
    result({ metadata: { vulnerabilities: { high: 0, critical: 0 } }, vulnerabilities: {} }, 0),
    result({ uri: 'https://example.com', statusCode: 503 }),
    { ...completed(), error: new Error('spawn failed') },
    { ...completed(), status: null }, { ...completed(), status: 1 },
  ]) assert.equal(await classifyAudit(value, probe), 'error')
})

test('an outage exhausts three attempts and reports unavailable, never clean', async () => {
  let attempts = 0
  let waits = 0
  const outcome = await auditWithRetries({
    run: () => { attempts++; return fallbackError }, probeBulk: async () => 503,
    wait: async ms => { assert.equal(ms, 10_000); waits++ }, log: () => {},
  })
  assert.equal(attempts, 3)
  assert.equal(waits, 2)
  assert.equal(outcome.status, 'unavailable')
  assert.equal(outcome.exitCode, 0)
  assert.match(outcome.message, /not a clean audit/)
})

test('recovery still blocks vulnerabilities; a clean recovery passes', async () => {
  for (const high of [0, 1]) {
    const sequence = [fallbackError, completed(high)]
    const outcome = await auditWithRetries({
      run: () => sequence.shift(), probeBulk: async () => 503, wait: async () => {}, log: () => {},
    })
    assert.equal(outcome.exitCode, high)
    assert.equal(outcome.status, high ? 'vulnerable' : 'passed')
  }
})

test('unconfirmed failures stop immediately and fail CI', async () => {
  const outcome = await auditWithRetries({
    run: () => fallbackError, probeBulk: async () => 200,
    wait: async () => { throw new Error('Must not retry a configuration failure') }, log: () => {},
  })
  assert.equal(outcome.exitCode, 1)
})
