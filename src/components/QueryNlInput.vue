<script setup lang="ts">
// The query input for SLO filter blocks — a single textbox, two modes:
//   • Filter   — type `field=value status!=ok http_status_code>=500`; parsed
//                live into structured filters as you type.
//   • ✦ English — natural language sent to /api/v1/parse-query (the same
//                endpoint Explore uses) on Enter / the button, returning
//                structured filters. (Free-text remainder is noted since SLOs
//                evaluate structured filters only.)
import { ref, watch, nextTick } from 'vue'
import type { QueryFilter } from '../types'
import { useApi } from '../composables/useApi'
import { authenticatedFetch } from '../composables/authSession'

const props = defineProps<{ placeholder?: string; initial?: QueryFilter[] }>()
const emit = defineEmits<{ apply: [filters: QueryFilter[]] }>()

const api = useApi()
const mode = ref<'expr' | 'english'>('expr')
const text = ref('')
const loading = ref(false)
const note = ref<string | null>(null)

// ── Autocomplete (Filter mode) ──
// Suggests field names while typing a bare token, and values after `field=`.
const FIELDS = ['service_name', 'http_method', 'http_path', 'http_status_code', 'status', 'environment', 'host_name', 'service_version', 'span_name', 'duration_ns']
const inputEl = ref<HTMLInputElement | null>(null)
const acItems = ref<string[]>([])
const acIndex = ref(0)
const acKind = ref<'field' | 'value'>('field')
let acTokenStart = 0
let acTokenEnd = 0
let acFieldOp = '' // the `field<op>` prefix to re-prepend when picking a value
let acDebounce: ReturnType<typeof setTimeout> | undefined

/** The whitespace-delimited token under the caret: [start, end, text]. */
function tokenAtCaret(): [number, number, string] {
  const el = inputEl.value
  const pos = el ? (el.selectionStart ?? text.value.length) : text.value.length
  const s = text.value
  let start = pos
  while (start > 0 && !/\s/.test(s[start - 1]!)) start--
  let end = pos
  while (end < s.length && !/\s/.test(s[end]!)) end++
  return [start, end, s.slice(start, end)]
}

function closeAc() { acItems.value = []; acIndex.value = 0 }
function closeAcSoon() { setTimeout(closeAc, 150) }

function refreshAutocomplete() {
  if (mode.value !== 'expr') { closeAc(); return }
  clearTimeout(acDebounce)
  const [start, end, tok] = tokenAtCaret()
  acTokenStart = start; acTokenEnd = end
  // Does the token already contain an operator? If so → suggest values.
  let opIdx = -1, opSym = ''
  for (const [sym] of OP_TOKENS) {
    const i = tok.indexOf(sym)
    if (i > 0 && (opIdx === -1 || i < opIdx)) { opIdx = i; opSym = sym }
  }
  if (opIdx === -1) {
    // Field-name suggestions (local prefix match).
    acKind.value = 'field'
    const pfx = tok.toLowerCase()
    acItems.value = FIELDS.filter(f => f.startsWith(pfx) && f !== tok).slice(0, 8)
    acIndex.value = 0
  } else {
    // Value suggestions for `field`, prefix = text after the operator.
    const field = tok.slice(0, opIdx)
    const valPfx = tok.slice(opIdx + opSym.length).replace(/^"|"$/g, '')
    acFieldOp = tok.slice(0, opIdx + opSym.length)
    acKind.value = 'value'
    acDebounce = setTimeout(async () => {
      try {
        const results = await api.suggestValues(field, valPfx)
        acItems.value = (results || []).slice(0, 8)
        acIndex.value = 0
      } catch { acItems.value = [] }
    }, 250)
  }
}

function pickAc(item: string) {
  const replacement = acKind.value === 'field'
    ? `${item}=`                                   // start the operator for them
    : `${acFieldOp}${/\s/.test(item) ? `"${item}"` : item}`
  text.value = text.value.slice(0, acTokenStart) + replacement + text.value.slice(acTokenEnd)
  closeAc()
  nextTick(() => {
    const caret = acTokenStart + replacement.length
    inputEl.value?.focus()
    inputEl.value?.setSelectionRange(caret, caret)
    if (acKind.value === 'field') refreshAutocomplete() // immediately offer values
  })
}

// Operators understood by the SLO engine. Multi-char first so `>=` isn't
// mistaken for `>`, etc. Pairs are [symbol typed, op stored].
const OP_TOKENS: [string, string][] = [
  ['!=', '!='], ['>=', '>='], ['<=', '<='], ['=~', 'LIKE'], ['!~', 'NOT LIKE'],
  ['=', '='], ['>', '>'], ['<', '<'], [':', '='],
]
const OP_TO_SYM: Record<string, string> = { '=': '=', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=', 'LIKE': '=~', 'NOT LIKE': '!~' }

function parseExpr(input: string): QueryFilter[] {
  const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) || []
  const out: QueryFilter[] = []
  for (const tok of tokens) {
    for (const [sym, op] of OP_TOKENS) {
      const i = tok.indexOf(sym)
      if (i > 0) {
        const field = tok.slice(0, i)
        const value = tok.slice(i + sym.length).replace(/^"|"$/g, '')
        if (field && value) out.push({ id: crypto.randomUUID(), field, op, value })
        break
      }
    }
  }
  return out
}

