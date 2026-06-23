<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'

// rrweb Replayer is loaded dynamically so this view doesn't bloat the main bundle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let replayer: any = null

const route  = useRoute()
const router = useRouter()
const api    = useApi()

const sessionId = computed(() => route.params.sessionId as string)
const appName   = computed(() => route.params.appName   as string)

const playerRoot  = ref<HTMLDivElement | null>(null)
const loading     = ref(false)
const error       = ref('')
const playing     = ref(false)
const totalMs     = ref(0)
const currentMs   = ref(0)
const eventCount  = ref(0)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAndPlay(events: any[]) {
  if (!playerRoot.value || events.length === 0) return

  const { Replayer } = await import('rrweb')

  if (replayer) {
    replayer.destroy()
    replayer = null
    playerRoot.value.innerHTML = ''
  }

  replayer = new Replayer(events, {
    root: playerRoot.value,
    speed: 1,
    skipInactive: true,
    showWarning: true,
    showDebug: false,
  })

  replayer.on('finish', () => {
    playing.value = false
  })
  replayer.on('state-change', (_s: unknown) => {
    try {
      currentMs.value = replayer.getCurrentTime() || 0
    } catch { /* ignore */ }
  })

  // Scale the rrweb iframe to fit the player container
  replayer.on('resize', ({ width, height }: { width: number; height: number }) => {
    if (!playerRoot.value) return
    const containerW = playerRoot.value.clientWidth
    const containerH = playerRoot.value.clientHeight
    const scale = Math.min(containerW / width, containerH / height, 1)
    const wrapper = playerRoot.value.querySelector('.replayer-wrapper') as HTMLElement | null
    if (wrapper) wrapper.style.transform = `scale(${scale})`
  })

  const meta = replayer.getMetaData()
  totalMs.value = meta.totalTime
  eventCount.value = events.length

  replayer.play()
  playing.value = true
}

async function fetchReplay() {
  loading.value = true
  error.value = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[] = []
  try {
    const res = await api.rumReplay(sessionId.value)
    if (!res.events || res.events.length === 0) {
      error.value = 'No replay data found for this session.'
      return
    }
    events = res.events
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load replay.'
    return
  } finally {
    loading.value = false
  }
  // Wait for Vue to render the playerRoot div (v-else) before mounting Replayer
  await nextTick()
  await loadAndPlay(events)
}

function togglePlay() {
  if (!replayer) return
  if (playing.value) {
    replayer.pause()
    playing.value = false
  } else {
    replayer.play()
    playing.value = true
  }
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Poll current time while playing
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchReplay()
  pollTimer = setInterval(() => {
    if (replayer && playing.value) {
      try { currentMs.value = replayer.getCurrentTime() || 0 } catch { /* ignore */ }
    }
  }, 500)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (replayer) {
    try { replayer.destroy() } catch { /* ignore */ }
    replayer = null
  }
})
</script>

<template>
  <div class="replay-page">
    <!-- Header -->
    <div class="replay-header">
      <div class="replay-header-left">
        <button class="back-btn" @click="router.push(`/rum/${encodeURIComponent(appName)}`)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          {{ appName }}
        </button>
        <h2 class="page-title">Session Replay</h2>
        <span class="session-badge mono">{{ sessionId.slice(0, 8) }}…</span>
      </div>

      <div class="replay-controls" v-if="!loading && !error && totalMs > 0">
        <button class="ctrl-btn" @click="togglePlay">
          {{ playing ? '⏸' : '▶' }}
        </button>
        <div class="time-display">
          {{ formatMs(currentMs) }} / {{ formatMs(totalMs) }}
        </div>
        <div class="progress-bar" @click.stop>
          <div class="progress-fill"
               :style="{ width: totalMs > 0 ? `${(currentMs / totalMs) * 100}%` : '0%' }">
          </div>
        </div>
        <span class="event-count muted">{{ eventCount }} events</span>
      </div>
    </div>

    <!-- Player area -->
    <div class="replay-stage">
      <div v-if="loading" class="replay-center muted">Loading replay…</div>
      <div v-else-if="error" class="replay-center replay-error">{{ error }}</div>
      <div v-else ref="playerRoot" class="player-root"></div>
    </div>
  </div>
</template>

<style scoped>
.replay-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.replay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.replay-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.back-btn:hover { background: var(--hover); color: var(--text); }

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.session-badge {
  font-size: 11px;
  color: var(--muted);
  background: var(--hover);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ─── Playback controls ─── */

.replay-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  max-width: 600px;
}

.ctrl-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
}
.ctrl-btn:hover { background: var(--hover); }

.time-display {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}
.progress-fill {
  height: 100%;
  background: var(--accent, #3b82f6);
  border-radius: 2px;
  transition: width 0.5s linear;
}

.event-count {
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ─── Stage ─── */

.replay-stage {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px;
  background: var(--bg-subtle, #0d0d0f);
}

.replay-center {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 14px;
}

.replay-error { color: var(--red, #ef4444); }

.player-root {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* Scale the rrweb iframe to fit our container */
.player-root :deep(.replayer-wrapper) {
  transform-origin: top left;
}

.player-root :deep(iframe) {
  display: block;
}

.muted { color: var(--muted); }
.mono  { font-family: monospace; }
</style>
