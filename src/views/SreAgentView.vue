<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useApi } from '../composables/useApi'
import type { InvestigationSession } from '../types'
import InvestigationPanel from '../components/InvestigationPanel.vue'

const { listInvestigationSessions, getSreAgentOptions } = useApi()

const question = ref('')
const started = ref(false)

// ── Model / thinking pickers (admin-defined policy) ──
// The user picks a model + thinking level per investigation from the allowed
// menu. Hidden entirely when no policy is configured (agent uses its default).
const agentModels = ref<Array<{ id: string; reasoning: string[] }>>([])
const selectedModel = ref('')
const selectedEffort = ref('')   // '' = agent default
const selectedModelReasoning = computed(() =>
  agentModels.value.find(m => m.id === selectedModel.value)?.reasoning ?? [],
)
const showModelPicker = computed(() => agentModels.value.length > 0)

async function loadAgentOptions() {
  try {
    const opts = await getSreAgentOptions()
    agentModels.value = opts.models || []
    // Preselect the resolved default if it's in the allowed menu.
    if (opts.default_model && agentModels.value.some(m => m.id === opts.default_model)) {
      selectedModel.value = opts.default_model
    } else if (agentModels.value.length) {
      selectedModel.value = agentModels.value[0]!.id
    }
  } catch {
    // No policy / unavailable — hide the pickers, agent uses its default.
    agentModels.value = []
  }
}

const agentChecking = ref(true)
const agentDown = ref(false)

const recentSessions = ref<InvestigationSession[]>([])
const helpOpen = ref(false)
const helpWrapEl = ref<HTMLElement | null>(null)

const popoverStyle = computed(() => {
  if (!helpWrapEl.value) return {}
  const r = helpWrapEl.value.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    bottom: `${window.innerHeight - r.top + 8}px`,
    left: `${r.left}px`,
    zIndex: 9999,
  }
})

const EXAMPLES = [
  'Why is the checkout service seeing elevated error rates?',
  'What changed in the last 2 hours that could explain the p99 latency spike?',
  'Which services are most affected by the current incident?',
  'Find the root cause of slow database queries in the user-service',
  'Compare error rates between deployment versions for the payment service',
]

function onDocClick(e: MouseEvent) {
  if (!helpOpen.value) return
  const target = e.target as Node
  if (helpWrapEl.value && !helpWrapEl.value.contains(target)) {
    helpOpen.value = false
  }
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') helpOpen.value = false
}

// Re-runnable availability check: a transient agent restart shouldn't strand
// the page on the error card until a full reload.
async function checkAgent() {
  agentChecking.value = true
  try {
    const res = await listInvestigationSessions(undefined, 8)
    recentSessions.value = res.sessions ?? []
    agentDown.value = false
  } catch {
    agentDown.value = true
  } finally {
    agentChecking.value = false
  }
}

// Clear a thinking level no longer valid for the newly-selected model.
watch(selectedModel, () => {
  if (selectedEffort.value && !selectedModelReasoning.value.includes(selectedEffort.value)) {
    selectedEffort.value = ''
  }
})

onMounted(async () => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onDocKeydown)
  await checkAgent()
  await loadAgentOptions()
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onDocKeydown)
})

function launch(q?: string) {
  const text = q ?? question.value.trim()
  if (!text) return
  question.value = text
  started.value = true
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') launch()
}

function autoResize(e: Event) {
  const t = e.target as HTMLTextAreaElement
  t.style.height = 'auto'
  t.style.height = t.scrollHeight + 'px'
}

