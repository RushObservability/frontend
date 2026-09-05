export type CapacitySeverity = 'stable' | 'watch' | 'urgent'

export interface CapacityRecommendation {
  severity: CapacitySeverity
  title: string
  body: string
  evidence: string
  action: string
}

export interface CapacitySnapshot {
  capturedAt: number
  queryP95Ms: number | null
  activeQueries: number | null
  queryLimit: number | null
  spoolUsedPct: number
  spoolOldestAgeSecs: number
  diskUsedPct: number | null
  maxParts: number
  partsDelayThreshold: number | null
  delayedInserts: number
  rejectedInsertsTotal: number
  backgroundPoolTasks: number
  backgroundPoolSize: number | null
  oldestMutationSecs: number
  mutationPartsToDo: number
  failedMutations: number
  clickhouseMemoryBytes: number
  clickhouseMemoryLimitBytes: number | null
  apiMemoryBytes: number
  apiMemoryLimitBytes: number | null
  apiCpuUtilizationRatio: number | null
  openFds: number | null
  openFdsLimit: number | null
}

export interface CapacityGuideRow {
  signal: string
  threshold: string
  move: string
}

export const REQUIRED_SUSTAINED_SAMPLES = 3
const HISTORY_MAX_AGE_MS = 5 * 60_000
const MIN_SAMPLE_SPACING_MS = 10_000

export const capacityGuideRows: CapacityGuideRow[] = [
  { signal: 'Ingest spool', threshold: '70% / 85% · oldest 1m / 5m', move: 'ClickHouse write capacity; then API pods' },
  { signal: 'Read latency', threshold: '1.5s / 5s for 3 samples', move: 'Profile query families; then add ClickHouse read capacity' },
  { signal: 'Read concurrency', threshold: '70% / 90% of configured limit for 3 samples', move: 'API pods for request concurrency; ClickHouse for saturation' },
  { signal: 'Local disk', threshold: '70% / 85% on the fullest disk', move: 'Tier, add disk, or shard the retention footprint' },
  { signal: 'Parts and inserts', threshold: '150 early warning · configured delay limit urgent', move: 'Batch inserts, increase merge capacity, or shard writes' },
  { signal: 'Memory', threshold: '75% / 90% of container or host limit', move: 'Inspect large queries; then add memory or shard' },
  { signal: 'API CPU / files', threshold: '75% / 90% of available capacity', move: 'Add API replicas or raise the process limit' },
]

export function appendCapacitySnapshot(
  history: CapacitySnapshot[],
  snapshot: CapacitySnapshot,
): CapacitySnapshot[] {
  const cutoff = snapshot.capturedAt - HISTORY_MAX_AGE_MS
  const current = history.filter(sample => sample.capturedAt >= cutoff && sample.capturedAt <= snapshot.capturedAt)
  const previous = current.at(-1)
  if (previous && snapshot.capturedAt - previous.capturedAt < MIN_SAMPLE_SPACING_MS) {
    current[current.length - 1] = snapshot
  } else {
    current.push(snapshot)
  }
  return current.slice(-24)
}

export function evaluateCapacity(history: CapacitySnapshot[]): CapacityRecommendation[] {
  const latest = history.at(-1)
  if (!latest) return []

  const recommendations: CapacityRecommendation[] = []
  addIngestRecommendation(recommendations, latest)
  addReadRecommendation(recommendations, history)
  addDiskRecommendation(recommendations, latest)
  addPartsRecommendation(recommendations, history)
  addMutationRecommendation(recommendations, latest)
  addMemoryRecommendation(recommendations, history)
  addRuntimeRecommendation(recommendations, history)

  if (recommendations.length) return recommendations

  const samples = Math.min(history.length, REQUIRED_SUSTAINED_SAMPLES)
  const readEvidence = samples < REQUIRED_SUSTAINED_SAMPLES
    ? `read baseline ${samples}/${REQUIRED_SUSTAINED_SAMPLES} samples`
    : `p95 ${formatDuration(latest.queryP95Ms)} · ${formatCount(latest.activeQueries)} active SELECTs`
  return [{
    severity: 'stable',
    title: samples < REQUIRED_SUSTAINED_SAMPLES ? 'Building a read baseline' : 'No immediate scale action',
    body: samples < REQUIRED_SUSTAINED_SAMPLES
      ? 'Rush waits for three spaced samples before reporting read pressure.'
      : 'No sustained signal is above the operating thresholds.',
    evidence: readEvidence,
    action: 'Keep collecting data. Scale when pressure persists, not from a single sample.',
  }]
}

