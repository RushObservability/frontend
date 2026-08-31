#!/usr/bin/env node

import { CAPACITY_METRICS_CONTRACT, validateMetrics } from './capacity-metrics-contract.mjs'

const timeoutMs = Number(process.env.METRICS_VALIDATION_TIMEOUT_MS || 5000)
const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index]
  if (value === '--help' || value === '-h') {
    console.log('Usage: npm run validate:capacity-metrics [--query-api URL] [--sre-agent URL]')
    console.log('Defaults: http://localhost:8080/metrics and http://localhost:8081/metrics')
    process.exit(0)
  }
  if (value?.startsWith('--')) args.set(value.slice(2), process.argv[++index])
}

const endpoints = {
  queryApi: args.get('query-api') || process.env.QUERY_API_METRICS_URL || 'http://localhost:8080/metrics',
  sreAgent: args.get('sre-agent') || process.env.SRE_AGENT_METRICS_URL || 'http://localhost:8081/metrics',
}

async function fetchMetrics(service, url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`)
    return body
  } catch (error) {
    throw new Error(`${service} at ${url} is unavailable: ${error?.message || error}`)
  } finally {
    clearTimeout(timer)
  }
}

let failures = 0
for (const [key, contract] of Object.entries(CAPACITY_METRICS_CONTRACT)) {
  let body
  try {
    body = await fetchMetrics(contract.name, endpoints[key])
  } catch (error) {
    console.error(`✗ ${error.message}`)
    failures += 1
    continue
  }
  const result = validateMetrics(body, contract)
  const expectedFamilies = Object.keys(contract.metrics).length
  const presentFamilies = Object.keys(contract.metrics).filter((name) => result.present.includes(name)).length
  if (result.ok) {
    console.log(`✓ ${contract.name}: ${presentFamilies}/${expectedFamilies} metric families present; labels and types match`)
    continue
  }
  failures += 1
  console.error(`✗ ${contract.name}: ${presentFamilies}/${expectedFamilies} metric families present`)
  for (const [label, values] of Object.entries({
    missing: result.missing,
    'type mismatch': result.typeMismatches,
    'label mismatch': result.labelMismatches,
    'forbidden label': result.forbiddenLabels,
    malformed: result.malformed,
  })) {
    if (values.length) console.error(`  ${label}: ${values.join('; ')}`)
  }
}

if (failures) {
  console.error(`Capacity metric validation failed for ${failures} service${failures === 1 ? '' : 's'}.`)
  process.exitCode = 1
} else {
  console.log('Capacity metric validation passed.')
}
