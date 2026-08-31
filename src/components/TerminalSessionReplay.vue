<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { KubernetesSessionChunk } from '../types'
import {
  decodeSessionChunks,
  readableInput,
  renderTerminalAt,
  sessionDurationMs,
  sessionInputEvents,
  sessionLifecycle,
} from '../lib/kubernetesSessionReplay'

const props = withDefaults(defineProps<{
  chunks?: KubernetesSessionChunk[]
  loading?: boolean
  error?: string | null
}>(), {
  chunks: () => [],
  loading: false,
  error: null,
})

const emit = defineEmits<{ retry: [] }>()
const events = computed(() => decodeSessionChunks(props.chunks))
const duration = computed(() => sessionDurationMs(events.value))
const lifecycle = computed(() => sessionLifecycle(events.value))
const protocol = computed(() => lifecycle.value.find(item => item.protocol)?.protocol || 'Kubernetes exec')
const recordingState = computed(() => props.chunks[props.chunks.length - 1]?.recording_state || 'partial')
const totalBytes = computed(() => props.chunks.reduce((sum, chunk) => sum + (chunk.byte_count || 0), 0))
const decoded = computed(() => props.chunks.some(chunk => ['stdin', 'stdout', 'stderr', 'error'].includes(chunk.stream)))
const inputEvents = computed(() => sessionInputEvents(events.value))

const playing = ref(false)
const playhead = ref(0)
const speed = ref(1)
const revealInput = ref(false)
const terminal = ref<HTMLElement | null>(null)
let animationFrame = 0
let previousFrame = 0

const rendered = computed(() => renderTerminalAt(events.value, playhead.value))
const visibleInputs = computed(() => inputEvents.value.filter(event => event.offsetMs <= playhead.value))

watch(duration, value => {
  if (!playing.value) playhead.value = value
}, { immediate: true })

watch(playhead, async () => {
  await nextTick()
  if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight
})

watch(playing, value => {
  cancelAnimationFrame(animationFrame)
  previousFrame = 0
  if (value) animationFrame = requestAnimationFrame(tick)
})

function tick(timestamp: number) {
  if (!playing.value) return
  if (previousFrame) playhead.value = Math.min(duration.value, playhead.value + (timestamp - previousFrame) * speed.value)
  previousFrame = timestamp
  if (playhead.value >= duration.value) {
    playing.value = false
    return
  }
  animationFrame = requestAnimationFrame(tick)
}

function togglePlayback() {
  if (playhead.value >= duration.value) playhead.value = 0
  playing.value = !playing.value
}

function restart() {
  playing.value = false
  playhead.value = 0
}