function addIngestRecommendation(items: CapacityRecommendation[], latest: CapacitySnapshot): void {
  const urgent = latest.spoolUsedPct >= 85 || latest.spoolOldestAgeSecs >= 300
  const watch = latest.spoolUsedPct >= 70 || latest.spoolOldestAgeSecs >= 60
  if (!urgent && !watch) return
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'Ingest is falling behind' : 'Ingest buffer needs watching',
    body: urgent
      ? 'Telemetry has remained in the durable buffer long enough to risk delayed visibility.'
      : 'The buffer has less room or is taking longer than expected to drain.',
    evidence: `${latest.spoolUsedPct.toFixed(1)}% spool · oldest ${formatSeconds(latest.spoolOldestAgeSecs)}`,
    action: 'Check ClickHouse write latency and insert batching before adding API pods.',
  })
}

function addReadRecommendation(items: CapacityRecommendation[], history: CapacitySnapshot[]): void {
  const latest = history.at(-1)!
  const urgent = sustained(history, sample =>
    valueAtLeast(sample.queryP95Ms, 5_000) || ratioAtLeast(sample.activeQueries, sample.queryLimit, 0.9))
  const watch = sustained(history, sample =>
    valueAtLeast(sample.queryP95Ms, 1_500) || ratioAtLeast(sample.activeQueries, sample.queryLimit, 0.7))
  if (!urgent && !watch) return

  const concurrency = latest.queryLimit && latest.queryLimit > 0
    ? `${formatCount(latest.activeQueries)} / ${formatCount(latest.queryLimit)} query limit`
    : `${formatCount(latest.activeQueries)} active SELECTs · no limit configured`
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'Sustained read pressure is high' : 'Read headroom is narrowing',
    body: 'Non-probe SELECT latency or concurrency has stayed elevated across three samples.',
    evidence: `p95 ${formatDuration(latest.queryP95Ms)} · ${concurrency}`,
    action: 'Profile slow query families. Add ClickHouse read capacity if latency remains high; add API replicas only when API concurrency is the bottleneck.',
  })
}

function addDiskRecommendation(items: CapacityRecommendation[], latest: CapacitySnapshot): void {
  if (latest.diskUsedPct === null || latest.diskUsedPct < 70) return
  const urgent = latest.diskUsedPct >= 85
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'A local ClickHouse disk is nearly full' : 'Local disk needs a plan',
    body: 'This uses the fullest local disk so free space on another volume cannot hide the risk.',
    evidence: `${latest.diskUsedPct.toFixed(1)}% used on the fullest disk`,
    action: 'Review retention and tiering. Add disk or a shard before merges run out of working space.',
  })
}

function addPartsRecommendation(items: CapacityRecommendation[], history: CapacitySnapshot[]): void {
  const latest = history.at(-1)!
  const delayThreshold = positive(latest.partsDelayThreshold)
  const watchThreshold = delayThreshold ? Math.min(150, Math.max(1, delayThreshold * 0.5)) : 150
  const rejected = counterIncreased(history, sample => sample.rejectedInsertsTotal)
  const urgent = latest.delayedInserts > 0 || rejected || (delayThreshold !== null && latest.maxParts >= delayThreshold)
  const poolSaturated = sustained(history, sample => ratioAtLeast(sample.backgroundPoolTasks, sample.backgroundPoolSize, 0.8))
  const partsGrowing = history.length >= REQUIRED_SUSTAINED_SAMPLES
    && latest.maxParts > history.at(-REQUIRED_SUSTAINED_SAMPLES)!.maxParts
  const watch = latest.maxParts >= watchThreshold || (poolSaturated && partsGrowing)
  if (!urgent && !watch) return
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'Inserts are reaching the parts boundary' : 'Part growth needs watching',
    body: urgent
      ? 'ClickHouse is delaying or rejecting inserts, or a partition reached its configured delay point.'
      : 'A partition has many active parts, or the merge pool is saturated while parts continue to grow.',
    evidence: `${formatCount(latest.maxParts)} max parts · ${formatCount(latest.delayedInserts)} delayed inserts`,
    action: 'Increase batch size and reduce tiny inserts. Add merge resources or shard writes if parts keep growing.',
  })
}

