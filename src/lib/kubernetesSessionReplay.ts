import type { KubernetesSessionChunk, KubernetesSessionStream } from '../types'

export interface KubernetesReplayEvent {
  sequence: number
  offsetMs: number
  stream: KubernetesSessionStream
  text: string
}

export interface KubernetesSessionLifecycle {
  phase?: 'start' | 'end' | string
  protocol?: string
  decoded?: boolean
  duration_ms?: number
}

const MAX_RENDERED_TERMINAL_CHARS = 2_000_000
const textStreams = new Set(['stdin', 'stdout', 'stderr', 'error', 'resize', 'session'])

function decodeBytes(chunk: KubernetesSessionChunk): Uint8Array | null {
  if (chunk.encoding === 'utf8') return new TextEncoder().encode(chunk.data)
  if (chunk.encoding !== 'base64') return null
  try {
    const binary = atob(chunk.data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

export function decodeSessionChunks(chunks: KubernetesSessionChunk[]): KubernetesReplayEvent[] {
  const decoders = new Map<string, TextDecoder>()
  const events: KubernetesReplayEvent[] = []
  const ordered = [...chunks].sort((left, right) => left.sequence - right.sequence)
  for (const chunk of ordered) {
    if (!textStreams.has(chunk.stream)) continue
    const bytes = decodeBytes(chunk)
    if (!bytes) continue
    let decoder = decoders.get(chunk.stream)
    if (!decoder) {
      decoder = new TextDecoder('utf-8', { fatal: false })
      decoders.set(chunk.stream, decoder)
    }
    const text = decoder.decode(bytes, { stream: true })
    if (!text) continue
    events.push({
      sequence: chunk.sequence,
      offsetMs: chunk.offset_ms,
      stream: chunk.stream,
      text,
    })
  }
  return events
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
}

function applyTerminalText(current: string, incoming: string): string {
  const clean = stripTerminalControlSequences(incoming)
  let value = current
  for (const character of clean) {
    if (character === '\r') {
      const lastBreak = value.lastIndexOf('\n')
      value = value.slice(0, lastBreak + 1)
    } else if (character === '\b' || character === '\x7f') {
      value = value.slice(0, -1)
    } else if (character === '\n' || character === '\t' || character >= ' ') {
      value += character
    }
    if (value.length > MAX_RENDERED_TERMINAL_CHARS) {
      value = value.slice(value.length - MAX_RENDERED_TERMINAL_CHARS)
    }
  }
  return value
}

function isSuccessfulKubernetesStatus(value: string): boolean {
  try {
    const status = JSON.parse(value) as { status?: string }
    return status.status === 'Success'
  } catch {
    return false
  }
}

export function renderTerminalAt(
  events: KubernetesReplayEvent[],
  offsetMs = Number.POSITIVE_INFINITY,
): { text: string; truncated: boolean } {
  let text = ''
  let originalCharacters = 0
  for (const event of events) {
    if (event.offsetMs > offsetMs) break
    if (!['stdout', 'stderr', 'error'].includes(event.stream)) continue
    if (event.stream === 'error' && isSuccessfulKubernetesStatus(event.text)) continue
    originalCharacters += event.text.length
    text = applyTerminalText(text, event.text)
  }
  return {
    text,
    truncated: originalCharacters > MAX_RENDERED_TERMINAL_CHARS,
  }
}

export function sessionInputEvents(events: KubernetesReplayEvent[]): KubernetesReplayEvent[] {
  return events.filter(event => event.stream === 'stdin')
}

export function sessionLifecycle(events: KubernetesReplayEvent[]): KubernetesSessionLifecycle[] {
  return events
    .filter(event => event.stream === 'session')
    .flatMap(event => {
      try {
        return [JSON.parse(event.text) as KubernetesSessionLifecycle]
      } catch {
        return []
      }
    })
}

export function sessionDurationMs(events: KubernetesReplayEvent[]): number {
  const lifecycleDuration = sessionLifecycle(events)
    .reduce((maximum, event) => Math.max(maximum, event.duration_ms || 0), 0)
  return events.reduce(
    (maximum, event) => Math.max(maximum, event.offsetMs),
    lifecycleDuration,
  )
}

export function sessionRecordingState(chunks: KubernetesSessionChunk[]): string {
  return chunks.reduce<{ sequence: number; state: string } | null>((latest, chunk) => {
    if (!latest || chunk.sequence >= latest.sequence) {
      return { sequence: chunk.sequence, state: chunk.recording_state }
    }
    return latest
  }, null)?.state || 'partial'
}

export function readableInput(value: string): string {
  return stripTerminalControlSequences(value)
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}
