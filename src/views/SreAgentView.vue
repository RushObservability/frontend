<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { InvestigationSession, SreAgentModelOption } from '../types'
import InvestigationPanel from '../components/InvestigationPanel.vue'
import DataTable, { type DataTableColumn } from '../components/DataTable.vue'
import { formatInvestigationActivity, parseInvestigationTimestamp } from '../lib/investigationTime'

const { listInvestigationSessions, getSreAgentOptions } = useApi()
const route = useRoute()
const router = useRouter()

function sessionIdFromRoute(): string {
  const value = route.params.sessionId
  return Array.isArray(value) ? value[0] || '' : String(value || '')
}

const selectedSessionId = ref(sessionIdFromRoute())
const question = ref(selectedSessionId.value ? 'Saved investigation' : '')
const started = ref(Boolean(selectedSessionId.value))

// ── Model / thinking pickers (admin-defined policy) ──
// The user picks a model + thinking level per investigation from the allowed
// menu. Hidden entirely when no policy is configured (agent uses its default).
const agentModels = ref<SreAgentModelOption[]>([])
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
const activityNow = ref(Date.now())
const helpOpen = ref(false)
const helpWrapEl = ref<HTMLElement | null>(null)
let activityTimer: ReturnType<typeof setInterval> | undefined

const historyColumns: DataTableColumn[] = [
  { key: 'title', label: 'Investigation', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'updated_at', label: 'Last activity', sortable: true, align: 'right' },
]
const historySortKey = ref('updated_at')
const historySortDirection = ref<'asc' | 'desc'>('desc')

const historyRows = computed(() => {
  const rows = recentSessions.value.map((session) => ({
    id: session.id,
    title: session.title || 'Untitled investigation',
    status: session.status || 'unknown',
    updated_at: session.updated_at,
    updated_label: formatInvestigationActivity(session.updated_at, activityNow.value),
  }))

  return rows.sort((a, b) => {
    const left = historySortKey.value === 'updated_at'
      ? parseInvestigationTimestamp(a.updated_at)
      : String(a[historySortKey.value as 'title' | 'status']).toLowerCase()
    const right = historySortKey.value === 'updated_at'
      ? parseInvestigationTimestamp(b.updated_at)
      : String(b[historySortKey.value as 'title' | 'status']).toLowerCase()
    const comparison = left < right ? -1 : left > right ? 1 : 0
    return historySortDirection.value === 'asc' ? comparison : -comparison
  })
})

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
    const res = await listInvestigationSessions(8)
    recentSessions.value = res.sessions ?? []
    const selectedSession = recentSessions.value.find(session => session.id === selectedSessionId.value)
    if (selectedSession) {
      question.value = selectedSession.title || 'Untitled investigation'
    }
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

watch(() => route.params.sessionId, () => {
  const id = sessionIdFromRoute()
  if (id === selectedSessionId.value) return

  selectedSessionId.value = id
  started.value = Boolean(id)
  question.value = id ? 'Saved investigation' : ''
})

onMounted(async () => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onDocKeydown)
  activityTimer = setInterval(() => { activityNow.value = Date.now() }, 60_000)
  await checkAgent()
  await loadAgentOptions()
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onDocKeydown)
  if (activityTimer) clearInterval(activityTimer)
})

function launch(q?: string) {
  const text = q ?? question.value.trim()
  if (!text) return
  selectedSessionId.value = ''
  question.value = text
  started.value = true
  if (route.name === 'sre-agent-session') {
    void router.replace({ name: 'sre-agent' })
  }
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
  selectedSessionId.value = ''
  question.value = ''
  if (route.name === 'sre-agent-session') {
    void router.push({ name: 'sre-agent' })
  }
  // Refresh history
  listInvestigationSessions(8)
    .then(r => { recentSessions.value = r.sessions ?? [] })
    .catch(() => {})
}