function addMutationRecommendation(items: CapacityRecommendation[], latest: CapacitySnapshot): void {
  const urgent = latest.failedMutations > 0
  const watch = latest.mutationPartsToDo > 0 && latest.oldestMutationSecs >= 900
  if (!urgent && !watch) return
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'A ClickHouse mutation has failed' : 'A mutation is taking a long time',
    body: urgent
      ? 'At least one unfinished mutation has a failure reason.'
      : 'An unfinished mutation has been running for at least 15 minutes.',
    evidence: `${formatCount(latest.mutationPartsToDo)} parts remaining · oldest ${formatSeconds(latest.oldestMutationSecs)}`,
    action: 'Inspect system.mutations for the affected table, remaining parts, and failure reason.',
  })
}

function addMemoryRecommendation(items: CapacityRecommendation[], history: CapacitySnapshot[]): void {
  const latest = history.at(-1)!
  const urgent = ratioAtLeast(latest.clickhouseMemoryBytes, latest.clickhouseMemoryLimitBytes, 0.9)
    || ratioAtLeast(latest.apiMemoryBytes, latest.apiMemoryLimitBytes, 0.9)
  const watch = sustained(history, sample =>
    ratioAtLeast(sample.clickhouseMemoryBytes, sample.clickhouseMemoryLimitBytes, 0.75)
      || ratioAtLeast(sample.apiMemoryBytes, sample.apiMemoryLimitBytes, 0.75))
  if (!urgent && !watch) return
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'Memory headroom is low' : 'Memory usage is staying high',
    body: 'Memory is measured against the container or host limit instead of a fixed byte value.',
    evidence: `API ${formatPercent(ratio(latest.apiMemoryBytes, latest.apiMemoryLimitBytes))} · ClickHouse ${formatPercent(ratio(latest.clickhouseMemoryBytes, latest.clickhouseMemoryLimitBytes))}`,
    action: 'Inspect the largest query families and caches. Raise memory limits or shard heavy workloads if usage persists.',
  })
}

function addRuntimeRecommendation(items: CapacityRecommendation[], history: CapacitySnapshot[]): void {
  const latest = history.at(-1)!
  const urgent = valueAtLeast(latest.apiCpuUtilizationRatio, 0.9)
    || ratioAtLeast(latest.openFds, latest.openFdsLimit, 0.9)
  const watch = sustained(history, sample =>
    valueAtLeast(sample.apiCpuUtilizationRatio, 0.75)
      || ratioAtLeast(sample.openFds, sample.openFdsLimit, 0.75))
  if (!urgent && !watch) return
  items.push({
    severity: urgent ? 'urgent' : 'watch',
    title: urgent ? 'API process headroom is low' : 'API process pressure is elevated',
    body: 'CPU or open files are close to the capacity available to this API process.',
    evidence: `CPU ${formatPercent(latest.apiCpuUtilizationRatio)} · files ${formatRatio(latest.openFds, latest.openFdsLimit)}`,
    action: 'Add an API replica for sustained CPU pressure. Raise the file limit only after checking for leaked connections.',
  })
}

function sustained(history: CapacitySnapshot[], predicate: (sample: CapacitySnapshot) => boolean): boolean {
  return history.length >= REQUIRED_SUSTAINED_SAMPLES
    && history.slice(-REQUIRED_SUSTAINED_SAMPLES).every(predicate)
}

function counterIncreased(history: CapacitySnapshot[], value: (sample: CapacitySnapshot) => number): boolean {
  if (history.length < 2) return false
  return value(history.at(-1)!) > value(history.at(-2)!)
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null
}

function ratio(value: number | null, limit: number | null): number | null {
  return value !== null && limit !== null && limit > 0 ? value / limit : null
}

function ratioAtLeast(value: number | null, limit: number | null, threshold: number): boolean {
  const current = ratio(value, limit)
  return current !== null && current >= threshold
}

function valueAtLeast(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold
}

function formatDuration(value: number | null): string {
  if (value === null) return 'unavailable'
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`
}

function formatSeconds(value: number): string {
  return value >= 60 ? `${Math.round(value / 60)}m` : `${Math.round(value)}s`
}

function formatCount(value: number | null): string {
  if (value === null) return 'unavailable'
  return Math.round(value).toLocaleString()
}

function formatPercent(value: number | null): string {
  return value === null ? 'limit unavailable' : `${(value * 100).toFixed(1)}%`
}

function formatRatio(value: number | null, limit: number | null): string {
  return limit && limit > 0 ? `${formatCount(value)} / ${formatCount(limit)}` : `${formatCount(value)} · limit unavailable`
}
