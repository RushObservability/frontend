// The capacity page consumes query-api's local /metrics endpoint. SRE-agent is
// checked here as well so its queue/dependency signals cannot silently drift.
// Keep this contract low-cardinality: user, tenant, session, query, trace, and
// span identifiers must never appear as Prometheus labels.

const queryApiGaugeNames = [
  'rush_stats_disk_local_free_bytes',
  'rush_stats_disk_local_total_bytes',
  'rush_stats_storage_bytes',
  'rush_stats_storage_rows',
  'rush_process_resident_memory_bytes',
  'rush_process_cpu_seconds_total',
  'rush_process_open_fds',
  'rush_runtime_alive_tasks',
  'rush_ingest_spool_bytes',
  'rush_ingest_spool_max_bytes',
  'rush_ingest_spool_utilization_ratio',
  'rush_ingest_spool_oldest_age_secs',
  'rush_ch_memory_tracking_bytes',
  'rush_ch_memory_resident_bytes',
  'rush_ch_query_log_p95_duration_ms',
  'rush_ch_query_log_recent_errors',
  'rush_ch_active_queries',
  'rush_ch_longest_running_query_secs',
  'rush_ch_active_merges',
  'rush_ch_active_mutations',
  'rush_ch_longest_running_merge_secs',
  'rush_ch_background_pool_task',
  'rush_ch_max_part_count_for_partition',
  'rush_ch_delayed_inserts',
]

const sreAgentGaugeNames = [
  'sre_agent_investigations_in_flight',
  'sre_agent_investigations_queued',
  'sre_agent_llm_requests_in_flight',
  'sre_agent_query_api_requests_in_flight',
  'sre_agent_process_resident_memory_bytes',
  'sre_agent_process_max_resident_memory_bytes',
  'sre_agent_process_cpu_seconds_total',
  'sre_agent_process_open_fds',
  'sre_agent_process_threads',
  'sre_agent_process_start_time_seconds',
  'sre_agent_runtime_workers',
  'sre_agent_runtime_alive_tasks',
  'sre_agent_tool_calls_in_flight',
  'sre_agent_sse_streams_in_flight',
  'sre_agent_readiness',
]

const sreAgentCounterNames = [
  'sre_agent_investigations_started_total',
  'sre_agent_investigations_completed_total',
  'sre_agent_investigations_failed_total',
  'sre_agent_investigations_cancelled_total',
  'sre_agent_investigations_rejected_total',
  'sre_agent_investigations_final_total',
  'sre_agent_investigations_preliminary_total',
  'sre_agent_investigations_questions_total',
  'sre_agent_investigation_tool_calls_total',
  'sre_agent_investigation_llm_calls_total',
  'sre_agent_investigation_result_bytes_total',
  'sre_agent_client_disconnects_total',
  'sre_agent_cancellations_total',
  'sre_agent_llm_requests_total',
  'sre_agent_llm_errors_total',
  'sre_agent_llm_prompt_tokens_total',
  'sre_agent_llm_completion_tokens_total',
  'sre_agent_query_api_requests_total',
  'sre_agent_query_api_errors_total',
  'sre_agent_clickhouse_probes_total',
  'sre_agent_clickhouse_probe_errors_total',
  'sre_agent_tool_calls_total',
  'sre_agent_tool_errors_total',
  'sre_agent_tool_empty_results_total',
  'sre_agent_sse_streams_closed_total',
]

const sreAgentHistogramNames = [
  'sre_agent_investigation_duration_seconds',
  'sre_agent_investigation_queue_wait_seconds',
  'sre_agent_llm_request_duration_seconds',
  'sre_agent_tool_duration_seconds',
  'sre_agent_cancellation_latency_seconds',
  'sre_agent_query_api_request_duration_seconds',
  'sre_agent_clickhouse_probe_duration_seconds',
]

const gauges = (names) => Object.fromEntries(names.map((name) => [name, { type: 'gauge', labels: [] }]))
const counters = (names) => Object.fromEntries(names.map((name) => [name, { type: 'counter', labels: [] }]))
const histograms = (names) => Object.fromEntries(names.map((name) => [name, { type: 'histogram', labels: [] }]))