function seek(event: Event) {
  playing.value = false
  playhead.value = Number((event.target as HTMLInputElement).value)
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0:00'
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onBeforeUnmount(() => cancelAnimationFrame(animationFrame))
</script>

<template>
  <div class="session-replay">
    <div v-if="loading" class="replay-state" role="status">Loading terminal recording...</div>
    <div v-else-if="error" class="replay-state replay-state--error" role="alert">
      <span>{{ error }}</span>
      <button type="button" @click="emit('retry')">Retry</button>
    </div>
    <div v-else-if="!chunks.length" class="replay-state">
      No terminal recording was stored for this request.
    </div>
    <template v-else>
      <div class="replay-summary">
        <div class="replay-identity">
          <span class="recording-dot" :class="`recording-dot--${recordingState}`" aria-hidden="true"></span>
          <div>
            <strong>{{ decoded ? 'Terminal replay' : 'Raw protocol capture' }}</strong>
            <span>{{ protocol }}</span>
          </div>
        </div>
        <dl>
          <div><dt>Duration</dt><dd>{{ formatDuration(duration) }}</dd></div>
          <div><dt>Captured</dt><dd>{{ formatBytes(totalBytes) }}</dd></div>
          <div><dt>Input</dt><dd>{{ inputEvents.length ? 'Recorded' : 'None' }}</dd></div>
        </dl>
      </div>

      <div v-if="decoded" class="terminal-shell">
        <div class="terminal-chrome">
          <span>stdout / stderr</span>
          <span>{{ formatDuration(playhead) }} / {{ formatDuration(duration) }}</span>
        </div>
        <pre ref="terminal" tabindex="0" aria-label="Recorded terminal output">{{ rendered.text || 'Waiting for terminal output...' }}<span v-if="playing" class="terminal-cursor" aria-hidden="true"></span></pre>
        <div v-if="rendered.truncated" class="terminal-notice">The player is showing the latest 2 million characters.</div>
      </div>
      <div v-else class="raw-capture-note">
        Rush retained both directions, but this older SPDY or unknown protocol cannot be replayed as terminal text.
      </div>

      <div v-if="decoded" class="replay-controls">
        <button type="button" class="replay-primary" :disabled="duration === 0" @click="togglePlayback">
          {{ playing ? 'Pause' : playhead >= duration ? 'Replay' : 'Play' }}
        </button>
        <button type="button" :disabled="playhead === 0" @click="restart">Start over</button>
        <input
          :value="playhead"
          type="range"
          min="0"
          :max="Math.max(duration, 1)"
          step="25"
          aria-label="Session playback position"
          @input="seek"
        />
        <label>
          <span>Speed</span>
          <select v-model.number="speed" aria-label="Playback speed">
            <option :value="0.5">0.5x</option>
            <option :value="1">1x</option>
            <option :value="2">2x</option>
            <option :value="4">4x</option>
          </select>
        </label>
      </div>

      <div v-if="inputEvents.length" class="input-evidence">
        <div class="input-evidence-head">
          <div>
            <strong>Recorded input</strong>
            <span>May contain credentials or other sensitive text.</span>
          </div>
          <button type="button" @click="revealInput = !revealInput">
            {{ revealInput ? 'Hide input' : 'Reveal input' }}
          </button>
        </div>
        <ol v-if="revealInput">
          <li v-for="event in visibleInputs" :key="event.sequence">
            <time>{{ formatDuration(event.offsetMs) }}</time>
            <pre>{{ readableInput(event.text) || '[control input]' }}</pre>
          </li>
        </ol>
      </div>
    </template>
  </div>
</template>

<style scoped>
.session-replay { display: grid; min-width: 0; gap: var(--sp-3); container-type: inline-size; }
.replay-state { display: flex; min-height: 148px; align-items: center; justify-content: center; gap: var(--sp-2); color: var(--text-muted); border: 1px dashed var(--border-default); font-size: 12px; }
.replay-state--error { color: var(--error); }
.replay-state button,
.replay-controls button,
.input-evidence button { padding: 5px 8px; color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--r-sm); font-size: 10px; font-weight: 650; cursor: pointer; }
.replay-state button:hover,
.replay-controls button:hover,
.input-evidence button:hover { color: var(--text-primary); border-color: var(--border-strong); }
.replay-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.replay-identity { display: flex; min-width: 0; align-items: center; gap: 9px; }
.replay-identity > div { display: grid; gap: 2px; }
.replay-identity strong { font-size: 12px; }
.replay-identity span { color: var(--text-muted); font: 9px var(--font-mono); }
.recording-dot { width: 8px; height: 8px; flex: 0 0 auto; background: var(--warning); border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 14%, transparent); }
.recording-dot--complete { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 14%, transparent); }
.recording-dot--failed { background: var(--error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 14%, transparent); }
.replay-summary dl { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin: 0; }
.replay-summary dl div { display: grid; gap: 1px; text-align: right; }
.replay-summary dt { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.replay-summary dd { margin: 0; color: var(--text-secondary); font: 10px var(--font-mono); }
.terminal-shell { overflow: hidden; background: #11171c; border: 1px solid color-mix(in srgb, var(--blue) 18%, #243039); border-radius: var(--r-sm); }
.terminal-chrome { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; color: #91a3b0; background: #172027; border-bottom: 1px solid #26333c; font: 9px var(--font-mono); text-transform: uppercase; letter-spacing: .04em; }
.terminal-shell pre { min-height: 220px; max-height: 440px; margin: 0; overflow: auto; padding: 14px; color: #d9e3e8; background: transparent; outline: none; font: 11px/1.55 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.terminal-shell pre:focus-visible { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--blue) 55%, transparent); }
.terminal-cursor { display: inline-block; width: 6px; height: 1.15em; margin-left: 1px; vertical-align: -2px; background: #87b9de; animation: cursor-blink 1s steps(2, jump-none) infinite; }
.terminal-notice { padding: 6px 10px; color: #d7b46a; background: #211f18; border-top: 1px solid #393226; font-size: 10px; }
.raw-capture-note { padding: 12px; color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, var(--bg-raised)); border: 1px solid color-mix(in srgb, var(--warning) 25%, var(--border-default)); font-size: 11px; line-height: 1.5; }
.replay-controls { display: grid; grid-template-columns: auto auto minmax(120px, 1fr) auto; align-items: center; gap: 7px; }
.replay-controls .replay-primary { color: var(--bg-base); background: var(--blue); border-color: var(--blue); }
.replay-controls button:disabled { opacity: .45; cursor: default; }
.replay-controls input { width: 100%; accent-color: var(--blue); }
.replay-controls label { display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 10px; }
.replay-controls select { padding: 4px 6px; color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--r-sm); font: 10px var(--font-mono); }
.input-evidence { border-top: 1px solid var(--border-subtle); }
.input-evidence-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding-top: var(--sp-2); }
.input-evidence-head > div { display: grid; gap: 2px; }
.input-evidence-head strong { font-size: 11px; }
.input-evidence-head span { color: var(--text-muted); font-size: 10px; }
.input-evidence ol { display: grid; max-height: 220px; margin: var(--sp-2) 0 0; padding: 0; overflow: auto; list-style: none; border: 1px solid var(--border-subtle); }
.input-evidence li { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--border-subtle); }
.input-evidence li:last-child { border-bottom: 0; }
.input-evidence time { color: var(--text-muted); font: 9px var(--font-mono); }
.input-evidence pre { margin: 0; color: var(--text-secondary); font: 10px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
@keyframes cursor-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .terminal-cursor { animation: none; } }
@container (max-width: 560px) {
  .replay-summary { display: grid; }
  .replay-summary dl { justify-content: flex-start; }
  .replay-summary dl div { text-align: left; }
  .replay-controls { grid-template-columns: auto auto 1fr; }
  .replay-controls label { grid-column: 1 / -1; }
}
</style>
