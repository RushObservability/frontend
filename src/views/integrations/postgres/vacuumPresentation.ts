export type VacuumPhaseId =
  | 'initializing'
  | 'scanning-heap'
  | 'vacuuming-indexes'
  | 'vacuuming-heap'
  | 'cleaning-indexes'
  | 'truncating-heap'
  | 'final-cleanup'
  | 'unknown'

export interface VacuumPhaseDefinition {
  id: Exclude<VacuumPhaseId, 'unknown'>
  code: number
  label: string
  shortLabel: string
  meaning: string
}

export const VACUUM_PHASES: VacuumPhaseDefinition[] = [
  {
    id: 'initializing',
    code: 1,
    label: 'Initializing',
    shortLabel: 'Prepare',
    meaning: 'PostgreSQL is preparing the table and deciding what work is needed. This phase is usually brief.',
  },
  {
    id: 'scanning-heap',
    code: 2,
    label: 'Scanning table',
    shortLabel: 'Scan table',
    meaning: 'Reads table pages, finds dead row versions, and freezes old rows when needed.',
  },
  {
    id: 'vacuuming-indexes',
    code: 3,
    label: 'Cleaning indexes',
    shortLabel: 'Clean indexes',
    meaning: 'Removes index entries that point to dead rows. This phase can repeat when the dead-row buffer fills.',
  },
  {
    id: 'vacuuming-heap',
    code: 4,
    label: 'Reclaiming table space',
    shortLabel: 'Reclaim space',
    meaning: 'Marks space from removed rows reusable inside the table. PostgreSQL may return to the scan afterward.',
  },
  {
    id: 'cleaning-indexes',
    code: 5,
    label: 'Finishing index cleanup',
    shortLabel: 'Finish indexes',
    meaning: 'Runs final index-specific cleanup after dead entries have been removed.',
  },
  {
    id: 'truncating-heap',
    code: 6,
    label: 'Truncating table',
    shortLabel: 'Trim table',
    meaning: 'Returns empty pages at the end of the table to the operating system.',
  },
  {
    id: 'final-cleanup',
    code: 7,
    label: 'Final cleanup',
    shortLabel: 'Finish',
    meaning: 'Updates free-space and table statistics before VACUUM exits.',
  },
]

const UNKNOWN_PHASE: Omit<VacuumPhaseDefinition, 'id'> & { id: 'unknown' } = {
  id: 'unknown',
  code: 0,
  label: 'Working',
  shortLabel: 'Working',
  meaning: 'PostgreSQL reported a VACUUM phase this version of Rush does not recognize yet.',
}

export type TimelineState = 'complete' | 'current' | 'upcoming'
export type EstimateConfidence = 'high' | 'medium' | 'low' | 'none'
export type ProgressPoint = [timestampSeconds: number, value: number]

export interface VacuumEstimateInput {
  phase: VacuumPhaseId
  elapsedSeconds: number
  totalBlocks: number
  scannedBlocks: number
  vacuumedBlocks: number
  totalIndexes: number
  processedIndexes: number
  recentProgress?: ProgressPoint[]
}

export interface VacuumEstimate {
  progress: number | null
  etaSeconds: number | null
  confidence: EstimateConfidence
  status: string
}

export function phaseFromCode(code: number): VacuumPhaseId {
  return VACUUM_PHASES.find((phase) => phase.code === Math.round(code))?.id ?? 'unknown'
}

export function phaseFromPostgresName(name: string): VacuumPhaseId {
  const normalized = name.trim().toLowerCase()
  const names: Record<string, VacuumPhaseId> = {
    initializing: 'initializing',
    'scanning heap': 'scanning-heap',
    'vacuuming indexes': 'vacuuming-indexes',
    'vacuuming heap': 'vacuuming-heap',
    'cleaning up indexes': 'cleaning-indexes',
    'truncating heap': 'truncating-heap',
    'performing final cleanup': 'final-cleanup',
  }
  return names[normalized] ?? 'unknown'
}

export function phaseDefinition(phase: VacuumPhaseId): VacuumPhaseDefinition | typeof UNKNOWN_PHASE {
  return VACUUM_PHASES.find((item) => item.id === phase) ?? UNKNOWN_PHASE
}

