export type AnalyticsRequestMetric = 'hit' | 'dedup' | 'cancel' | 'miss' | 'eviction'

export interface AnalyticsRequestScope {
  userId: string
  tenant: string
  method: string
  route: string
  /** Response-affecting request variant such as interactive vs dashboard. */
  variant?: string
  body?: BodyInit | null
}

export interface AnalyticsRequestOptions {
  signal?: AbortSignal
  /** Different semantic requests in this group supersede the prior subscriber. */
  supersedeKey?: string
  /** Fresh cache lifetime. Zero disables response caching but keeps deduplication. */
  ttlMs?: number
  /** Optional stale-while-revalidate lifetime after ttlMs. */
  staleMs?: number
}

interface CacheEntry {
  scope: AnalyticsRequestScope
  body: string
  bytes: number
  freshUntil: number
  staleUntil: number
  lastAccess: number
}

interface InFlightEntry {
  scope: AnalyticsRequestScope
  controller: AbortController
  promise: Promise<string>
  subscribers: number
  background: boolean
  settled: boolean
}

interface SupersessionEntry {
  semanticKey: string
  controller: AbortController
}

export interface AnalyticsRequestCoordinatorConfig {
  maxEntries?: number
  maxBytes?: number
  now?: () => number
  metric?: (metric: AnalyticsRequestMetric) => void
}

const DEFAULT_MAX_ENTRIES = 128
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const METRIC_FLUSH_MS = 10_000

function abortError(): Error {
  const error = new Error('The request was aborted.')
  error.name = 'AbortError'
  return error
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, stableValue(object[key])]))
  }
  return value
}

/** Canonical JSON keeps semantic keys stable when object property order differs. */
export function canonicalizeRequestBody(body?: BodyInit | null): string {
  if (body === undefined || body === null) return ''
  if (typeof body !== 'string') return String(body)
  try {
    return JSON.stringify(stableValue(JSON.parse(body)))
  } catch {
    return body
  }
}

export function semanticRequestKey(scope: AnalyticsRequestScope): string {
  // JSON tuple encoding prevents delimiter ambiguity while retaining the exact
  // canonical body. Keys never leave memory or enter telemetry attributes.
  return JSON.stringify([
    scope.userId,
    scope.tenant,
    scope.method.toUpperCase(),
    scope.route,
    scope.variant || '',
    canonicalizeRequestBody(scope.body),
  ])
}

function scopeMatches(
  scope: AnalyticsRequestScope,
  target?: { userId?: string; tenant?: string },
): boolean {
  return (!target?.userId || scope.userId === target.userId)
    && (!target?.tenant || scope.tenant === target.tenant)
}

function waitForOperation(
  promise: Promise<string>,
  signals: Array<AbortSignal | undefined>,
): Promise<string> {
  const aborted = signals.find(signal => signal?.aborted)
  if (aborted) return Promise.reject(aborted.reason ?? abortError())

  return new Promise((resolve, reject) => {
    let finished = false
    const cleanup = () => {
      for (const signal of signals) signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (event: Event) => {
      if (finished) return
      finished = true
      cleanup()
      const signal = event.target as AbortSignal
      reject(signal.reason ?? abortError())
    }
    for (const signal of signals) signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      body => {
        if (finished) return
        finished = true
        cleanup()
        const racedAbort = signals.find(signal => signal?.aborted)
        if (racedAbort) reject(racedAbort.reason ?? abortError())
        else resolve(body)
      },
      error => {
        if (finished) return
        finished = true
        cleanup()
        reject(error)
      },
    )
  })
}

export class AnalyticsRequestCoordinator {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, InFlightEntry>()
  private readonly supersessions = new Map<string, SupersessionEntry>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly now: () => number
  private readonly metric: (metric: AnalyticsRequestMetric) => void
  private cacheBytes = 0