/** Client-side rule-based English → filters (mirrors Explore's parser). Used as
 *  the primary result so this works even when no LLM is configured; the LLM
 *  endpoint only enhances it when available. */
function ruleBasedParse(input: string): { filters: QueryFilter[]; confidence: number } {
  const text = input.toLowerCase().trim()
  if (!text) return { filters: [], confidence: 0 }
  const f: QueryFilter[] = []
  const add = (field: string, op: string, value: string) => f.push({ id: crypto.randomUUID(), field, op, value })
  let remaining = text
  let confidence = 0.3
  const STOP = new Set(['the','a','an','this','all','my','logs','log','errors','error','warn','info','debug','that','which','with','have','show','me','i','want','need','find','get','give','where','there','are','is','recent','latest'])
  const servicePatterns = [
    /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]*)\s+service\b/,
    /^([a-z0-9][a-z0-9_-]+)\s+service\b/,
    /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]{2,})\b(?!\s*service)/,
  ]
  for (const pat of servicePatterns) {
    const m = remaining.match(pat)
    if (m?.[1] && !STOP.has(m[1])) { add('service_name', '=', m[1]); remaining = remaining.replace(pat, ' '); confidence += 0.3; break }
  }
  if (/\berrors?\b/.test(remaining)) { add('level', '=', 'error'); remaining = remaining.replace(/\berrors?\b/g, ' '); confidence += 0.2 }
  else if (/\bwarn(?:ing)?s?\b/.test(remaining)) { add('level', '=', 'warn'); remaining = remaining.replace(/\bwarn(?:ing)?s?\b/g, ' '); confidence += 0.2 }
  else if (/\bdebugs?\b/.test(remaining)) { add('level', '=', 'debug'); remaining = remaining.replace(/\bdebugs?\b/g, ' '); confidence += 0.2 }
  if (/\b(?:5xx|server\s+error)\b/.test(remaining)) { add('http_status_code', '>=', '500'); remaining = remaining.replace(/\b(?:5xx|server\s+error)\b/g, ' '); confidence += 0.15 }
  else if (/\b(?:4xx|client\s+error)\b/.test(remaining)) { add('http_status_code', '>=', '400'); remaining = remaining.replace(/\b(?:4xx|client\s+error)\b/g, ' '); confidence += 0.15 }
  else { const s = remaining.match(/\b([1-5]\d{2})\b/); if (s?.[1]) { add('http_status_code', '=', s[1]); remaining = remaining.replace(s[0], ' '); confidence += 0.15 } }
  const env = remaining.match(/\b(production|prod|staging|stage|dev|development)\b/)
  if (env?.[1]) { const r = env[1]; const v = r === 'prod' ? 'production' : r === 'stage' ? 'staging' : r === 'dev' ? 'development' : r; add('environment', '=', v); confidence += 0.1 }
  return { filters: f, confidence: Math.min(confidence, 1) }
}

/** Render existing filters back into an editable expression string. */
function filtersToExpr(filters: QueryFilter[]): string {
  return filters.map(f => {
    const sym = OP_TO_SYM[f.op] ?? '='
    const v = /\s/.test(f.value) ? `"${f.value}"` : f.value
    return `${f.field}${sym}${v}`
  }).join(' ')
}

// Seed the textbox from existing filters once (e.g. when editing an SLO).
let seeded = false
watch(() => props.initial, (init) => {
  if (!seeded && init && init.length && !text.value) {
    text.value = filtersToExpr(init)
    seeded = true
  }
}, { immediate: true })

// Filter mode: keep the structured filters in sync as the user types.
watch(text, (val) => {
  if (mode.value === 'expr') {
    note.value = null
    emit('apply', parseExpr(val))
  }
})
watch(mode, (m) => {
  note.value = null
  if (m === 'expr') emit('apply', parseExpr(text.value))
})