function reset() {
  started.value = false
  question.value = ''
  // Refresh history
  listInvestigationSessions(undefined, 8)
    .then(r => { recentSessions.value = r.sessions ?? [] })
    .catch(() => {})
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="sre-page">
    <transition name="sre-fade" mode="out-in">

      <!-- ── Agent down ── -->
      <div v-if="!agentChecking && agentDown" key="down" class="sre-idle sre-idle--down">
        <div class="grid-backdrop" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="grid-col"></div>
        </div>
        <div class="sre-center">
          <div class="agent-error-box">
            <div class="agent-error-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2.5"/>
              </svg>
            </div>
            <div class="agent-error-body">
              <p class="agent-error-eyebrow">SERVICE CONNECTION</p>
              <p class="agent-error-title">Investigation service is offline</p>
              <p class="agent-error-desc">The control room cannot reach the SRE Agent. Check the service health and try again when it is ready.</p>
              <button class="agent-retry-btn" :disabled="agentChecking" @click="checkAgent">
                {{ agentChecking ? 'Checking…' : 'Check connection' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Idle / landing state ── -->
      <div v-else-if="!agentChecking && !started" key="idle" class="sre-idle">

        <div class="grid-backdrop" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="grid-col"></div>
        </div>

        <div class="sre-center">
          <div class="room-signal-strip" aria-label="Available investigation signals">
            <span class="signal-strip-label">USE THE SIGNALS YOU HAVE</span>
            <span>Logs</span><i></i><span>Metrics</span><i></i><span>Traces</span><i></i><span>Deploys</span><i></i><span>Services</span>
          </div>

          <!-- Input -->
          <div class="sre-input-wrap">
            <div class="input-label-row">
              <span class="input-label">Start an investigation</span>
              <span class="input-context">Natural language · evidence-backed answers</span>
            </div>
            <div class="sre-input-box">
              <textarea
                v-model="question"
                class="sre-textarea"
                placeholder="What is happening, where, and when did it start?"
                rows="4"
                @keydown="onKeydown"
                @input="autoResize"
              ></textarea>
              <div class="sre-input-footer">
                <div class="footer-left">
                  <div class="help-wrap" ref="helpWrapEl">
                    <button class="help-btn" :class="{ active: helpOpen }" @click="helpOpen = !helpOpen" title="Show investigation patterns">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/>
                      </svg>
                      Patterns
                    </button>
                    <Teleport to="body">
                      <div v-if="helpOpen" class="help-popover" :style="popoverStyle">
                        <p class="help-popover-label">Investigation patterns</p>
                        <button
                          v-for="ex in EXAMPLES"
                          :key="ex"
                          class="help-example"
                          @click="() => { question = ex; helpOpen = false }"
                        >{{ ex }}</button>
                      </div>
                    </Teleport>
                  </div>
                  <span class="sre-hint">Run with <kbd>⌘↵</kbd></span>
                  <template v-if="showModelPicker">
                    <select v-model="selectedModel" class="sre-picker" title="Model">
                      <option v-for="m in agentModels" :key="m.id" :value="m.id">{{ m.id }}</option>
                    </select>
                    <select
                      v-if="selectedModelReasoning.length"
                      v-model="selectedEffort"
                      class="sre-picker"
                      title="Thinking level"
                    >
                      <option value="">thinking: default</option>
                      <option v-for="lvl in selectedModelReasoning" :key="lvl" :value="lvl">thinking: {{ lvl }}</option>
                    </select>
                  </template>
                </div>
                <button
                  class="sre-send-btn"
                  :class="{ ready: question.trim() }"
                  :disabled="!question.trim()"
                  @click="launch()"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  Run investigation
                </button>
              </div>
            </div>
          </div>

          <div class="quick-starts">
            <div class="section-heading">
              <div><p class="section-label">Quick starts</p><p class="section-caption">Start with a familiar incident question.</p></div>
              <span class="section-index">01 — 03</span>
            </div>
            <div class="quick-grid">
              <button v-for="(ex, idx) in EXAMPLES.slice(0, 3)" :key="ex" class="quick-card" @click="launch(ex)">
                <span class="quick-card-index">0{{ idx + 1 }}</span>
                <span class="quick-card-copy">{{ ex }}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
              </button>
            </div>
          </div>

          <!-- History -->
          <div class="sre-section" style="animation-delay: 0.2s">
            <div class="section-heading">
              <div><p class="section-label">Recent investigations</p><p class="section-caption">Pick up where your team left off.</p></div>
              <span class="section-index">{{ String(recentSessions.length).padStart(2, '0') }} SESSIONS</span>
            </div>
            <div v-if="recentSessions.length" class="history-list">
              <button
                v-for="s in recentSessions"
                :key="s.id"
                class="history-row"
                @click="launch(s.title)"
              >
                <span class="history-marker" aria-hidden="true"></span>
                <span class="history-title">{{ s.title }}</span>
                <span class="history-time">{{ formatDate(s.updated_at) }}</span>
              </button>
            </div>
            <p v-else class="history-empty">No investigations yet. Your first one will appear here.</p>
          </div>
        </div>
      </div>

      <!-- ── Active investigation ── -->
      <div v-else-if="!agentChecking && started" key="active" class="sre-active">
        <div class="active-topbar">
          <div class="active-identity">
            <span class="active-kicker">LIVE INVESTIGATION</span>
            <span class="active-label">SRE Agent</span>
            <span class="active-sep">/</span>
            <span class="active-query">{{ question }}</span>
          </div>
          <div class="active-meta"><span class="status-pulse"></span>Evidence stream</div>
          <button class="new-btn" @click="reset">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New investigation
          </button>
        </div>
        <div class="panel-wrap">
          <InvestigationPanel :question="question" :model="selectedModel" :reasoning-effort="selectedEffort" @close="reset" />
        </div>
      </div>

    </transition>
  </div>
</template>

<style scoped>
.sre-page {
  min-height: calc(100vh - 52px);
  background: var(--bg-root);
  position: relative;
  overflow: hidden;
}

/* Grid */
.grid-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  z-index: 0;
}
.grid-col {
  flex: 1;
  border-right: 1px solid rgba(59, 130, 246, 0.04);
}
.grid-col:last-child { border-right: none; }

.sre-idle::before {
  content: '';
  position: absolute;
  top: 28%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 700px;
  height: 700px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.055) 0%, transparent 65%);
  pointer-events: none;
  z-index: 0;
}