export const CAPACITY_METRICS_CONTRACT = {
  queryApi: {
    name: 'query-api',
    endpointEnv: 'QUERY_API_METRICS_URL',
    metrics: gauges(queryApiGaugeNames),
  },
  sreAgent: {
    name: 'sre-agent',
    endpointEnv: 'SRE_AGENT_METRICS_URL',
    metrics: {
      ...gauges(sreAgentGaugeNames),
      ...counters(sreAgentCounterNames),
      // This one family intentionally has the fixed status_class label.
      sre_agent_llm_responses_total: { type: 'counter', labels: ['status_class'] },
      ...histograms(sreAgentHistogramNames),
    },
  },
}

export const FORBIDDEN_LABELS = new Set([
  'tenant',
  'tenant_id',
  'user',
  'user_id',
  'session',
  'session_id',
  'query',
  'query_id',
  'trace_id',
  'span_id',
])

function parseLabels(raw, line) {
  if (!raw) return []
  const labels = []
  let index = 0
  while (index < raw.length) {
    while (/\s|,/.test(raw[index] || '')) index += 1
    if (index >= raw.length) break
    const name = raw.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_]*/)?.[0]
    if (!name) throw new Error(`invalid label syntax in: ${line}`)
    index += name.length
    while (/\s/.test(raw[index] || '')) index += 1
    if (raw[index++] !== '=') throw new Error(`invalid label assignment in: ${line}`)
    while (/\s/.test(raw[index] || '')) index += 1
    if (raw[index++] !== '"') throw new Error(`label values must be quoted in: ${line}`)
    let escaped = false
    let closed = false
    while (index < raw.length) {
      const char = raw[index++]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') { closed = true; break }
    }
    if (!closed) throw new Error(`unterminated label in: ${line}`)
    labels.push(name)
    while (/\s/.test(raw[index] || '')) index += 1
    if (index < raw.length && raw[index] !== ',') throw new Error(`invalid label separator in: ${line}`)
  }
  return labels.sort()
}

export function parsePrometheus(text) {
  const samples = []
  const types = new Map()
  const malformed = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const type = line.match(/^#\s*TYPE\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(counter|gauge|histogram|summary|untyped)\s*$/)
    if (type) { types.set(type[1], type[2]); continue }
    if (line.startsWith('#')) continue
    const sample = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+0-9.eEInfNa]+)(?:\s+\S+)?$/)
    if (!sample) { malformed.push(line); continue }
    try {
      samples.push({ name: sample[1], labels: parseLabels(sample[2], line) })
    } catch { malformed.push(line) }
  }
  return { samples, types, malformed }
}

function sameLabels(actual, expected) {
  return actual.length === expected.length && actual.every((label, index) => label === expected[index])
}

export function validateMetrics(text, contract) {
  const parsed = parsePrometheus(text)
  const missing = []
  const labelMismatches = []
  const typeMismatches = []
  const forbiddenLabels = []

  for (const sample of parsed.samples) {
    for (const label of sample.labels) {
      if (FORBIDDEN_LABELS.has(label)) forbiddenLabels.push(`${sample.name}: ${label}`)
    }
  }

  for (const [family, expectation] of Object.entries(contract.metrics)) {
    const declaredType = parsed.types.get(family)
    if (declaredType && declaredType !== expectation.type) {
      typeMismatches.push(`${family}: expected ${expectation.type}, got ${declaredType}`)
    }
    const samples = expectation.type === 'histogram'
      ? [
        { name: `${family}_bucket`, labels: [...expectation.labels, 'le'].sort() },
        { name: `${family}_sum`, labels: [...expectation.labels].sort() },
        { name: `${family}_count`, labels: [...expectation.labels].sort() },
      ]
      : [{ name: family, labels: [...expectation.labels].sort() }]
    for (const expected of samples) {
      const matching = parsed.samples.filter((sample) => sample.name === expected.name)
      if (!matching.length) { missing.push(expected.name); continue }
      for (const actual of matching) {
        if (!sameLabels(actual.labels, expected.labels)) {
          labelMismatches.push(`${actual.name}: expected [${expected.labels.join(', ')}], got [${actual.labels.join(', ')}]`)
        }
      }
    }
    if (!declaredType) typeMismatches.push(`${family}: missing # TYPE declaration`)
  }

  return {
    ok: !parsed.malformed.length && !missing.length && !labelMismatches.length && !typeMismatches.length && !forbiddenLabels.length,
    present: [...new Set(parsed.samples.map((sample) => sample.name))],
    malformed: parsed.malformed,
    missing,
    labelMismatches,
    typeMismatches,
    forbiddenLabels,
  }
}
