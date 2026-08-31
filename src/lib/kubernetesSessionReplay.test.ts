import { describe, expect, it } from 'vitest'
import type { KubernetesSessionChunk } from '../types'
import {
  decodeSessionChunks,
  readableInput,
  renderTerminalAt,
  sessionDurationMs,
  sessionInputEvents,
  sessionLifecycle,
  sessionRecordingState,
} from './kubernetesSessionReplay'

function chunk(
  sequence: number,
  stream: string,
  text: string,
  offsetMs: number,
): KubernetesSessionChunk {
  return {
    id: `chunk-${sequence}`,
    session_id: 'session-1',
    event_id: 'event-1',
    gateway_id: 'gateway-1',
    sequence,
    stream,
    encoding: 'base64',
    recording_state: stream === 'session' ? 'complete' : 'recording',
    offset_ms: offsetMs,
    data: btoa(text),
    byte_count: text.length,
    redaction_count: 0,
    created_at: '2026-08-22T12:00:00Z',
  }
}

describe('Kubernetes terminal replay', () => {
  it('orders and separates terminal channels', () => {
    const events = decodeSessionChunks([
      chunk(3, 'stdout', 'ready\r\n', 200),
      chunk(1, 'stdin', 'echo ready\r', 100),
      chunk(2, 'stderr', 'warning\n', 150),
    ])
    expect(events.map(event => event.stream)).toEqual(['stdin', 'stderr', 'stdout'])
    expect(sessionInputEvents(events)[0]?.text).toBe('echo ready\r')
    expect(renderTerminalAt(events).text).toBe('warning\nready\n')
  })

  it('applies common terminal control sequences without displaying escape bytes', () => {
    const events = decodeSessionChunks([
      chunk(1, 'stdout', '\u001b[32mbooting\u001b[0m\rready\b!', 50),
    ])
    expect(renderTerminalAt(events).text).toBe('read!')
  })

  it('hides the Kubernetes success envelope but keeps real error output', () => {
    const events = decodeSessionChunks([
      chunk(1, 'error', 'permission denied\n', 50),
      chunk(2, 'error', '{"metadata":{},"status":"Success"}', 100),
    ])
    expect(renderTerminalAt(events).text).toBe('permission denied\n')
  })

  it('uses lifecycle duration and ignores raw protocol chunks', () => {
    const lifecycle = JSON.stringify({ phase: 'end', protocol: 'v5.channel.k8s.io', duration_ms: 4200 })
    const events = decodeSessionChunks([
      chunk(1, 'raw_upgrade_output', 'opaque', 9000),
      chunk(2, 'session', lifecycle, 4200),
    ])
    expect(sessionDurationMs(events)).toBe(4200)
    expect(sessionLifecycle(events)[0]?.protocol).toBe('v5.channel.k8s.io')
  })

  it('uses the final chunk as the authoritative recording state', () => {
    const chunks = [
      chunk(2, 'session', '{"phase":"end"}', 4200),
      chunk(1, 'stdout', 'ready\n', 50),
    ]
    expect(sessionRecordingState(chunks)).toBe('complete')
  })

  it('makes recorded input readable without preserving control bytes', () => {
    expect(readableInput('echo one\r\u0003echo two\r')).toBe('echo one\necho two\n')
  })
})