/* Layout */
.sre-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8vh 24px 60px;
  min-height: calc(100vh - 52px);
  position: relative;
}

.sre-center {
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}

/* Hero */
.sre-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 36px;
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sre-title {
  font-family: 'Figtree', sans-serif;
  font-size: clamp(36px, 5vw, 54px);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--text-primary);
  margin: 0;
}

.sre-tagline {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* Input */
.sre-input-wrap {
  width: 100%;
  animation: rise 0.55s 0.07s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.sre-input-box {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--bg-overlay);
  border-radius: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.sre-input-box:focus-within {
  border-color: rgba(59, 130, 246, 0.38);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.07), 0 6px 28px rgba(0,0,0,0.28);
}

.sre-textarea {
  width: 100%;
  background: none;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Figtree', sans-serif;
  font-size: 15px;
  color: var(--text-primary);
  line-height: 1.65;
  padding: 18px 18px 10px;
  min-height: 100px;
  max-height: 260px;
  overflow-y: auto;
  box-sizing: border-box;
}

.sre-textarea::placeholder {
  color: var(--text-muted);
}

.sre-input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--bg-overlay);
}

.sre-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.sre-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--bg-overlay);
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.sre-send-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--bg-overlay);
  background: var(--bg-raised);
  color: var(--text-muted);
  font-family: 'Figtree', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: not-allowed;
  transition: all 0.15s;
}

.sre-send-btn.ready {
  border-color: rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.1);
  color: var(--amber);
  cursor: pointer;
}

.sre-send-btn.ready:hover {
  background: rgba(59, 130, 246, 0.18);
  box-shadow: 0 0 14px rgba(59, 130, 246, 0.18);
}

/* Lower section */
.sre-section {
  width: 100%;
  margin-top: 28px;
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 0 0 10px;
}

/* Footer left group */
.footer-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Model / thinking pickers in the input footer */
.sre-picker {
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.14));
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
  color: var(--text-primary, inherit);
  cursor: pointer;
}

/* Help button + popover */
.help-wrap {
  position: relative;
}

.help-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  background: none;
  border: 1px solid var(--bg-overlay);
  border-radius: 6px;
  font-family: 'Figtree', sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.14s;
}

.help-btn:hover,
.help-btn.active {
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--amber);
  background: rgba(59, 130, 246, 0.06);
}

.help-popover {
  width: 340px;
  background: var(--bg-raised);
  border: 1px solid var(--bg-overlay);
  border-radius: 10px;
  padding: 10px 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  z-index: 10;
  animation: pop-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.help-popover-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 0 0 8px;
  padding: 0 6px;
}

.help-example {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 8px;
  border-radius: 7px;
  border: none;
  background: none;
  font-family: 'Figtree', sans-serif;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1.45;
  transition: all 0.12s;
}

.help-example:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

/* History */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--bg-overlay);
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: 'Figtree', sans-serif;
  font-size: 13px;
  transition: all 0.14s;
}