function onHistorySort(key: string) {
  if (historySortKey.value === key) {
    historySortDirection.value = historySortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    historySortKey.value = key
    historySortDirection.value = key === 'updated_at' ? 'desc' : 'asc'
  }
}

function historyStatusClass(status: unknown): string {
  const value = String(status || 'unknown').toLowerCase()
  return ['active', 'completed', 'paused', 'failed'].includes(value)
    ? `history-status--${value}`
    : 'history-status--unknown'
}

function onHistoryRowClick(row: Record<string, unknown>) {
  const id = String(row.id || '')
  if (!id) return

  selectedSessionId.value = id
  question.value = String(row.title || 'Untitled investigation')
  started.value = true
  void router.push({ name: 'sre-agent-session', params: { sessionId: id } })
}

function onSessionLoaded(session: InvestigationSession) {
  const previousSessionId = selectedSessionId.value
  selectedSessionId.value = session.id
  question.value = session.title || 'Untitled investigation'
  if (session.id !== previousSessionId) {
    void router.push({ name: 'sre-agent-session', params: { sessionId: session.id } })
  }
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
          <div class="sre-page-header">
            <div class="sre-page-heading">
              <h1 class="sre-page-title">SRE Agent</h1>
              <p class="sre-page-description">Investigate issues across logs, metrics, traces, deploys, and services.</p>
            </div>
            <div class="sre-agent-state"><span class="sre-agent-state-dot"></span>Agent ready</div>
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
                      <option v-for="m in agentModels" :key="m.id" :value="m.id">{{ m.name }} · {{ m.provider }}</option>
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
            <DataTable
              class="history-table"
              :columns="historyColumns"
              :rows="historyRows"
              row-key="id"
              :sort-key="historySortKey"
              :sort-direction="historySortDirection"
              :clickable-rows="true"
              empty-label="No investigations yet. Your first one will appear here."
              @sort="onHistorySort"
              @row-click="onHistoryRowClick"
            >
              <template #cell-title="{ row }">
                <RouterLink
                  class="history-title-cell"
                  :to="{ name: 'sre-agent-session', params: { sessionId: String(row.id) } }"
                  @click.stop
                >
                  <span class="history-marker" aria-hidden="true"></span>
                  <span class="history-title">{{ row.title }}</span>
                </RouterLink>
              </template>
              <template #cell-status="{ row }">
                <span class="history-status" :class="historyStatusClass(row.status)">{{ row.status }}</span>
              </template>
              <template #cell-updated_at="{ row }">
                <span class="history-time">{{ row.updated_label }}</span>
              </template>
            </DataTable>
          </div>
        </div>
      </div>

      <!-- ── Active investigation ── -->
      <div v-else-if="!agentChecking && started" key="active" class="sre-active">
        <div class="active-topbar">
          <div class="active-identity">
            <span class="active-kicker">{{ selectedSessionId ? 'SAVED INVESTIGATION' : 'LIVE INVESTIGATION' }}</span>
            <span class="active-label">SRE Agent</span>
            <span class="active-sep">/</span>
            <span class="active-query">{{ question }}</span>
          </div>
          <div class="active-meta"><span class="status-pulse"></span>{{ selectedSessionId ? 'Session history' : 'Evidence stream' }}</div>
          <button class="new-btn" @click="reset">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New investigation
          </button>
        </div>
        <div class="panel-wrap">
          <InvestigationPanel
            :question="question"
            :initial-session-id="selectedSessionId"
            :model="selectedModel"
            :reasoning-effort="selectedEffort"
            @session-loaded="onSessionLoaded"
            @close="reset"
          />
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

/* History table content; the table shell comes from the shared DataTable. */
.history-table {
  margin-top: 15px;
}

.history-table :deep(.data-table) {
  min-width: 560px;
}

.history-title-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.history-title-cell:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--room-blue);
  outline-offset: 3px;
}