export function timelineState(current: VacuumPhaseId, candidate: VacuumPhaseId): TimelineState {
  const currentIndex = VACUUM_PHASES.findIndex((phase) => phase.id === current)
  const candidateIndex = VACUUM_PHASES.findIndex((phase) => phase.id === candidate)
  if (candidateIndex < 0 || currentIndex < 0) return 'upcoming'
  if (candidateIndex === currentIndex) return 'current'
  return candidateIndex < currentIndex ? 'complete' : 'upcoming'
}

export function phaseProgressMetric(phase: VacuumPhaseId): string | null {
  if (phase === 'scanning-heap') return 'postgresql_vacuum_heap_blocks_scanned'
  if (phase === 'vacuuming-heap') return 'postgresql_vacuum_heap_blocks_vacuumed'
  if (phase === 'vacuuming-indexes' || phase === 'cleaning-indexes') return 'postgresql_vacuum_indexes_processed'
  return null
}

function boundedRatio(done: number, total: number): number | null {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(1, done / total))
}

function progressValues(input: VacuumEstimateInput): { done: number; total: number } | null {
  if (input.phase === 'scanning-heap') return { done: input.scannedBlocks, total: input.totalBlocks }
  if (input.phase === 'vacuuming-heap') return { done: input.vacuumedBlocks, total: input.totalBlocks }
  if (input.phase === 'vacuuming-indexes' || input.phase === 'cleaning-indexes') {
    return { done: input.processedIndexes, total: input.totalIndexes }
  }
  return null
}

/** Uses the latest monotonic segment so a repeated VACUUM pass cannot poison the rate. */
export function recentRate(points: ProgressPoint[] = []): { value: number; confidence: 'high' | 'medium' } | null {
  const clean = points
    .filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0])
  if (clean.length < 2) return null

  let segmentStart = 0
  for (let index = 1; index < clean.length; index += 1) {
    if (clean[index]![1] < clean[index - 1]![1]) segmentStart = index
  }
  const segment = clean.slice(segmentStart)
  const last = segment[segment.length - 1]!
  const firstMoving = segment.find((point) => point[1] < last[1])
  if (!firstMoving) return null
  const span = last[0] - firstMoving[0]
  const delta = last[1] - firstMoving[1]
  if (span < 30 || delta <= 0) return null
  return { value: delta / span, confidence: span >= 180 ? 'high' : 'medium' }
}

export function estimateVacuumPhase(input: VacuumEstimateInput): VacuumEstimate {
  const values = progressValues(input)
  const progress = values ? boundedRatio(values.done, values.total) : null
  const rate = recentRate(input.recentProgress)

  if (values && progress !== null && progress >= 1) {
    return { progress, etaSeconds: 0, confidence: 'medium', status: 'Waiting for PostgreSQL to advance' }
  }
  if (values && rate) {
    const remaining = Math.max(0, values.total - values.done)
    return {
      progress,
      etaSeconds: remaining / rate.value,
      confidence: rate.confidence,
      status: 'Estimated from recent movement',
    }
  }
  // The heap scan starts near the beginning of a VACUUM, so elapsed time gives
  // a useful fallback. It is deliberately marked low confidence.
  if (input.phase === 'scanning-heap' && progress && progress > 0.02 && input.elapsedSeconds >= 30) {
    return {
      progress,
      etaSeconds: input.elapsedSeconds * (1 - progress) / progress,
      confidence: 'low',
      status: 'Rough estimate until more samples arrive',
    }
  }
  if (input.phase === 'initializing') {
    return { progress: null, etaSeconds: null, confidence: 'none', status: 'Usually a brief phase' }
  }
  if (input.phase === 'truncating-heap' || input.phase === 'final-cleanup') {
    return { progress: null, etaSeconds: null, confidence: 'none', status: 'Finishing; PostgreSQL exposes no useful denominator' }
  }
  return { progress, etaSeconds: null, confidence: 'none', status: 'Waiting for enough movement to estimate' }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return 'under 1 min'
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600)
    const minutes = Math.round((seconds % 3_600) / 60)
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const days = Math.floor(seconds / 86_400)
  const hours = Math.round((seconds % 86_400) / 3_600)
  return hours ? `${days}d ${hours}h` : `${days}d`
}