  constructor(config: AnalyticsRequestCoordinatorConfig = {}) {
    this.maxEntries = Math.max(1, config.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.maxBytes = Math.max(1, config.maxBytes ?? DEFAULT_MAX_BYTES)
    this.now = config.now ?? Date.now
    this.metric = config.metric ?? (() => {})
  }

  async run(
    scope: AnalyticsRequestScope,
    execute: (signal: AbortSignal) => Promise<string>,
    options: AnalyticsRequestOptions = {},
  ): Promise<string> {
    const key = semanticRequestKey(scope)
    const groupKey = options.supersedeKey
      ? JSON.stringify([scope.userId, scope.tenant, options.supersedeKey])
      : undefined
    let group: SupersessionEntry | undefined

    if (groupKey) {
      const active = this.supersessions.get(groupKey)
      if (active?.semanticKey === key) group = active
      else {
        active?.controller.abort(abortError())
        group = { semanticKey: key, controller: new AbortController() }
        this.supersessions.set(groupKey, group)
      }
    }

    const now = this.now()
    const cached = this.cache.get(key)
    if (cached && cached.staleUntil > now) {
      cached.lastAccess = now
      this.metric('hit')
      if (cached.freshUntil <= now && (options.staleMs ?? 0) > 0) {
        this.ensureOperation(key, scope, execute, options, true).promise.catch(() => {})
      }
      this.clearSupersession(groupKey, group)
      return cached.body
    }
    if (cached) this.deleteCacheEntry(key, cached)
    let operation = this.inFlight.get(key)
    if (operation) this.metric('dedup')
    else {
      this.metric('miss')
      operation = this.ensureOperation(key, scope, execute, options, false)
    }
    operation.subscribers++

    try {
      return await waitForOperation(operation.promise, [options.signal, group?.controller.signal])
    } catch (error) {
      if (options.signal?.aborted || group?.controller.signal.aborted) this.metric('cancel')
      throw error
    } finally {
      operation.subscribers--
      if (operation.subscribers === 0 && !operation.background && !operation.settled) {
        operation.controller.abort(abortError())
      }
      this.clearSupersession(groupKey, group)
    }
  }

  invalidate(target?: { userId?: string; tenant?: string }): void {
    for (const [key, entry] of this.cache) {
      if (scopeMatches(entry.scope, target)) this.deleteCacheEntry(key, entry)
    }
    for (const [key, entry] of this.inFlight) {
      if (!scopeMatches(entry.scope, target)) continue
      entry.controller.abort(abortError())
      this.inFlight.delete(key)
    }
    for (const [key, entry] of this.supersessions) {
      const [userId, tenant] = JSON.parse(key) as [string, string]
      if ((!target?.userId || userId === target.userId) && (!target?.tenant || tenant === target.tenant)) {
        entry.controller.abort(abortError())
        this.supersessions.delete(key)
      }
    }
  }

  stats(): { entries: number; bytes: number; inFlight: number } {
    return { entries: this.cache.size, bytes: this.cacheBytes, inFlight: this.inFlight.size }
  }

  private ensureOperation(
    key: string,
    scope: AnalyticsRequestScope,
    execute: (signal: AbortSignal) => Promise<string>,
    options: AnalyticsRequestOptions,
    background: boolean,
  ): InFlightEntry {
    const existing = this.inFlight.get(key)
    if (existing) {
      this.metric('dedup')
      if (background) existing.background = true
      return existing
    }

    const controller = new AbortController()
    const entry: InFlightEntry = {
      scope,
      controller,
      promise: Promise.resolve(''),
      subscribers: 0,
      background,
      settled: false,
    }
    entry.promise = execute(controller.signal)
      .then(body => {
        if (!controller.signal.aborted && (options.ttlMs ?? 0) > 0) {
          this.store(key, scope, body, options.ttlMs!, options.staleMs ?? 0)
        }
        return body
      })
      .finally(() => {
        entry.settled = true
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key)
      })

    this.inFlight.set(key, entry)
    return entry
  }