.history-row:hover {
  border-color: rgba(59, 130, 246, 0.28);
  background: var(--bg-raised);
}

.history-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.history-title {
  flex: 1;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.history-row:hover .history-title {
  color: var(--text-primary);
}

.history-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.history-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 9px 0;
  margin: 0;
}

/* Active state */
.sre-active {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 52px);
}

.active-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--bg-overlay);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.active-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.active-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--amber);
  flex-shrink: 0;
}

.active-sep { color: var(--text-muted); flex-shrink: 0; }

.active-query {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-raised);
  border: 1px solid var(--bg-overlay);
  border-radius: 7px;
  font-family: 'Figtree', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.new-btn:hover {
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--amber);
}

.panel-wrap {
  flex: 1;
  overflow: hidden;
}

/* Agent error box */
.agent-error-box {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 22px;
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.22);
  border-radius: 12px;
  max-width: 480px;
  animation: rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.agent-error-icon {
  flex-shrink: 0;
  color: #ef4444;
  margin-top: 1px;
}

.agent-error-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.agent-error-title {
  font-size: 14px;
  font-weight: 600;
  color: #ef4444;
  margin: 0;
}

.agent-error-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.55;
}

.agent-retry-btn {
  align-self: flex-start;
  margin-top: 8px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: border-color 0.12s;
}
.agent-retry-btn:hover:not(:disabled) { border-color: var(--border-strong); }
.agent-retry-btn:disabled { opacity: 0.5; cursor: default; }

/* Transitions */
.sre-fade-enter-active,
.sre-fade-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}
.sre-fade-enter-from { opacity: 0; transform: translateY(8px); }
.sre-fade-leave-to   { opacity: 0; transform: translateY(-4px); }

/* Control-room direction: restrained, evidence-first, and deliberately flat. */
.sre-page {
  --room-ink: color-mix(in srgb, var(--text-primary) 92%, #15233a);
  --room-line: color-mix(in srgb, var(--text-primary) 11%, transparent);
  --room-blue: #2563eb;
  background: var(--bg-root);
}

.sre-page::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: .07;
  background-image: linear-gradient(var(--room-line) 1px, transparent 1px);
  background-size: 100% 120px;
  mask-image: linear-gradient(to bottom, black, transparent 68%);
}

