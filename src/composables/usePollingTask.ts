import { onBeforeUnmount, readonly, ref, type Ref } from 'vue'

export type PollingCategory =
  | 'alert_list'
  | 'anomaly'
  | 'capacity'
  | 'dashboard'
  | 'explore_live'
  | 'postgres_activity'
  | 'service_graph'
  | 'slo_detail'
  | 'slo_list'

export interface PollingRunContext {
  signal: AbortSignal
}

export interface PollingTaskOptions {
  category: PollingCategory
  intervalMs: number
  run: (context: PollingRunContext) => void | Promise<void>
  immediate?: boolean
  maxBackoffMs?: number
}

export interface PollingTaskState {
  active: boolean
  running: boolean
  consecutiveFailures: number
  lastDurationMs: number | null
  lastSuccessAt: number | null
  nextRunAt: number | null
  backoffMs: number | null
}

export interface PollingTaskHandle {
  state: Readonly<Ref<PollingTaskState>>
  start: () => void
  stop: () => void
  refreshNow: () => void
  setIntervalMs: (value: number) => void
}

export interface PollingMetricSummary {
  category: PollingCategory
  refreshes: number
  failures: number
  skippedOverlaps: number
  backoffs: number
  durationMsTotal: number
  durationMsMax: number
  backoffMsMax: number
}

interface PollingClock {
  now: () => number
  random: () => number
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

interface RegisteredTask extends PollingTaskOptions {
  id: number
  active: boolean
  running: boolean
  timer: ReturnType<typeof setTimeout> | null
  controller: AbortController | null
  generation: number
  resumePending: boolean
  consecutiveFailures: number
  state: Ref<PollingTaskState>
}

const DEFAULT_MAX_BACKOFF_MS = 2 * 60_000
const METRIC_FLUSH_MS = 10_000

function abortError(): Error {
  const error = new Error('The polling task was aborted.')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function retryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return null
  const value = Number((error as { retryAfterMs?: unknown }).retryAfterMs)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function freshState(): PollingTaskState {
  return {
    active: false,
    running: false,
    consecutiveFailures: 0,
    lastDurationMs: null,
    lastSuccessAt: null,
    nextRunAt: null,
    backoffMs: null,
  }
}

function updateState(task: RegisteredTask, patch: Partial<PollingTaskState>): void {
  task.state.value = { ...task.state.value, ...patch }
}

const metricCounts = new Map<PollingCategory, PollingMetricSummary>()
let metricSink: ((summaries: readonly PollingMetricSummary[]) => void) | null = null
let metricTimer: ReturnType<typeof setTimeout> | undefined

function summaryFor(category: PollingCategory): PollingMetricSummary {
  let summary = metricCounts.get(category)
  if (!summary) {
    summary = {
      category,
      refreshes: 0,
      failures: 0,
      skippedOverlaps: 0,
      backoffs: 0,
      durationMsTotal: 0,
      durationMsMax: 0,
      backoffMsMax: 0,
    }
    metricCounts.set(category, summary)
  }
  return summary
}

function scheduleMetricFlush(): void {
  if (metricSink && !metricTimer) metricTimer = setTimeout(flushPollingMetrics, METRIC_FLUSH_MS)
}

function recordRun(category: PollingCategory, durationMs: number, failed: boolean, backoffMs: number | null): void {
  const summary = summaryFor(category)
  summary.refreshes++
  summary.durationMsTotal += durationMs
  summary.durationMsMax = Math.max(summary.durationMsMax, durationMs)
  if (failed) summary.failures++
  if (backoffMs !== null) {
    summary.backoffs++
    summary.backoffMsMax = Math.max(summary.backoffMsMax, backoffMs)
  }
  scheduleMetricFlush()
}

function recordSkippedOverlap(category: PollingCategory): void {
  summaryFor(category).skippedOverlaps++
  scheduleMetricFlush()
}

export function setPollingMetricSink(
  sink: ((summaries: readonly PollingMetricSummary[]) => void) | null,
): void {
  metricSink = sink
  if (sink && metricCounts.size > 0) scheduleMetricFlush()
}

export function flushPollingMetrics(): void {
  if (metricTimer) clearTimeout(metricTimer)
  metricTimer = undefined
  if (!metricSink || metricCounts.size === 0) return
  const summaries = [...metricCounts.values()].map(summary => ({ ...summary }))
  metricCounts.clear()
  metricSink(summaries)
}

export class PollingScheduler {
  private readonly tasks = new Map<number, RegisteredTask>()
  private readonly handles = new WeakMap<PollingTaskHandle, number>()
  private readonly clock: PollingClock
  private nextId = 1
  private visible = true
  private online = true
  private suspended = false

  constructor(clock: Partial<PollingClock> = {}) {
    this.clock = {
      now: clock.now ?? Date.now,
      random: clock.random ?? Math.random,
      setTimeout: clock.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
      clearTimeout: clock.clearTimeout ?? (timer => clearTimeout(timer)),
    }
  }

  register(options: PollingTaskOptions): PollingTaskHandle {
    const id = this.nextId++
    const task: RegisteredTask = {
      ...options,
      intervalMs: Math.max(1, options.intervalMs),
      maxBackoffMs: Math.max(options.intervalMs, options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS),
      id,
      active: false,
      running: false,
      timer: null,
      controller: null,
      generation: 0,
      resumePending: false,
      consecutiveFailures: 0,
      state: ref(freshState()),
    }
    this.tasks.set(id, task)

    const handle: PollingTaskHandle = {
      state: readonly(task.state),
      start: () => this.start(id),
      stop: () => this.stop(id),
      refreshNow: () => this.refreshNow(id),
      setIntervalMs: value => this.setIntervalMs(id, value),
    }
    this.handles.set(handle, id)
    return handle
  }

  unregister(handle: PollingTaskHandle): void {
    const id = this.handles.get(handle)
    const task = id === undefined ? undefined : this.tasks.get(id)
    if (!task) return
    this.stopTask(task, true)
    this.tasks.delete(task.id)
    this.handles.delete(handle)
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) {
      for (const task of this.tasks.values()) this.pauseTask(task)
      return
    }
    this.resumeEligibleTasks()
  }

  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    if (!online) {
      for (const task of this.tasks.values()) this.pauseTask(task)
      return
    }
    this.resumeEligibleTasks()
  }