async function onEnterOrButton() {
  if (mode.value === 'expr') {
    emit('apply', parseExpr(text.value)) // already live, but commit on Enter too
    return
  }
  // ✦ English → query. Rule-based parse is the baseline (works with no LLM);
  // the LLM endpoint only replaces it when configured + more confident.
  if (!text.value.trim() || loading.value) return
  loading.value = true
  note.value = null
  try {
    const local = ruleBasedParse(text.value)
    let filters = local.filters
    let confidence = local.confidence
    let leftover = ''
    let source = 'rules'
    try {
      const res = await authenticatedFetch('/api/v1/parse-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text.value }),
      })
      if (res.ok) {
        const data = await res.json()
        const llm: QueryFilter[] = (data.filters ?? []).map((f: { field: string; op: string; value: string | number }) => ({
          id: crypto.randomUUID(), field: f.field, op: f.op, value: String(f.value),
        }))
        // Prefer the LLM only if it actually found filters.
        if (llm.length) { filters = llm; confidence = data.confidence ?? 0.9; leftover = data.search ?? ''; source = 'AI' }
      }
      // Non-OK (e.g. 501 no LLM key) → silently keep the rule-based result.
    } catch { /* network/LLM unavailable → keep rule-based result */ }

    emit('apply', filters)
    if (!filters.length) {
      note.value = 'Couldn’t pull filters from that phrase — try Filter mode (e.g. status=Error).'
    } else {
      note.value = `Applied (${source}): ${filtersToExpr(filters)} · ${Math.round(confidence * 100)}%`
      if (leftover) note.value += ` (free-text “${leftover}” ignored — SLOs match structured filters only)`
    }
  } finally {
    loading.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (acItems.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = (acIndex.value + 1) % acItems.value.length; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); acIndex.value = (acIndex.value - 1 + acItems.value.length) % acItems.value.length; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAc(acItems.value[acIndex.value]!); return }
    if (e.key === 'Escape') { e.preventDefault(); closeAc(); return }
  }
  if (e.key === 'Enter') onEnterOrButton()
}
</script>


<template>
  <div class="qni">
    <div class="qni-modes">
      <button type="button" class="qni-mode" :class="{ active: mode === 'expr' }" @click="mode = 'expr'" title="Filter expression">Filter</button>
      <button type="button" class="qni-mode" :class="{ active: mode === 'english' }" @click="mode = 'english'" title="Natural language search (✦)">✦</button>
    </div>
    <div class="qni-input-wrap">
      <input
        ref="inputEl"
        v-model="text"
        class="qni-input mono"
        :placeholder="mode === 'expr'
          ? (props.placeholder || 'status=Error http_status_code>=500')
          : 'Describe it: failed checkout requests over 500ms'"
        @input="refreshAutocomplete"
        @keydown="onKeydown"
        @click="refreshAutocomplete"
        @blur="closeAcSoon"
      />
      <ul v-if="acItems.length" class="qni-ac">
        <li
          v-for="(item, i) in acItems"
          :key="item"
          class="qni-ac-item"
          :class="{ active: i === acIndex }"
          @mousedown.prevent="pickAc(item)"
          @mouseenter="acIndex = i"
        >
          <span class="qni-ac-text mono">{{ item }}</span>
          <span class="qni-ac-kind">{{ acKind }}</span>
        </li>
      </ul>
    </div>
    <button v-if="mode === 'english'" type="button" class="qni-apply" :disabled="loading" @click="onEnterOrButton">
      {{ loading ? '…' : '✦ Query' }}
    </button>
  </div>
  <div v-if="note" class="qni-note">{{ note }}</div>
</template>

<style scoped>
.qni { display: flex; gap: 6px; align-items: stretch; }
.qni-modes { display: inline-flex; border: 1px solid var(--border-default, #2a2a2a); border-radius: var(--r-sm, 5px); overflow: hidden; }
.qni-mode {
  padding: 0 10px; font-size: 11px; background: var(--bg-surface, #161616);
  color: var(--text-secondary, #999); border: none; cursor: pointer;
}
.qni-mode.active { background: var(--bg-active, #222); color: var(--text-primary, #eee); }
.qni-input-wrap { position: relative; flex: 1; min-width: 0; }
.qni-input {
  width: 100%; box-sizing: border-box; padding: 6px 9px; font-size: 12px;
  background: var(--bg-surface, #161616); color: var(--text-primary, #eee);
  border: 1px solid var(--border-default, #2a2a2a); border-radius: var(--r-sm, 5px);
}
.qni-input:focus { outline: none; border-color: var(--amber, #3b82f6); }
.qni-ac {
  position: absolute; z-index: 30; top: calc(100% + 2px); left: 0; right: 0;
  margin: 0; padding: 4px; list-style: none; max-height: 220px; overflow-y: auto;
  background: var(--bg-elevated, var(--bg-surface, #1a1a1a));
  border: 1px solid var(--border-default, #2a2a2a); border-radius: var(--r-sm, 5px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.qni-ac-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.qni-ac-item.active { background: var(--bg-active, #262626); }
.qni-ac-text { color: var(--text-primary, #eee); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qni-ac-kind { font-size: 10px; color: var(--text-muted, #777); text-transform: uppercase; letter-spacing: 0.04em; }
.qni-apply {
  padding: 0 12px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;
  background: var(--bg-active, #222); color: var(--text-primary, #eee);
  border: 1px solid var(--border-default, #2a2a2a); border-radius: var(--r-sm, 5px);
}
.qni-apply:hover:not(:disabled) { border-color: var(--amber, #3b82f6); }
.qni-apply:disabled { opacity: 0.6; cursor: default; }
.qni-note { font-size: 11px; color: var(--text-secondary, #999); margin-top: 4px; }
</style>