.history-title-cell:hover .history-title {
  color: var(--text-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--room-blue) 70%, transparent);
  text-underline-offset: 3px;
}

.history-marker {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border: 1px solid var(--room-blue);
  border-radius: 50%;
}

.history-title {
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  background: var(--bg-raised);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .08em;
  line-height: 1.3;
  text-transform: uppercase;
}

.history-status--active {
  border-color: var(--amber-muted);
  background: var(--amber-dim);
  color: var(--amber);
}

.history-status--completed { border-color: var(--ok-dim); background: var(--ok-dim); color: var(--ok); }
.history-status--paused { border-color: var(--amber-muted); background: var(--amber-dim); color: var(--amber); }
.history-status--failed { border-color: var(--error-dim); background: var(--error-dim); color: var(--error); }

.history-time {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
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
  --room-line: color-mix(in srgb, var(--text-primary) 11%, transparent);
  --room-blue: var(--amber);
  background: var(--bg-root);
}

.sre-page::after {
  display: none;
}

.grid-backdrop { display: none; }
.sre-idle { align-items: stretch; padding: 0 0 var(--sp-8); min-height: auto; }
.sre-idle::before { display: none; }
.sre-center { max-width: none; align-items: stretch; margin: 0; }
.sre-page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-6); margin-bottom: var(--sp-6); padding: var(--sp-1) 0 var(--sp-2); }
.sre-page-heading { min-width: 0; }
.sre-page-title { margin: 0; color: var(--text-primary); font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
.sre-page-description { margin: 6px 0 0; color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
.sre-agent-state { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; padding: 5px 8px; color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--r-pill); font: 9px var(--font-mono); letter-spacing: .04em; text-transform: uppercase; }
.sre-agent-state-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-dim); }
.sre-input-wrap { margin-top: 0; animation-delay: .08s; }
.input-label-row { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; margin-bottom: 10px; }
.input-label { color: var(--text-primary); font-size: 13px; font-weight: 650; }
.input-context { color: var(--text-muted); font-size: 11px; }
.sre-input-box { border-color: var(--border-default); border-radius: var(--r-md); background: var(--bg-surface); box-shadow: none; }
.sre-input-box:focus-within { border-color: var(--amber); box-shadow: 0 0 0 1px var(--amber-dim); }
.sre-textarea { min-height: 126px; padding: 20px 22px 16px; font-size: 16px; line-height: 1.55; }
.sre-input-footer { padding: 10px 12px; border-top-color: var(--room-line); }
.sre-send-btn { border-radius: var(--r-md); padding: 10px 15px; border-color: var(--amber); background: var(--amber); color: var(--text-inverse); font-size: 12px; font-weight: 650; letter-spacing: .01em; cursor: pointer; }
.sre-send-btn:not(.ready) { border-color: var(--room-line); background: var(--bg-raised); color: var(--text-muted); cursor: not-allowed; }
.sre-send-btn.ready:hover { background: var(--amber-hover); box-shadow: none; }
.sre-hint { font-size: 11px; }
.sre-hint kbd { border-radius: 3px; }
.help-btn { border-radius: 3px; }
.sre-picker { border-radius: 3px; }
.quick-starts, .sre-section { margin-top: var(--sp-6); animation: rise .55s .12s cubic-bezier(.16,1,.3,1) both; }
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
.agent-error-box { max-width: 590px; border-radius: var(--r-md); border-color: color-mix(in srgb, var(--error) 24%, var(--border-default)); background: color-mix(in srgb, var(--error) 6%, var(--bg-surface)); box-shadow: none; }
.agent-error-eyebrow { margin: 0 0 2px; color: var(--error); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .12em; }
.agent-error-title { color: var(--text-primary); }
.agent-retry-btn { border-radius: 3px; }

@media (max-width: 760px) {
  .sre-idle { padding: 0 0 var(--sp-6); }
  .sre-page-header { align-items: flex-start; flex-direction: column; gap: var(--sp-3); }
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