.grid-backdrop { display: none; }
.sre-idle { align-items: stretch; padding: clamp(28px, 4vh, 52px) clamp(22px, 5vw, 84px) 72px; }
.sre-idle::before { display: none; }
.sre-center { max-width: 1180px; align-items: stretch; margin: 0 auto; }
.room-signal-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 0; padding: 10px 0; border-top: 1px solid var(--room-line); border-bottom: 1px solid var(--room-line); color: var(--text-secondary); font-family: var(--font-mono); font-size: 10px; letter-spacing: .04em; animation: rise .55s .04s cubic-bezier(.16,1,.3,1) both; }
.signal-strip-label { margin-right: 8px; color: var(--text-muted); font-size: 9px; letter-spacing: .12em; }
.room-signal-strip i { width: 3px; height: 3px; border-radius: 50%; background: var(--room-blue); opacity: .75; }
.sre-input-wrap { margin-top: 28px; animation-delay: .08s; }
.input-label-row { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; margin-bottom: 10px; }
.input-label { color: var(--text-primary); font-size: 13px; font-weight: 650; }
.input-context { color: var(--text-muted); font-size: 11px; }
.sre-input-box { border-color: var(--room-line); border-radius: 4px; background: var(--bg-surface); box-shadow: 0 10px 24px color-mix(in srgb, #101828 5%, transparent); }
.sre-input-box:focus-within { border-color: color-mix(in srgb, var(--room-blue) 58%, var(--room-line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--room-blue) 10%, transparent), 0 18px 44px color-mix(in srgb, #101828 10%, transparent); }
.sre-textarea { min-height: 126px; padding: 20px 22px 16px; font-size: 16px; line-height: 1.55; }
.sre-input-footer { padding: 10px 12px; border-top-color: var(--room-line); }
.sre-send-btn { border-radius: 3px; padding: 10px 15px; border-color: var(--room-blue); background: var(--room-blue); color: white; font-size: 12px; font-weight: 650; letter-spacing: .01em; cursor: pointer; }
.sre-send-btn:not(.ready) { border-color: var(--room-line); background: var(--bg-raised); color: var(--text-muted); cursor: not-allowed; }
.sre-send-btn.ready:hover { background: #1d4ed8; box-shadow: none; }
.sre-hint { font-size: 11px; }
.sre-hint kbd { border-radius: 3px; }
.help-btn { border-radius: 3px; }
.sre-picker { border-radius: 3px; }
.quick-starts, .sre-section { margin-top: 42px; animation: rise .55s .12s cubic-bezier(.16,1,.3,1) both; }
.section-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; }
.section-label { margin: 0; color: var(--text-primary); font-size: 11px; letter-spacing: .12em; }
.section-caption { margin: 5px 0 0; color: var(--text-muted); font-size: 12px; }
.section-index { color: var(--text-muted); font-family: var(--font-mono); font-size: 9px; letter-spacing: .1em; }
.quick-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 15px; }
.quick-card { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: start; min-height: 94px; padding: 15px; text-align: left; border: 1px solid var(--room-line); border-radius: 3px; background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; transition: border-color .16s, background .16s, transform .16s; }
.quick-card:hover { border-color: color-mix(in srgb, var(--room-blue) 52%, var(--room-line)); background: var(--bg-surface); transform: translateY(-2px); }
.quick-card-index { color: var(--room-blue); font-family: var(--font-mono); font-size: 10px; }
.quick-card-copy { font-size: 12px; line-height: 1.45; }
.quick-card svg { color: var(--text-muted); }
.history-list { gap: 0; margin-top: 15px; border-top: 1px solid var(--room-line); }
.history-row { min-height: 45px; padding: 9px 4px; border: 0; border-bottom: 1px solid var(--room-line); border-radius: 0; background: transparent; }
.history-row:hover { border-color: var(--room-line); background: color-mix(in srgb, var(--room-blue) 5%, transparent); }
.history-marker { width: 5px; height: 5px; flex: 0 0 auto; border: 1px solid var(--room-blue); border-radius: 50%; }
.history-title { color: var(--text-secondary); font-size: 12px; }
.history-time { font-size: 10px; }
.history-empty { padding: 15px 0; font-size: 12px; }
.sre-active { height: calc(100vh - 52px); background: var(--bg-root); }
.active-topbar { min-height: 58px; padding: 10px clamp(18px, 3vw, 42px); border-bottom-color: var(--room-line); background: color-mix(in srgb, var(--bg-surface) 78%, transparent); }
.active-identity { gap: 10px; }
.active-kicker { color: var(--text-muted); font-family: var(--font-mono); font-size: 9px; letter-spacing: .12em; }
.active-label { color: var(--text-primary); font-size: 12px; }
.active-sep { color: var(--room-blue); }
.active-query { max-width: 52vw; font-size: 12px; }
.active-meta { display: flex; align-items: center; gap: 8px; margin-left: auto; margin-right: 18px; color: var(--text-muted); font-family: var(--font-mono); font-size: 9px; letter-spacing: .05em; }
.new-btn { border-radius: 3px; padding: 8px 12px; border-color: var(--room-line); }
.panel-wrap { padding: 18px clamp(14px, 3vw, 42px) 28px; }
.agent-error-box { max-width: 590px; border-radius: 3px; border-color: color-mix(in srgb, #dc2626 24%, var(--room-line)); background: color-mix(in srgb, #dc2626 6%, var(--bg-surface)); box-shadow: 0 18px 44px color-mix(in srgb, #101828 8%, transparent); }
.agent-error-eyebrow { margin: 0 0 2px; color: #dc2626; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .12em; }
.agent-error-title { color: var(--text-primary); }
.agent-retry-btn { border-radius: 3px; }

@media (max-width: 760px) {
  .sre-idle { padding: 34px 18px 48px; }
  .quick-grid { grid-template-columns: 1fr; }
  .input-label-row { display: block; }
  .input-context { display: block; margin-top: 4px; }
  .sre-input-footer { align-items: flex-end; }
  .footer-left { gap: 8px; }
  .sre-hint { display: none; }
  .active-kicker, .active-meta, .active-sep { display: none; }
  .active-query { max-width: 62vw; }
  .panel-wrap { padding: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .sre-page *, .sre-page *::before, .sre-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

</style>