  pauseAll(): void {
    if (this.suspended) return
    this.suspended = true
    for (const task of this.tasks.values()) this.pauseTask(task)
  }

  resumeAll(): void {
    if (!this.suspended) return
    this.suspended = false
    this.resumeEligibleTasks()
  }

  stopAll(): void {
    for (const task of this.tasks.values()) this.stopTask(task, true)
    // A successful logout deactivates the old page's tasks, but a later login
    // in the same SPA must be able to register and start a fresh task set.
    this.suspended = false
  }

  private start(id: number): void {
    const task = this.tasks.get(id)
    if (!task || task.active) return
    task.active = true
    updateState(task, { active: true })
    if (!this.canRun()) return
    if (task.immediate) this.run(task)
    else this.schedule(task, task.intervalMs)
  }

  private stop(id: number): void {
    const task = this.tasks.get(id)
    if (task) this.stopTask(task, true)
  }

  private stopTask(task: RegisteredTask, deactivate: boolean): void {
    this.clearTimer(task)
    task.generation++
    task.controller?.abort(abortError())
    task.controller = null
    task.running = false
    task.resumePending = false
    task.consecutiveFailures = 0
    if (deactivate) task.active = false
    updateState(task, {
      active: task.active,
      running: false,
      consecutiveFailures: 0,
      nextRunAt: null,
      backoffMs: null,
    })
  }

  private pauseTask(task: RegisteredTask): void {
    if (!task.active) return
    this.clearTimer(task)
    task.controller?.abort(abortError())
    updateState(task, { nextRunAt: null })
  }

  private resumeEligibleTasks(): void {
    if (!this.canRun()) return
    for (const task of this.tasks.values()) {
      if (!task.active) continue
      if (task.running) task.resumePending = true
      else this.run(task)
    }
  }

