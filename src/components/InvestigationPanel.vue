<script setup lang="ts">
import { ref, nextTick, watch, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import type { InvestigationSession, InvestigationTemplate } from '../types'

interface AgentEvent {
  type: 'thinking_delta' | 'tool_call' | 'tool_result' | 'summary' | 'error' | 'done' | 'session_created'
  text?: string
  name?: string
  args?: Record<string, unknown>
  data?: string
  message?: string
  rounds?: number
  prompt_tokens?: number
  completion_tokens?: number
  model?: string
  kind?: 'final' | 'preliminary' | 'question'
  session_id?: string
}

interface Turn {
  question: string
  events: AgentEvent[]
  reportKind?: 'final' | 'preliminary' | 'question'
  done: boolean
}

const props = defineProps<{
  eventId?: string
  question?: string
  additionalContext?: string
  /** User-chosen model for this investigation (validated server-side). */
  model?: string
  /** User-chosen thinking level (validated server-side against the policy). */
  reasoningEffort?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const api = useApi()

// ── Session state ──
const sessionId = ref('')
const sessionTitle = ref('')
const sessions = ref<InvestigationSession[]>([])
const showSidebar = ref(false)
const showTemplatePicker = ref(false)
const templates = ref<InvestigationTemplate[]>([])

// ── Multi-turn state ──
const turns = ref<Turn[]>([])
const currentTurnIdx = ref(-1)

// Per-turn streaming state
const thinking = ref('')
const running = ref(false)
const done = ref(false)
const errorMsg = ref('')
const abortController = ref<AbortController | null>(null)
const streamEl = ref<HTMLElement | null>(null)
const collapsedResults = ref<Set<string>>(new Set())

// Follow-up input
const followUpText = ref('')
const sessionActive = computed(() => turns.value.length > 0 && !running.value && done.value)
const isQuestionPending = computed(() => {
  if (turns.value.length === 0) return false
  const lastTurn = turns.value[turns.value.length - 1]
  return lastTurn?.reportKind === 'question' && lastTurn.done
})

function resultKey(turnIdx: number, eventIdx: number): string {
  return `${turnIdx}:${eventIdx}`
}
function toggleResult(turnIdx: number, eventIdx: number) {
  const key = resultKey(turnIdx, eventIdx)
  if (collapsedResults.value.has(key)) {
    collapsedResults.value.delete(key)
  } else {
    collapsedResults.value.add(key)
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (streamEl.value) {
      streamEl.value.scrollTop = streamEl.value.scrollHeight
    }
  })
}

watch(turns, scrollToBottom, { deep: true })
watch(thinking, scrollToBottom)

function currentTurn(): Turn | null {
  if (currentTurnIdx.value < 0 || currentTurnIdx.value >= turns.value.length) return null
  return turns.value[currentTurnIdx.value] ?? null
}

function pushEventToCurrentTurn(event: AgentEvent) {
  const t = currentTurn()
  if (!t) return
  t.events.push(event)
}

function handleEvent(event: AgentEvent) {
  const t = currentTurn()
  if (!t) return

  switch (event.type) {
    case 'session_created':
      // Store the session ID from the server
      if (event.session_id) {
        sessionId.value = event.session_id
      }
      break
    case 'thinking_delta':
      thinking.value += event.text || ''
      break
    case 'tool_call':
      if (thinking.value) {
        pushEventToCurrentTurn({ type: 'thinking_delta', text: thinking.value })
        thinking.value = ''
      }
      pushEventToCurrentTurn(event)
      break
    case 'tool_result':
      pushEventToCurrentTurn(event)
      if ((event.data || '').length > 500) {
        collapsedResults.value.add(resultKey(currentTurnIdx.value, t.events.length - 1))
      }
      break
    case 'summary':
      if (thinking.value) {
        pushEventToCurrentTurn({ type: 'thinking_delta', text: thinking.value })
        thinking.value = ''
      }
      t.reportKind = event.kind || 'final'
      pushEventToCurrentTurn(event)
      break
    case 'error':
      errorMsg.value = event.message || 'Unknown error'
      pushEventToCurrentTurn(event)
      break
    case 'done':
      done.value = true
      t.done = true
      // Capture session_id from Done event if not already set
      if (event.session_id && !sessionId.value) {
        sessionId.value = event.session_id
      }
      pushEventToCurrentTurn(event)
      // Refresh sessions list
      loadSessions()
      break
  }
}

async function streamInvestigation(body: Record<string, unknown>) {
  running.value = true
  done.value = false
  errorMsg.value = ''
  thinking.value = ''

  const controller = new AbortController()
  abortController.value = controller

  try {
    const resp = await fetch('/api/v1/investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const text = await resp.text()
      errorMsg.value = `${resp.status}: ${text}`
      running.value = false
      return
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const json = trimmed.slice(6)
        if (json === '[DONE]') continue

        try {
          const event: AgentEvent = JSON.parse(json)
          handleEvent(event)
        } catch {
          // skip malformed
        }
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      errorMsg.value = e.message || 'Connection failed'
    }
  } finally {
    running.value = false
    abortController.value = null
  }
}

// ── Load sessions sidebar ──
async function loadSessions() {
  try {
    const result = await api.listInvestigationSessions()
    sessions.value = result.sessions || []
  } catch {
    // Silently fail — sidebar is non-critical
  }
}

// ── Load templates ──
async function loadTemplates() {
  try {
    const result = await api.listInvestigationTemplates()
    templates.value = result.templates || []
  } catch {
    // Silently fail
  }
}

// ── Load a previous session ──
async function loadSession(id: string) {
  try {
    const result = await api.getInvestigationSession(id)
    sessionId.value = id
    sessionTitle.value = result.session.title
    showSidebar.value = false

    // Reconstruct turns from server data
    turns.value = []
    const serverTurns = result.turns || []
    for (const t of serverTurns) {
      if (t.role === 'user') {
        turns.value.push({
          question: t.content,
          events: [],
          done: true,
        })
      } else if (t.role === 'assistant') {
        // Find the matching user turn or create one
        if (turns.value.length === 0) {
          turns.value.push({ question: 'Investigation', events: [], done: true })
        }
        const lastTurn = turns.value[turns.value.length - 1]!
        lastTurn.events.push({
          type: 'summary',
          text: t.content,
          kind: (t.report_kind as 'final' | 'preliminary' | 'question') || 'final',
        })
        lastTurn.reportKind = (t.report_kind as 'final' | 'preliminary' | 'question') || 'final'
        lastTurn.done = true
      }
    }
    currentTurnIdx.value = turns.value.length - 1
    done.value = true
  } catch (e: any) {
    errorMsg.value = e.message || 'Failed to load session'
  }
}

// ── Archive a session ──
async function archiveSession(id: string) {
  try {
    await api.deleteInvestigationSession(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (sessionId.value === id) {
      resetToNew()
    }
  } catch {
    // ignore
  }
}

// ── Initial investigation (turn 0) ──
async function start(templateId?: string) {
  showTemplatePicker.value = false
  // Reset to a fresh session
  sessionId.value = ''
  sessionTitle.value = ''
  turns.value = [
    {
      question: props.question || props.eventId || 'Investigation',
      events: [],
      done: false,
    },
  ]
  currentTurnIdx.value = 0
  collapsedResults.value = new Set()

  await streamInvestigation({
    event_id: props.eventId || '',
    question: props.question || '',
    additional_context: props.additionalContext || '',
    template_id: templateId || '',
    model: props.model || '',
    reasoning_effort: props.reasoningEffort || '',
  })
}

// ── Start from template ──
async function startFromTemplate(template: InvestigationTemplate) {
  showTemplatePicker.value = false
  sessionId.value = ''
  sessionTitle.value = ''
  const question = `[${template.name}] ${props.question || 'Investigate'}`
  turns.value = [
    {
      question,
      events: [],
      done: false,
    },
  ]
  currentTurnIdx.value = 0
  collapsedResults.value = new Set()

  await streamInvestigation({
    event_id: props.eventId || '',
    question: props.question || '',
    additional_context: props.additionalContext || '',
    template_id: template.id,
    model: props.model || '',
    reasoning_effort: props.reasoningEffort || '',
  })
}

// ── Follow-up investigation (new turn) ──
async function submitFollowUp() {
  if (!followUpText.value.trim() || running.value) return
  const newQuestion = followUpText.value.trim()
  followUpText.value = ''

  // Start a new turn
  turns.value.push({ question: newQuestion, events: [], done: false })
  currentTurnIdx.value = turns.value.length - 1

  await streamInvestigation({
    session_id: sessionId.value,
    question: newQuestion,
    model: props.model || '',
    reasoning_effort: props.reasoningEffort || '',
  })
}

function stop() {
  abortController.value?.abort()
  running.value = false
}

function resetToNew() {
  sessionId.value = ''
  sessionTitle.value = ''
  turns.value = []
  currentTurnIdx.value = -1
  done.value = false
  thinking.value = ''
  errorMsg.value = ''
  showTemplatePicker.value = false
}

function restart() {
  start()
}

function toggleSidebar() {
  showSidebar.value = !showSidebar.value
  if (showSidebar.value) {
    loadSessions()
  }
}

function openTemplatePicker() {
  loadTemplates()
  showTemplatePicker.value = true
}

// ── Token / cost helpers ──

/** Per-million-token pricing for known models. [input, output] */
const MODEL_PRICING: Record<string, [number, number]> = {
  // GPT-5 family
  'gpt-5':              [2.50,  10.00],
  // GPT-4o family
  'gpt-4o':             [2.50,  10.00],
  'gpt-4o-mini':        [0.15,   0.60],
  // GPT-4 family
  'gpt-4-turbo':        [10.00, 30.00],
  'gpt-4':              [30.00, 60.00],
  // GPT-3.5
  'gpt-3.5-turbo':      [0.50,   1.50],
  // Claude Opus
  'claude-opus-4-6':    [15.00, 75.00],
  'claude-opus-4-5':    [15.00, 75.00],
  'claude-opus':        [15.00, 75.00],
  // Claude Sonnet
  'claude-sonnet-4-6':  [3.00,  15.00],
  'claude-sonnet-4-5':  [3.00,  15.00],
  'claude-sonnet':      [3.00,  15.00],
  // Claude Haiku
  'claude-haiku-4-5':   [0.80,   4.00],
  'claude-haiku':       [0.80,   4.00],
}

function modelPricing(model: string): [number, number] | null {
  if (!model) return null
  const m = model.toLowerCase()
  // Exact match
  if (MODEL_PRICING[m]) return MODEL_PRICING[m]
  // Prefix match: model starts with a known key  (e.g. "gpt-4o-2024-05-13" → "gpt-4o")
  // or key starts with model prefix (unlikely but safe)
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (m.startsWith(key) || key.startsWith(m)) return price
  }
  // Family fallback: strip trailing version suffix and try again
  // e.g. "gpt-5.4" → "gpt-5", "claude-3-5-sonnet" → "claude-sonnet"
  const families: [RegExp, string][] = [
    [/^gpt-5/, 'gpt-5'],
    [/^gpt-4o/, 'gpt-4o'],
    [/^gpt-4/, 'gpt-4'],
    [/^gpt-3/, 'gpt-3.5-turbo'],
    [/claude.*opus/, 'claude-opus'],
    [/claude.*sonnet/, 'claude-sonnet'],
    [/claude.*haiku/, 'claude-haiku'],
  ]
  for (const [re, key] of families) {
    if (re.test(m) && MODEL_PRICING[key]) return MODEL_PRICING[key]
  }
  return null
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): string {
  if (!model) return ''
  const pricing = modelPricing(model)
  if (!pricing) return '? pricing unknown'
  const cost = (promptTokens / 1_000_000) * pricing[0] + (completionTokens / 1_000_000) * pricing[1]
  if (cost < 0.001) return '<$0.001'
  return `~$${cost.toFixed(3)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Accumulate token stats across all done events in all turns. */
const sessionTokenStats = computed(() => {
  let prompt = 0, completion = 0, model = ''
  for (const turn of turns.value) {
    for (const ev of turn.events) {
      if (ev.type === 'done') {
        prompt += ev.prompt_tokens || 0
        completion += ev.completion_tokens || 0
        if (ev.model) model = ev.model
      }
    }
  }
  return { prompt, completion, model, total: prompt + completion }
})

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

// Auto-start on mount
onMounted(() => {
  loadSessions()
  if (props.question || props.eventId) {
    start()
  }
})
</script>

<template>
  <div class="investigation-panel" :class="{ 'has-sidebar': showSidebar }">
    <!-- Session sidebar -->
    <div v-if="showSidebar" class="session-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Sessions</span>
        <button class="btn btn-sm btn-ghost" @click="showSidebar = false">&times;</button>
      </div>
      <button class="btn btn-sm sidebar-new-btn" @click="resetToNew(); showSidebar = false">
        + New investigation
      </button>
      <button class="btn btn-sm sidebar-template-btn" @click="openTemplatePicker(); showSidebar = false">
        Use template...
      </button>
      <div class="session-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === sessionId }"
          @click="loadSession(session.id)"
        >
          <div class="session-item-title">{{ session.title || 'Untitled' }}</div>
          <div class="session-item-meta">
            <span class="session-status-badge" :class="session.status">{{ session.status }}</span>
            <span>{{ timeAgo(session.updated_at) }}</span>
          </div>
          <button class="session-archive-btn" @click.stop="archiveSession(session.id)" title="Archive">
            &times;
          </button>
        </div>
        <div v-if="sessions.length === 0" class="session-empty">No sessions yet</div>
      </div>
    </div>

    <!-- Main panel -->
    <div class="investigation-main">
      <div class="investigation-header">
        <div class="investigation-title">
          <button class="btn btn-sm btn-ghost sidebar-toggle" @click="toggleSidebar" title="Sessions">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span v-if="sessionTitle">{{ sessionTitle }}</span>
          <span v-else>SRE Investigation</span>
          <span class="investigation-status" v-if="running">Running...</span>
          <span class="investigation-status done" v-else-if="done && turns.length > 0">
            {{ turns.length > 1 ? `${turns.length} turns` : 'Complete' }}
          </span>
        </div>
        <div class="investigation-actions">
          <button v-if="running" class="btn btn-sm btn-danger" @click="stop">Stop</button>
          <button v-else-if="done" class="btn btn-sm" @click="restart" title="Discard session and start over">
            Re-investigate
          </button>
          <button class="btn btn-sm btn-ghost" @click="emit('close')">&times;</button>
        </div>
      </div>

      <!-- Template picker -->
      <div v-if="showTemplatePicker && !running && turns.length === 0" class="template-picker">
        <div class="template-picker-header">
          <span>Choose a template</span>
          <button class="btn btn-sm btn-ghost" @click="showTemplatePicker = false">&times;</button>
        </div>
        <div class="template-grid">
          <div
            v-for="tmpl in templates"
            :key="tmpl.id"
            class="template-card"
            @click="startFromTemplate(tmpl)"
          >
            <div class="template-name">{{ tmpl.name }}</div>
            <div class="template-desc">{{ tmpl.description }}</div>
          </div>
        </div>
      </div>

      <!-- No-content state -->
      <div v-if="turns.length === 0 && !showTemplatePicker" class="investigation-empty">
        <p>Start a new investigation or select a previous session from the sidebar.</p>
        <div class="empty-actions">
          <button class="btn btn-sm" @click="openTemplatePicker">Use a template</button>
          <button v-if="props.question || props.eventId" class="btn btn-sm btn-primary" @click="start()">
            Start investigation
          </button>
        </div>
      </div>

      <div class="investigation-stream" ref="streamEl">
        <!-- Per-turn cards -->
        <div
          v-for="(turn, tIdx) in turns"
          :key="tIdx"
          class="turn-card"
          :class="{ 'turn-current': tIdx === currentTurnIdx && running }"
        >
          <div v-if="tIdx > 0" class="turn-header">
            <span class="turn-label">Follow-up {{ tIdx }}</span>
            <span class="turn-question">"{{ turn.question }}"</span>
          </div>

          <div class="turn-events">
            <template v-for="(event, ei) in turn.events" :key="ei">
              <!-- Thinking -->
              <div v-if="event.type === 'thinking_delta'" class="stream-thinking">
                <div class="stream-icon">🤔</div>
                <div class="stream-content thinking-text">{{ event.text }}</div>
              </div>

              <!-- Tool Call -->
              <div v-else-if="event.type === 'tool_call'" class="stream-tool-call">
                <div class="stream-icon">🔧</div>
                <div class="stream-content">
                  <span class="tool-badge">{{ event.name }}</span>
                  <pre class="tool-args">{{ JSON.stringify(event.args, null, 2) }}</pre>
                </div>
              </div>

              <!-- Tool Result -->
              <div v-else-if="event.type === 'tool_result'" class="stream-tool-result">
                <div class="stream-icon">📊</div>
                <div class="stream-content">
                  <div class="result-header" @click="toggleResult(tIdx, ei)">
                    <span>{{ event.name }} result</span>
                    <span class="collapse-toggle">
                      {{ collapsedResults.has(resultKey(tIdx, ei)) ? '▸ expand' : '▾ collapse' }}
                    </span>
                  </div>
                  <pre v-if="!collapsedResults.has(resultKey(tIdx, ei))" class="tool-result-data">{{ event.data }}</pre>
                  <span v-else class="result-collapsed">{{ (event.data || '').split('\n')[0] }}...</span>
                </div>
              </div>

              <!-- Summary -->
              <div v-else-if="event.type === 'summary'" class="stream-summary">
                <div class="stream-icon">{{ event.kind === 'question' ? '❓' : '📋' }}</div>
                <div class="stream-content">
                  <div v-if="event.kind === 'question'" class="summary-kind question">
                    ? Agent needs input
                  </div>
                  <div v-else-if="event.kind === 'preliminary'" class="summary-kind preliminary">
                    ⚡ Preliminary findings
                  </div>
                  <div v-else class="summary-kind final">✓ Final report</div>
                  <div class="summary-text" v-html="renderMarkdown(event.text || '')"></div>
                </div>
              </div>

              <!-- LLM not configured: setup guidance, not a failure -->
              <div
                v-else-if="event.type === 'error' && (event.message || '').startsWith('LLM not configured')"
                class="stream-setup"
              >
                <div class="stream-setup-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18v3h3l5.3-5.3a4.5 4.5 0 0 0 6.4-6.4l-2.6 2.6-2.1-2.1z"/>
                  </svg>
                </div>
                <div class="stream-setup-body">
                  <div class="stream-setup-title">The SRE agent isn't connected to an LLM yet</div>
                  <div class="stream-setup-text">
                    Investigations need a model to reason with. An admin can enable them by setting
                    <code class="mono">LLM_API_KEY</code> on the sre-agent service — plus
                    <code class="mono">LLM_MODEL</code> / <code class="mono">LLM_BASE_URL</code> for
                    non-OpenAI providers — and restarting it. Everything else in Rush works without it.
                  </div>
                </div>
              </div>

              <!-- Error -->
              <div v-else-if="event.type === 'error'" class="stream-error">
                <div class="stream-icon">❌</div>
                <div class="stream-content">{{ event.message }}</div>
              </div>

              <!-- Done -->
              <div v-else-if="event.type === 'done'" class="stream-done">
                <span class="done-label">{{ tIdx > 0 ? 'Follow-up' : 'Investigation' }} complete</span>
                <span class="done-sep">·</span>
                <span class="done-rounds">{{ event.rounds }} rounds</span>
                <span class="done-sep">·</span>
                <span class="done-tokens">
                  <span class="token-in" title="Input tokens">↑ {{ formatTokens(event.prompt_tokens || 0) }}</span>
                  <span class="done-sep">/</span>
                  <span class="token-out" title="Output tokens">↓ {{ formatTokens(event.completion_tokens || 0) }}</span>
                </span>
                <template v-if="event.model">
                  <span class="done-sep">·</span>
                  <span class="done-model">{{ event.model }}</span>
                  <span class="done-sep">·</span>
                  <span class="done-cost">{{ estimateCost(event.model, event.prompt_tokens || 0, event.completion_tokens || 0) }}</span>
                </template>
              </div>
            </template>
          </div>
        </div>

        <!-- Live thinking indicator (for the current turn) -->
        <div v-if="thinking" class="stream-thinking live">
          <div class="stream-icon">🤔</div>
          <div class="stream-content thinking-text">{{ thinking }}<span class="cursor">▍</span></div>
        </div>

        <!-- Loading spinner on first turn -->
        <div v-if="running && !thinking && turns.length > 0 && turns[currentTurnIdx]?.events.length === 0" class="stream-loading">
          Starting investigation...
        </div>

        <!-- Session cost summary (multi-turn total) -->
        <div v-if="done && turns.length > 1 && sessionTokenStats.total > 0" class="session-cost-bar">
          <span class="cost-label">Session total</span>
          <span class="cost-sep">·</span>
          <span class="cost-tokens">
            ↑ {{ formatTokens(sessionTokenStats.prompt) }} / ↓ {{ formatTokens(sessionTokenStats.completion) }}
            <span class="cost-total">({{ formatTokens(sessionTokenStats.total) }} total)</span>
          </span>
          <template v-if="sessionTokenStats.model">
            <span class="cost-sep">·</span>
            <span class="cost-model">{{ sessionTokenStats.model }}</span>
            <span class="cost-sep">·</span>
            <span class="cost-estimate">est. {{ estimateCost(sessionTokenStats.model, sessionTokenStats.prompt, sessionTokenStats.completion) }}</span>
          </template>
        </div>
      </div>

      <!-- Follow-up input (shown when session active or agent asked a question) -->
      <div v-if="sessionActive || isQuestionPending" class="followup-section">
        <div class="followup-header">
          <span
            class="followup-label"
            :class="{
              preliminary: turns[turns.length - 1]?.reportKind === 'preliminary',
              question: turns[turns.length - 1]?.reportKind === 'question',
            }"
          >
            {{
              turns[turns.length - 1]?.reportKind === 'question'
                ? '❓ The agent is asking for your input'
                : turns[turns.length - 1]?.reportKind === 'preliminary'
                  ? '⚡ Preliminary findings — ask a follow-up to continue'
                  : '✓ Investigation complete — ask a follow-up to refine'
            }}
          </span>
        </div>
        <div class="followup-input">
          <textarea
            v-model="followUpText"
            :placeholder="
              isQuestionPending
                ? 'Type your response to the agent\'s question...'
                : 'Ask a follow-up: \'look deeper at the database\', \'also check upstream services\'...'
            "
            rows="2"
            @keydown.meta.enter="submitFollowUp"
            @keydown.ctrl.enter="submitFollowUp"
          ></textarea>
          <button class="btn btn-primary" @click="submitFollowUp" :disabled="!followUpText.trim() || running">
            {{ isQuestionPending ? 'Reply' : 'Continue investigation' }} →
          </button>
        </div>
      </div>

      <div v-if="errorMsg && !running" class="investigation-error">
        {{ errorMsg }}
        <button class="btn btn-sm" @click="restart">Retry</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import DOMPurify from 'dompurify'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMarkdown(md: string): string {
  let html = escapeHtml(md)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p>\s*<\/p>/g, '')
  html = html.replace(/<p>\s*(<h[123]>)/g, '$1')
  html = html.replace(/(<\/h[123]>)\s*<\/p>/g, '$1')
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'code', 'pre', 'ul', 'li'],
    ALLOWED_ATTR: [],
  })
}
</script>

<style scoped>
.investigation-panel {
  display: flex;
  height: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.investigation-panel.has-sidebar {
  /* sidebar is visible */
}

/* Session sidebar */
.session-sidebar {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid var(--border-default);
  background: var(--bg-raised);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-3) var(--sp-3);
  border-bottom: 1px solid var(--border-default);
}

.sidebar-title {
  font-weight: 600;
  font-size: 13px;
}

.sidebar-new-btn, .sidebar-template-btn {
  width: calc(100% - var(--sp-3) * 2);
  margin: var(--sp-2) var(--sp-3) 0;
  text-align: left;
  background: var(--bg-overlay);
  color: var(--text-primary);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  font-size: 12px;
}
.sidebar-new-btn:hover, .sidebar-template-btn:hover {
  background: var(--bg-surface);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-3);
}

.session-item {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  cursor: pointer;
  position: relative;
  margin-bottom: 2px;
}
.session-item:hover {
  background: var(--bg-overlay);
}
.session-item.active {
  background: var(--amber-dim);
  border: 1px solid var(--amber);
}

.session-item-title {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 20px;
}

.session-item-meta {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.session-status-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: var(--r-pill);
}
.session-status-badge.active { color: var(--ok); background: var(--ok-dim); }
.session-status-badge.completed { color: var(--text-secondary); background: var(--bg-overlay); }
.session-status-badge.paused { color: var(--amber); background: var(--amber-dim); }

.session-archive-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  opacity: 0;
}
.session-item:hover .session-archive-btn {
  opacity: 1;
}
.session-archive-btn:hover {
  color: var(--error);
}

.session-empty {
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  padding: var(--sp-4);
}

/* Main investigation area */
.investigation-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.investigation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-raised);
}

.investigation-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-weight: 600;
  font-size: 14px;
  min-width: 0;
  overflow: hidden;
}

.sidebar-toggle {
  padding: 2px 4px;
  flex-shrink: 0;
}

.investigation-status {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  padding: 2px var(--sp-2);
  background: var(--bg-overlay);
  border-radius: var(--r-pill);
  flex-shrink: 0;
}
.investigation-status.done {
  color: var(--ok);
  background: var(--ok-dim);
}

.investigation-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* Template picker */
.template-picker {
  padding: var(--sp-4);
  border-bottom: 1px solid var(--border-default);
}
.template-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: var(--sp-3);
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--sp-3);
}
.template-card {
  padding: var(--sp-3);
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color 0.15s;
}
.template-card:hover {
  border-color: var(--amber);
}
.template-name {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.template-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

/* Empty state */
.investigation-empty {
  text-align: center;
  padding: var(--sp-8) var(--sp-4);
  color: var(--text-secondary);
  font-size: 13px;
}
.empty-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: center;
  margin-top: var(--sp-3);
}

.investigation-stream {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* Turn cards */
.turn-card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.turn-card + .turn-card {
  border-top: 1px dashed var(--border-default);
  padding-top: var(--sp-4);
}
.turn-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-bottom: var(--sp-1);
}
.turn-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--amber);
  background: var(--amber-dim);
  padding: 2px var(--sp-2);
  border-radius: var(--r-pill);
  flex-shrink: 0;
}
.turn-question {
  font-size: 12px;
  color: var(--text-secondary);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.turn-events {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* Event rows */
.stream-thinking, .stream-tool-call, .stream-tool-result, .stream-summary, .stream-error {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.stream-icon {
  flex-shrink: 0;
  width: var(--sp-6);
  text-align: center;
  font-size: 14px;
  padding-top: 2px;
}

.stream-content {
  flex: 1;
  min-width: 0;
}

/* Thinking */
.thinking-text {
  color: var(--text-secondary);
  font-style: italic;
  line-height: 1.6;
  white-space: pre-wrap;
}
.stream-thinking.live .thinking-text {
  color: var(--text-primary);
}
.cursor {
  animation: blink 1s step-end infinite;
  color: var(--amber);
}
@keyframes blink { 50% { opacity: 0; } }

/* Tool calls */
.tool-badge {
  display: inline-block;
  background: var(--amber-dim);
  color: var(--amber);
  padding: 2px 10px;
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}

.tool-args {
  margin: 6px 0 0;
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-overlay);
  border-radius: var(--r-sm);
  font-size: 11px;
  color: var(--text-secondary);
  overflow-x: auto;
}

/* Tool results */
.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  padding: var(--sp-1) 0;
}
.result-header:hover { color: var(--text-primary); }
.collapse-toggle { font-size: 11px; }

.tool-result-data {
  margin: var(--sp-1) 0 0;
  padding: 10px var(--sp-3);
  background: var(--bg-overlay);
  border-radius: var(--r-sm);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.result-collapsed {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

/* Summary */
.stream-summary {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--sp-3);
}
.summary-kind {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px var(--sp-2);
  border-radius: var(--r-pill);
  margin-bottom: var(--sp-2);
}
.summary-kind.preliminary {
  color: var(--amber);
  background: var(--amber-dim);
  border: 1px solid var(--amber);
}
.summary-kind.final {
  color: var(--ok);
  background: var(--ok-dim);
  border: 1px solid var(--ok);
}
.summary-kind.question {
  color: #6b9fff;
  background: rgba(107, 159, 255, 0.1);
  border: 1px solid #6b9fff;
}
.summary-text {
  line-height: 1.7;
}
.summary-text :deep(h2) {
  font-size: 14px;
  margin: var(--sp-3) 0 var(--sp-1);
  color: var(--text-primary);
}
.summary-text :deep(strong) { color: var(--text-primary); }
.summary-text :deep(code) {
  background: var(--bg-overlay);
  padding: 1px 5px;
  border-radius: var(--r-sm);
  font-size: 12px;
}
.summary-text :deep(ul) {
  margin: var(--sp-1) 0;
  padding-left: 20px;
}

/* Error */
.stream-error .stream-content {
  color: var(--error);
  font-weight: 500;
}

/* LLM-not-configured setup card */
.stream-setup {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  margin: var(--sp-2) 0;
  padding: var(--sp-3) var(--sp-4);
  background: var(--amber-dim);
  border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);
  border-radius: var(--r-md);
}
.stream-setup-icon {
  color: var(--amber);
  flex-shrink: 0;
  margin-top: 1px;
}
.stream-setup-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.stream-setup-text {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}
.stream-setup-text code {
  font-size: 11px;
  padding: 1px 5px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-primary);
}

/* Done */
.stream-done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--border-subtle);
}
.done-label { font-weight: 500; }
.done-sep { opacity: 0.4; }
.done-rounds { }
.done-tokens { display: flex; align-items: center; gap: 3px; }
.token-in { color: #60a5fa; }
.token-out { color: #a78bfa; }
.done-model { font-family: monospace; font-size: 10px; opacity: 0.7; }
.done-cost { color: #34d399; font-weight: 500; }

.session-cost-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary);
  padding: var(--sp-2) var(--sp-4);
  margin: var(--sp-3) 0 0;
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
}
.cost-label { font-weight: 600; color: var(--text-primary); }
.cost-sep { opacity: 0.35; }
.cost-tokens { }
.cost-total { opacity: 0.65; margin-left: 2px; }
.cost-model { font-family: monospace; font-size: 10px; opacity: 0.65; }
.cost-estimate { color: #34d399; font-weight: 600; }

/* Loading */
.stream-loading {
  text-align: center;
  color: var(--text-secondary);
  padding: var(--sp-6);
  font-style: italic;
}

/* Follow-up section */
.followup-section {
  border-top: 1px solid var(--border-default);
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-raised);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.followup-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.followup-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--ok);
}
.followup-label.preliminary {
  color: var(--amber);
}
.followup-label.question {
  color: #6b9fff;
}
.followup-input {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-end;
}
.followup-input textarea {
  flex: 1;
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  font-size: 12px;
  color: var(--text-primary);
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
}
.followup-input textarea:focus {
  outline: none;
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber-glow);
}
.followup-input .btn-primary {
  padding: var(--sp-2) var(--sp-3);
  background: var(--amber);
  color: var(--text-inverse);
  white-space: nowrap;
  flex-shrink: 0;
}
.followup-input .btn-primary:hover:not(:disabled) {
  background: var(--amber-hover);
}

/* Error bar */
.investigation-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px var(--sp-4);
  background: var(--error-dim);
  border-top: 1px solid var(--error);
  color: var(--error);
  font-size: 13px;
}

/* Buttons */
.btn { cursor: pointer; border: none; border-radius: var(--r-sm); padding: var(--sp-1) var(--sp-3); font-size: 12px; }
.btn-sm { padding: 3px 10px; font-size: 11px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { background: var(--error-dim); color: var(--error); }
.btn-danger:hover { background: rgba(229, 88, 79, 0.2); }
.btn-ghost { background: none; color: var(--text-secondary); font-size: 18px; padding: 0 6px; }
.btn-ghost:hover { color: var(--text-primary); }
.btn-primary { background: var(--amber); color: var(--text-inverse); }
</style>