  private store(
    key: string,
    scope: AnalyticsRequestScope,
    body: string,
    ttlMs: number,
    staleMs: number,
  ): void {
    // Count both retained response text and the exact semantic key so a large
    // query body cannot bypass the byte budget through Map-key storage.
    const bytes = (key.length + body.length) * 2
    if (bytes > this.maxBytes) return
    const existing = this.cache.get(key)
    if (existing) this.deleteCacheEntry(key, existing)
    const now = this.now()
    const entry: CacheEntry = {
      scope: { ...scope, body: undefined },
      body,
      bytes,
      freshUntil: now + Math.max(0, ttlMs),
      staleUntil: now + Math.max(0, ttlMs) + Math.max(0, staleMs),
      lastAccess: now,
    }
    this.cache.set(key, entry)
    this.cacheBytes += bytes
    while (this.cache.size > this.maxEntries || this.cacheBytes > this.maxBytes) {
      const oldest = [...this.cache.entries()].reduce((candidate, current) =>
        current[1].lastAccess < candidate[1].lastAccess ? current : candidate)
      this.deleteCacheEntry(oldest[0], oldest[1])
      this.metric('eviction')
    }
  }

  private deleteCacheEntry(key: string, entry: CacheEntry): void {
    if (!this.cache.delete(key)) return
    this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes)
  }

  private clearSupersession(key?: string, entry?: SupersessionEntry): void {
    if (key && entry && this.supersessions.get(key) === entry) this.supersessions.delete(key)
  }
}

const metricCounts: Record<AnalyticsRequestMetric, number> = {
  hit: 0,
  dedup: 0,
  cancel: 0,
  miss: 0,
  eviction: 0,
}
let metricSink: ((counts: Readonly<Record<AnalyticsRequestMetric, number>>) => void) | null = null
let metricTimer: ReturnType<typeof setTimeout> | undefined

function recordMetric(metric: AnalyticsRequestMetric): void {
  metricCounts[metric]++
  if (metricSink && !metricTimer) metricTimer = setTimeout(flushAnalyticsRequestMetrics, METRIC_FLUSH_MS)
}

export function setAnalyticsRequestMetricSink(
  sink: ((counts: Readonly<Record<AnalyticsRequestMetric, number>>) => void) | null,
): void {
  metricSink = sink
  if (sink && Object.values(metricCounts).some(Boolean) && !metricTimer) {
    metricTimer = setTimeout(flushAnalyticsRequestMetrics, METRIC_FLUSH_MS)
  }
}

export function flushAnalyticsRequestMetrics(): void {
  if (metricTimer) clearTimeout(metricTimer)
  metricTimer = undefined
  if (!metricSink || !Object.values(metricCounts).some(Boolean)) return
  metricSink({ ...metricCounts })
  for (const metric of Object.keys(metricCounts) as AnalyticsRequestMetric[]) metricCounts[metric] = 0
}

export const analyticsRequestCoordinator = new AnalyticsRequestCoordinator({ metric: recordMetric })

export function invalidateAnalyticsRequests(target?: { userId?: string; tenant?: string }): void {
  analyticsRequestCoordinator.invalidate(target)
}

/** Only JSON read/query endpoints belong here. Mutating POSTs must invalidate. */
export function isIdempotentAnalyticsPost(route: string, method: string): boolean {
  if (method.toUpperCase() !== 'POST') return false
  return /^\/(?:query(?:\/count|\/timeseries|\/group)?|explore\/search|logs(?:\/context|\/detail|\/histogram|\/count|\/group)?|stats|bubbleup|rum\/(?:query|vitals|pages|errors|sessions)|monitors\/(?:preview|suggest))$/.test(route)
    || /^\/funnels\/[^/]+\/run$/.test(route)
    || /^\/detection\/rules\/[^/]+\/test$/.test(route)
    || /^\/anomaly-events\/[^/]+\/analyze$/.test(route)
}