  private refreshNow(id: number): void {
    const task = this.tasks.get(id)
    if (!task || !task.active || !this.canRun()) return
    if (task.running) {
      recordSkippedOverlap(task.category)
      return
    }
    this.clearTimer(task)
    this.run(task)
  }

  private setIntervalMs(id: number, value: number): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.intervalMs = Math.max(1, value)
    task.maxBackoffMs = Math.max(task.intervalMs, task.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)
    if (task.active && !task.running && this.canRun()) this.schedule(task, task.intervalMs)
  }

  private canRun(): boolean {
    return this.visible && this.online && !this.suspended
  }

  private clearTimer(task: RegisteredTask): void {
    if (task.timer === null) return
    this.clock.clearTimeout(task.timer)
    task.timer = null
  }

  private schedule(task: RegisteredTask, delayMs: number): void {
    this.clearTimer(task)
    if (!task.active || !this.canRun()) return
    updateState(task, { nextRunAt: this.clock.now() + delayMs })
    task.timer = this.clock.setTimeout(() => {
      task.timer = null
      this.run(task)
    }, delayMs)
  }

  private run(task: RegisteredTask): void {
    if (!task.active || !this.canRun()) return
    if (task.running) {
      recordSkippedOverlap(task.category)
      return
    }

    task.running = true
    const generation = ++task.generation
    const controller = new AbortController()
    task.controller = controller
    const startedAt = this.clock.now()
    updateState(task, { running: true, nextRunAt: null })

    void Promise.resolve()
      .then(() => task.run({ signal: controller.signal }))
      .then(() => {
        if (controller.signal.aborted || generation !== task.generation) return
        const durationMs = Math.max(0, this.clock.now() - startedAt)
        task.consecutiveFailures = 0
        recordRun(task.category, durationMs, false, null)
        updateState(task, {
          consecutiveFailures: 0,
          lastDurationMs: durationMs,
          lastSuccessAt: this.clock.now(),
          backoffMs: null,
        })
        this.schedule(task, task.intervalMs)
      })
      .catch(error => {
        if (controller.signal.aborted || generation !== task.generation || isAbortError(error)) return
        const durationMs = Math.max(0, this.clock.now() - startedAt)
        task.consecutiveFailures++
        const exponential = Math.min(
          task.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
          task.intervalMs * (2 ** (task.consecutiveFailures - 1)),
        )
        const jittered = Math.round(exponential * (0.8 + this.clock.random() * 0.4))
        const delayMs = Math.max(jittered, retryAfterMs(error) ?? 0)
        recordRun(task.category, durationMs, true, delayMs)
        updateState(task, {
          consecutiveFailures: task.consecutiveFailures,
          lastDurationMs: durationMs,
          backoffMs: delayMs,
        })
        this.schedule(task, delayMs)
      })
      .finally(() => {
        if (generation !== task.generation) return
        task.running = false
        task.controller = null
        updateState(task, { running: false })
        if (task.resumePending) {
          task.resumePending = false
          this.run(task)
        }
      })
  }
}

export const pollingScheduler = new PollingScheduler()

if (typeof document !== 'undefined') {
  pollingScheduler.setVisible(!document.hidden)
  document.addEventListener('visibilitychange', () => pollingScheduler.setVisible(!document.hidden))
}
if (typeof window !== 'undefined') {
  pollingScheduler.setOnline(typeof navigator === 'undefined' || navigator.onLine)
  window.addEventListener('online', () => pollingScheduler.setOnline(true))
  window.addEventListener('offline', () => pollingScheduler.setOnline(false))
}

export function pausePollingTasks(): void {
  pollingScheduler.pauseAll()
}

export function resumePollingTasks(): void {
  pollingScheduler.resumeAll()
}

export function stopPollingTasks(): void {
  pollingScheduler.stopAll()
}

export function usePollingTask(options: PollingTaskOptions): PollingTaskHandle {
  const handle = pollingScheduler.register(options)
  onBeforeUnmount(() => pollingScheduler.unregister(handle))
  return handle
}
