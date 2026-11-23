<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AutocompleteInput from '../../components/AutocompleteInput.vue'
import DataTable from '../../components/DataTable.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useApi } from '../../composables/useApi'
import { useTenant } from '../../composables/useTenant'
import type { TraceSamplingDraft, TraceSamplingOption, TraceSamplingPolicy, TraceSamplingPreviewResult, TraceSamplingRetention, TraceSamplingRule } from '../../types'

type DraftRule = Omit<TraceSamplingRule, 'keep_percent'> & { id: number; service: string; http_status: string; method: string; route: string; keep_percent: number | '' }

const maxRules = 12
const previewDebounceMs = 180
const optionFields = [
  { key: 'service', label: 'Service', placeholder: 'Any service', maxlength: 96, pattern: '.*\\S.*' },
  { key: 'http_status', label: 'HTTP status', placeholder: 'Any', maxlength: 3, pattern: '[1-5]([0-9]{2}|[xX]{2})' },
  { key: 'method', label: 'Method', placeholder: 'Any', maxlength: 16, pattern: '[a-zA-Z]+' },
  { key: 'route', label: 'Route template', placeholder: 'Any', maxlength: 160, pattern: '/[^?#]*' },
] as const
const scopeOptions: { value: TraceSamplingRule['scope']; label: string }[] = [
  { value: 'any_span', label: 'Any span' },
  { value: 'server_span', label: 'Server spans' },
  { value: 'root_span', label: 'Root span' },
]

const { previewTraceSampling, traceSamplingOptions, getTraceSamplingDraft, saveTraceSamplingDraft } = useApi()
const { activeTenant, activeTenantName } = useTenant()
const windowMinutes = ref<TraceSamplingPolicy['window_minutes']>(60)
const rules = ref<DraftRule[]>([])
const editor = ref<DraftRule | null>(null)
const previewEditor = ref(false)
const showAdditional = ref(false)
const editorForm = ref<HTMLFormElement | null>(null)
const addRuleButton = ref<HTMLButtonElement | null>(null)
const optionRows = ref<TraceSamplingOption[]>([])
const optionsStatus = ref<'idle' | 'loading' | 'error'>('idle')
let nextRuleId = 0
const result = ref<TraceSamplingPreviewResult | null>(null)
const evaluatedDraft = ref<TraceSamplingPolicy | null>(null)
const busy = ref(false)
const queued = ref(false)
const error = ref('')
const loadingDraft = ref(true)
const savingDraft = ref(false)
const retryDraft = ref(0)
const draftLoadError = ref('')
const draftSaveError = ref('')
const savedDraftKey = ref<string | null>(null)
const showSaved = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: { controller: AbortController; key: string } | undefined
let saveRequest: AbortController | undefined

const editingIndex = computed(() => rules.value.findIndex(rule => rule.id === editor.value?.id))
const editorOptions = computed(() => {
  const rule = editor.value
  if (!rule) return null
  const choices = { service: new Set<string>(), http_status: new Set<string>(), method: new Set<string>(), route: new Set<string>() }
  const service = rule.service.trim()
  const method = rule.method.trim().toUpperCase()
  const route = rule.route.trim()
  const status = rule.http_status.trim().toLowerCase()
  for (const row of optionRows.value) {
    if ((rule.scope === 'server_span' && !row.server) || (rule.scope === 'root_span' && !row.root)) continue
    const statusCode = row.http_status ? String(row.http_status) : ''
    const statusClass = statusCode ? `${statusCode[0]}xx` : ''
    const matchesService = !service || service === row.service
    const matchesMethod = !method || method === row.method
    const matchesRoute = !route || route === row.route
    const matchesStatus = !status || status === statusCode || status === statusClass
    // Each picker ignores its own value so it can offer replacements.
    if (matchesMethod && matchesRoute && matchesStatus) choices.service.add(row.service)
    if (matchesService && matchesRoute && matchesStatus && row.method) choices.method.add(row.method)
    if (matchesService && matchesMethod && matchesStatus && row.route) choices.route.add(row.route)
    if (matchesService && matchesMethod && matchesRoute && statusCode) {
      choices.http_status.add(statusClass)
      choices.http_status.add(statusCode)
    }
  }
  return {
    service: [...choices.service], method: [...choices.method], route: [...choices.route], http_status: [...choices.http_status],
  }
})

function serializeRules(candidates: DraftRule[]): TraceSamplingRule[] {
  return candidates.map(rule => ({
    service: rule.service.trim() || undefined,
    scope: rule.scope,
    http_status: rule.http_status.trim().toLowerCase() || undefined,
    method: rule.method.trim().toUpperCase() || undefined,
    route: rule.route.trim() || undefined,
    minimum_root_duration_ms: rule.minimum_root_duration_ms || undefined,
    require_rare_route: rule.require_rare_route || undefined,
    keep_percent: Number(rule.keep_percent),
  }))
}

const draft = computed<TraceSamplingDraft>(() => ({ window_minutes: windowMinutes.value, rules: serializeRules(rules.value) }))
const draftKey = computed(() => JSON.stringify(draft.value))
const dirty = computed(() => savedDraftKey.value !== null && savedDraftKey.value !== draftKey.value)

const previewPolicy = computed<TraceSamplingPolicy>(() => {
  let candidates = draft.value.rules
  if (previewEditor.value && editor.value) {
    const edited = [...rules.value]
    if (editingIndex.value >= 0) edited[editingIndex.value] = editor.value
    else edited.push(editor.value)
    candidates = serializeRules(edited)
  }
  return {
    window_minutes: windowMinutes.value,
    rules: candidates.length ? candidates : undefined,
  }
})
const previewKey = computed(() => JSON.stringify(previewPolicy.value))
const evaluatedKey = computed(() => JSON.stringify(evaluatedDraft.value))
const stale = computed(() => evaluatedDraft.value !== null && previewKey.value !== evaluatedKey.value)
const ruleResults = computed(() => {
  const response = result.value
  return evaluatedDraft.value?.rules?.flatMap((rule, index) => {
    const retention = response?.rule_retention?.[index]
    return retention ? [{ rule, retention }] : []
  }) ?? []
})
const cohorts = computed(() => result.value ? [
  { label: 'Error traces', ...result.value.cohorts.errors },
  { label: 'Slow traces', ...result.value.cohorts.slow },
  { label: 'Rare routes', ...result.value.cohorts.rare_routes },
] : [])
const exclusions = computed(() => {
  if (!result.value) return []
  const coverage = result.value.coverage
  return [
    { label: 'incomplete', count: coverage.incomplete_traces },
    { label: 'crossed the window boundary', count: coverage.boundary_traces },
    { label: 'hit the per-trace span limit', count: coverage.span_capped_traces },
  ].filter(({ count }) => count > 0)
})

const number = new Intl.NumberFormat()
const percentage = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const utcDate = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
})

function retained({ total, kept }: TraceSamplingRetention) {
  return total > 0 ? percentage.format(kept / total) : '—'
}

async function openRuleEditor(rule?: DraftRule) {
  if (savedDraftKey.value === null || editor.value || (!rule && rules.value.length >= maxRules)) return
  editor.value = rule ? { ...rule } : { id: nextRuleId++, service: '', scope: 'any_span', http_status: '', method: '', route: '', keep_percent: 100 }
  showAdditional.value = !!(rule?.minimum_root_duration_ms || rule?.require_rare_route)
  await nextTick()
  editorForm.value?.querySelector('input')?.focus()
}

async function closeRuleEditor() {
  editor.value = null
  previewEditor.value = false
  await nextTick()
  addRuleButton.value?.focus()
}

function saveRule() {
  if (!editor.value) return
  if (editingIndex.value >= 0) rules.value.splice(editingIndex.value, 1, editor.value)
  else rules.value.push(editor.value)
  void closeRuleEditor()
}

function scrollKeepPercent(event: WheelEvent) {
  const input = event.currentTarget as HTMLInputElement
  if (!editor.value || !input.matches(':focus') || !event.deltaY || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  const percent = Number.isFinite(input.valueAsNumber) ? Math.round(input.valueAsNumber) : 0
  const next = Math.max(0, Math.min(100, percent - Math.sign(event.deltaY)))
  if (editor.value.keep_percent === next) return
  editor.value.keep_percent = next
  previewEditor.value = true
}

function moveRule(index: number, direction: -1 | 1) {
  const next = index + direction
  const rule = rules.value[index]
  if (!rule || next < 0 || next >= rules.value.length) return
  rules.value.splice(index, 1)
  rules.value.splice(next, 0, rule)
}

function describeRule(rule: Omit<TraceSamplingRule, 'keep_percent'>) {
  return [
    rule.scope !== 'any_span' && scopeOptions.find(scope => scope.value === rule.scope)?.label,
    rule.method?.toUpperCase(),
    rule.route,
    rule.http_status && `HTTP ${rule.http_status.toLowerCase()}`,
    rule.minimum_root_duration_ms && `Root span ≥ ${number.format(rule.minimum_root_duration_ms)} ms`,
    rule.require_rare_route && 'Rare route',
  ].filter(Boolean).join(' · ')
}

function ruleTitle(rule: Omit<TraceSamplingRule, 'keep_percent'>) {
  return rule.service?.trim() || (describeRule(rule) ? 'Any service' : 'All traces')
}

function stopPreview() {
  clearTimeout(previewTimer)
  queued.value = false
  inFlight?.controller.abort()
  inFlight = undefined
  busy.value = false
}

function reset() {
  stopPreview()
  previewEditor.value = false
  result.value = null
  evaluatedDraft.value = null
  error.value = ''
}

async function persistDraft() {
  if (!dirty.value || editor.value || savingDraft.value) return
  const snapshot = draft.value
  const key = draftKey.value
  const tenant = activeTenant.value
  const request = new AbortController()
  saveRequest = request
  savingDraft.value = true
  draftSaveError.value = ''
  try {
    await saveTraceSamplingDraft(snapshot, request.signal)
    if (request.signal.aborted || activeTenant.value !== tenant) return
    savedDraftKey.value = key
    showSaved.value = true
  } catch (failure) {
    if (request.signal.aborted || activeTenant.value !== tenant) return
    draftSaveError.value = failure instanceof Error ? failure.message : 'Could not save sampling rules.'
  } finally {
    if (saveRequest === request) {
      savingDraft.value = false
      saveRequest = undefined
    }
  }
}

async function runPreview() {
  if (inFlight?.key === previewKey.value) return
  stopPreview()
  if (previewEditor.value && !editorForm.value?.reportValidity()) return
  const request = { controller: new AbortController(), key: previewKey.value }
  inFlight = request
  const signal = request.controller.signal
  const policy = previewPolicy.value
  const tenant = activeTenant.value
  busy.value = true
  error.value = ''
  try {
    const response = await previewTraceSampling(policy, signal)
    if (signal.aborted || tenant !== activeTenant.value) return
    result.value = response
    evaluatedDraft.value = policy
  } catch (failure) {
    if (signal.aborted || tenant !== activeTenant.value) return
    error.value = failure instanceof Error ? failure.message : 'Trace sampling preview failed.'
  } finally {
    if (inFlight === request) {
      busy.value = false
      inFlight = undefined
    }
  }
}

watch([activeTenant, retryDraft], async ([tenant], _, onCleanup) => {
  reset()
  saveRequest?.abort()
  saveRequest = undefined
  savingDraft.value = false
  savedDraftKey.value = null
  showSaved.value = false
  editor.value = null
  rules.value = []
  windowMinutes.value = 60
  loadingDraft.value = true
  draftLoadError.value = ''
  draftSaveError.value = ''
  const request = new AbortController()
  onCleanup(() => request.abort())
  try {
    const saved = await getTraceSamplingDraft(request.signal)
    if (request.signal.aborted || activeTenant.value !== tenant) return
    rules.value = saved.rules.map(rule => ({
      ...rule, id: nextRuleId++, service: rule.service ?? '', http_status: rule.http_status ?? '',
      method: rule.method ?? '', route: rule.route ?? '',
    }))
    windowMinutes.value = saved.window_minutes
    savedDraftKey.value = draftKey.value
  } catch {
    if (!request.signal.aborted) draftLoadError.value = 'Could not load saved sampling rules.'
  } finally {
    if (!request.signal.aborted) loadingDraft.value = false
  }
}, { immediate: true })
watch([previewKey, previewEditor, activeTenant], ([key, live, tenant], [, wasLive, previousTenant]) => {
  if (tenant !== previousTenant || (!live && !wasLive) || inFlight?.key === key) return
  stopPreview()
  error.value = ''
  if (key === evaluatedKey.value || (live && !editorForm.value?.checkValidity())) return
  queued.value = true
  previewTimer = setTimeout(() => void runPreview(), previewDebounceMs)
}, { flush: 'post' })
watch([activeTenant, windowMinutes, () => !!editor.value || rules.value.length > 0], async ([, window, needsOptions], _, onCleanup) => {
  optionRows.value = []
  optionsStatus.value = 'idle'
  if (!needsOptions) return
  const request = new AbortController()
  onCleanup(() => request.abort())
  optionsStatus.value = 'loading'
  try {
    const rows = await traceSamplingOptions(window, request.signal)
    if (request.signal.aborted) return
    optionRows.value = rows
    optionsStatus.value = 'idle'
  } catch {
    if (!request.signal.aborted) optionsStatus.value = 'error'
  }
})
onBeforeUnmount(() => {
  stopPreview()
  saveRequest?.abort()
})
</script>

<template>
  <div class="sampling-preview card">
    <section class="sampling-draft" aria-label="Trace sampling draft">
      <div class="sampling-heading">
        <h2>Current rules</h2>
        <span class="sampling-badge">Dry run</span>
      </div>
      <p class="sampling-note">The first matching rule wins. Unmatched traces are kept.</p>
      <ol v-if="rules.length" class="sampling-current-rules" aria-label="Current draft rules">
        <li v-for="(rule, index) in rules" :key="rule.id" :class="{ 'sampling-rule-editing': editor?.id === rule.id }">
          <div class="sampling-rule-title">
            <strong class="sampling-rule-result"><span class="sampling-rule-order">{{ index + 1 }}.</span> {{ ruleTitle(rule) }}</strong>
            <span class="sampling-rule-percent">Keep {{ rule.keep_percent }}%</span>
          </div>
          <p v-if="describeRule(rule)" class="sampling-note sampling-rule-description">{{ describeRule(rule) }}</p>
          <div class="sampling-rule-actions">
            <button type="button" class="sampling-rule-button" :aria-label="`Move rule ${index + 1} up`" :disabled="index === 0" @click="moveRule(index, -1)">↑</button>
            <button type="button" class="sampling-rule-button" :aria-label="`Move rule ${index + 1} down`" :disabled="index === rules.length - 1" @click="moveRule(index, 1)">↓</button>
            <button type="button" class="sampling-rule-button" :aria-label="`Edit rule ${index + 1}`" :disabled="!!editor" @click="openRuleEditor(rule)">Edit</button>
            <button type="button" class="sampling-rule-button" :aria-label="`Remove rule ${index + 1}`" :disabled="editor?.id === rule.id" @click="rules.splice(index, 1)">Remove</button>
          </div>
        </li>
      </ol>
      <p v-else-if="savedDraftKey !== null" class="sampling-note">No rules in this draft.</p>
      <p v-if="loadingDraft" class="sampling-note" role="status">Loading saved rules…</p>
      <div v-if="draftLoadError" class="sampling-draft-actions">
        <p class="sampling-note" role="alert">{{ draftLoadError }}</p>
        <button type="button" class="sampling-rule-button" @click="retryDraft++">Retry</button>
      </div>

      <div v-if="!editor" class="sampling-draft-actions">
        <button ref="addRuleButton" type="button" class="sampling-rule-button" :disabled="savedDraftKey === null || rules.length >= maxRules" @click="openRuleEditor()">Add a rule</button>
        <span v-if="rules.length >= maxRules" class="sampling-note">A draft can contain up to {{ maxRules }} rules.</span>
      </div>

      <form v-else ref="editorForm" class="sampling-rule-editor" aria-labelledby="sampling-rule-editor-heading" @submit.prevent="saveRule">
        <h3 id="sampling-rule-editor-heading">{{ editingIndex < 0 ? 'Add a rule' : `Edit rule ${editingIndex + 1}` }}</h3>
        <p class="sampling-note">Service, status, method, and route must match the same span.</p>
        <div class="sampling-rule-fields">
          <label class="sampling-field">
            Match on
            <select v-model="editor.scope">
              <option v-for="scope in scopeOptions" :key="scope.value" :value="scope.value">{{ scope.label }}</option>
            </select>
          </label>
          <div v-for="field in optionFields" :key="field.key" class="sampling-field">
            <label :for="`sampling-editor-${field.key}`">{{ field.label }}</label>
            <AutocompleteInput
              :id="`sampling-editor-${field.key}`"
              v-model="editor[field.key]"
              :options="editorOptions?.[field.key] ?? []"
              :empty-option="field.key !== 'service' ? 'Any' : undefined"
              :placeholder="field.placeholder"
              :maxlength="field.maxlength"
              :pattern="field.pattern"
            />
          </div>
        </div>
        <details class="sampling-conditions" :open="showAdditional">
          <summary>Duration and route frequency</summary>
          <div class="sampling-condition-fields">
            <label class="sampling-field">
              Minimum root span duration (ms)
              <input v-model.number="editor.minimum_root_duration_ms" type="number" min="1" max="3600000" step="1" placeholder="Any duration">
            </label>
            <label class="sampling-check">
              <input v-model="editor.require_rare_route" type="checkbox" aria-describedby="sampling-rare-rule"> Rare routes only
            </label>
            <p id="sampling-rare-rule" class="sampling-note">
              A root route is rare when fewer than {{ result?.rare_route_threshold ?? 10 }} complete traces share its service, method, and route template in the sample.
            </p>
          </div>
        </details>
        <p v-if="!editor.service.trim() && !describeRule(editor)" class="sampling-note">With no conditions, this rule matches all traces.</p>
        <p v-if="optionsStatus !== 'idle' || !optionRows.length" class="sampling-note" role="status">
          {{ optionsStatus === 'loading' ? 'Loading suggestions from recent spans…'
            : optionsStatus === 'error' ? 'Suggestions are unavailable.'
              : 'No spans found for suggestions in this window.' }}
        </p>
        <div class="sampling-keep sampling-field">
          <label for="sampling-keep-percent">Keep (%)</label>
          <div class="sampling-keep-controls">
            <input
              v-model.number="editor.keep_percent" type="range" min="0" max="100" step="1"
              aria-label="Keep percentage slider" @input="previewEditor = true"
            >
            <input
              id="sampling-keep-percent" v-model.number="editor.keep_percent"
              type="number" min="0" max="100" step="1" required
              @input="previewEditor = true" @wheel="scrollKeepPercent"
            >
          </div>
        </div>
        <div class="sampling-draft-actions">
          <button type="submit" class="sampling-rule-button sampling-rule-submit">
            {{ editingIndex < 0 ? 'Add to draft' : 'Update draft rule' }}
          </button>
          <button type="button" class="sampling-rule-button" @click="closeRuleEditor">Cancel</button>
        </div>
      </form>

      <div class="sampling-preview-controls">
        <label class="sampling-field">
          Sample window
          <select v-model.number="windowMinutes" :disabled="savedDraftKey === null">
            <option :value="15">Last 15 minutes</option>
            <option :value="60">Last hour</option>
          </select>
        </label>
        <button class="sampling-run" type="button" :disabled="busy || savedDraftKey === null" @click="runPreview">
          {{ busy ? 'Running preview…' : 'Run preview' }}
        </button>
        <p class="sampling-note">Preview decisions never affect live ingestion.</p>
      </div>
      <div class="sampling-draft-actions sampling-persistence">
        <button type="button" class="sampling-rule-button" :disabled="!dirty || savingDraft || !!editor" @click="persistDraft">
          {{ savingDraft ? 'Saving rules…' : 'Save rules' }}
        </button>
        <p v-if="dirty && editor" class="sampling-note">Finish editing the open rule to save.</p>
        <p v-else-if="dirty && !savingDraft" class="sampling-note" role="status">Unsaved changes</p>
        <p v-else-if="showSaved && !savingDraft" class="sampling-note" role="status">Saved for {{ activeTenantName }}</p>
      </div>
      <p v-if="draftSaveError" class="sampling-error" role="alert">{{ draftSaveError }}</p>
    </section>

    <section class="sampling-results" aria-labelledby="sampling-results-heading">
      <div class="sampling-heading">
        <h2 id="sampling-results-heading">Projected retention</h2>
        <span class="sampling-tenant" :title="activeTenantName">{{ activeTenantName }}</span>
      </div>
      <p v-if="error" class="sampling-error" role="alert">{{ error }}</p>
      <p v-if="previewEditor" class="sampling-note">The preview includes the rule you’re editing.</p>
      <p v-if="result && (queued || busy)" class="sampling-note" role="status">Updating preview…</p>
      <p v-else-if="stale && !error" class="sampling-stale" role="status">
        {{ previewEditor ? 'Finish editing valid rule values to update the preview.' : 'Draft changed. Run the preview to update results.' }}
      </p>
      <template v-if="result">
        <p class="sampling-range">{{ utcDate.formatRange(new Date(result.from), new Date(result.to)) }} UTC</p>
        <div class="sampling-total" role="status" aria-atomic="true">
          <template v-if="result.retention.total">
            <strong>{{ retained(result.retention) }}</strong>
            <div class="sampling-total-copy">
              <span class="sampling-total-label">Overall sample retention</span>
              <span>{{ number.format(result.retention.kept) }} of {{ number.format(result.retention.total) }} complete traces would be kept</span>
            </div>
          </template>
          <strong v-else class="sampling-no-traces">No complete traces in this sample</strong>
        </div>

        <div class="sampling-coverage" :class="{ limited: result.coverage.discovery_capped || result.coverage.trace_sample_capped || exclusions.length }">
          <strong>
            {{ number.format(result.retention.total) }} of {{ number.format(result.coverage.sampled_traces) }} sampled traces complete
            · {{ result.coverage.observed_minutes }}/{{ result.window_minutes }} minutes with sampled spans
          </strong>
          <p v-if="exclusions.length">
            Excluded
            <template v-for="(exclusion, index) in exclusions" :key="exclusion.label">
              {{ index ? ' · ' : '' }}{{ number.format(exclusion.count) }} {{ exclusion.label }}
            </template>
          </p>
          <p v-if="result.coverage.discovery_capped || result.coverage.trace_sample_capped">
            Sampling limit reached. Results cover a subset of the selected window.
          </p>
          <p>
            Checked {{ number.format(result.coverage.scanned_spans) }} spans to find candidate traces.
            The window ends at least {{ result.settling_seconds / 60 }} minutes ago to give spans time to arrive.
          </p>
          <p>Complete means the stored spans form one connected tree within the window.</p>
        </div>

        <DataTable v-if="ruleResults.length" bare class="sampling-table">
          <caption class="sampling-sr-only">Projected retention by rule</caption>
          <thead>
            <tr>
              <th scope="col">First matching rule</th>
              <th scope="col" class="sampling-numeric">Target keep</th>
              <th scope="col" class="sampling-numeric">Kept / matched</th>
              <th scope="col" class="sampling-numeric">Sample retained</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="({ rule, retention }, index) in ruleResults" :key="index">
              <td>
                <strong class="sampling-rule-result">{{ index + 1 }}. {{ ruleTitle(rule) }}</strong>
                <span v-if="describeRule(rule)" class="sampling-note sampling-route-service">{{ describeRule(rule) }}</span>
              </td>
              <td class="sampling-numeric">{{ percentage.format(rule.keep_percent / 100) }}</td>
              <td class="sampling-numeric">{{ number.format(retention.kept) }} / {{ number.format(retention.total) }}</td>
              <td class="sampling-numeric">{{ retained(retention) }}</td>
            </tr>
            <tr>
              <td>Unmatched traces</td>
              <td class="sampling-numeric">100%</td>
              <td class="sampling-numeric">{{ number.format(result.fallback_retention.kept) }} / {{ number.format(result.fallback_retention.total) }}</td>
              <td class="sampling-numeric">{{ retained(result.fallback_retention) }}</td>
            </tr>
          </tbody>
        </DataTable>
        <p v-if="ruleResults.length" class="sampling-note">
          Each rule’s target applies to its matched traces. Small samples can land above or below that target. The overall rate includes unmatched traces, which are kept.
        </p>

        <DataTable v-if="result.retention.total" bare class="sampling-table">
          <caption class="sampling-sr-only">Projected trace retention by cohort</caption>
          <thead>
            <tr><th scope="col">Trace cohort</th><th scope="col" class="sampling-numeric">Kept / complete</th><th scope="col" class="sampling-numeric">Sample retained</th></tr>
          </thead>
          <tbody>
            <tr v-for="cohort in cohorts" :key="cohort.label">
              <td>{{ cohort.label }}</td>
              <td class="sampling-numeric">{{ number.format(cohort.kept) }} / {{ number.format(cohort.total) }}</td>
              <td class="sampling-numeric">
                <span class="sampling-percent">
                  <span v-if="cohort.total" class="sampling-bar" aria-hidden="true">
                    <span :style="{ width: `${100 * cohort.kept / cohort.total}%` }" />
                  </span>
                  {{ retained(cohort) }}
                </span>
              </td>
            </tr>
          </tbody>
        </DataTable>
        <p v-if="result.retention.total" class="sampling-note">Cohorts can overlap. Each trace counts once in the overall result.</p>

        <details v-if="result.retention.total" class="sampling-route-details" open>
          <summary>
            Rare route decisions
            <span v-if="result.rare_routes_zero_kept" class="sampling-risk">{{ number.format(result.rare_routes_zero_kept) }} with zero kept</span>
          </summary>
          <p v-if="!result.rare_route_count" class="sampling-note">No rare route templates observed in this sample.</p>
          <p v-if="result.coverage.traces_without_route" class="sampling-note">
            Complete traces without a usable root route template · {{ number.format(result.coverage.traces_without_route) }}
          </p>
          <DataTable v-if="result.rare_routes.length" bare class="sampling-table sampling-routes-table">
            <caption class="sampling-sr-only">Projected retention for observed rare routes</caption>
            <thead><tr><th scope="col">Route</th><th scope="col" class="sampling-numeric">Kept / complete</th></tr></thead>
            <tbody>
              <tr v-for="route in result.rare_routes" :key="JSON.stringify([route.service, route.method, route.route])">
                <td>
                  <strong class="sampling-route-name">{{ route.method }} {{ route.route }}</strong>
                  <span class="sampling-note sampling-route-service">{{ route.service }}</span>
                </td>
                <td class="sampling-numeric">{{ number.format(route.retention.kept) }} / {{ number.format(route.retention.total) }}</td>
              </tr>
            </tbody>
          </DataTable>
          <p v-if="result.rare_route_count > result.rare_routes.length" class="sampling-note">
            Showing {{ result.rare_routes.length }} of {{ number.format(result.rare_route_count) }} rare routes.
          </p>
        </details>
      </template>

      <EmptyState
        v-else-if="!error"
        :title="busy || queued ? 'Reading stored traces' : 'No preview yet'"
        :description="busy || queued ? undefined : 'Run a preview to see what this draft would keep.'"
        :tone="busy || queued ? 'loading' : 'neutral'"
      />
    </section>
  </div>
</template>

<style scoped>
.sampling-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr);
  overflow: hidden;
  container-type: inline-size;
}
.sampling-draft, .sampling-results { min-width: 0; padding: var(--sp-5); }
.sampling-draft {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: var(--sp-3);
  background: var(--bg-raised);
  border-inline-end: 1px solid var(--border-default);
}
.sampling-rule-editor {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  padding: var(--sp-3);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
}
.sampling-rule-editor h3 { margin: 0; color: var(--text-primary); font-size: var(--text-md); }
.sampling-draft-actions, .sampling-rule-actions { display: flex; flex-wrap: wrap; gap: var(--sp-1); align-items: center; }
.sampling-draft-actions { gap: var(--sp-2); }
.sampling-persistence { padding-top: var(--sp-3); border-top: 1px solid var(--border-subtle); }
.sampling-rule-actions { margin-top: var(--sp-2); }
.sampling-rule-button {
  min-width: 28px;
  min-height: 28px;
  padding-inline: var(--sp-2);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.sampling-rule-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-hover); }
.sampling-rule-button:disabled { opacity: 0.45; cursor: default; }
.sampling-rule-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
.sampling-rule-submit { color: var(--accent-hover); border-color: var(--accent-muted); background: var(--accent-soft); }
.sampling-rule-result, .sampling-rule-description { display: block; overflow-wrap: anywhere; }
.sampling-rule-result { color: var(--text-primary); }
.sampling-current-rules { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border-default); }
.sampling-current-rules li { padding: var(--sp-2); border-bottom: 1px solid var(--border-default); }
.sampling-current-rules .sampling-rule-editing { background: var(--accent-soft); }
.sampling-rule-title { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); font-size: var(--text-sm); }
.sampling-rule-order, .sampling-rule-percent { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.sampling-rule-percent { white-space: nowrap; }
.sampling-conditions {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.sampling-conditions summary { cursor: pointer; }
.sampling-condition-fields { display: grid; gap: var(--sp-2); margin-top: var(--sp-2); }
.sampling-keep { padding-top: var(--sp-3); border-top: 1px solid var(--border-subtle); }
.sampling-keep-controls { display: grid; grid-template-columns: minmax(0, 1fr) 68px; gap: var(--sp-3); align-items: center; }
.sampling-keep-controls input[type='range'] { margin: 0; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
.sampling-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  min-width: 0;
}
.sampling-heading h2 { margin: 0; color: var(--text-primary); font-size: var(--text-md); }
.sampling-badge, .sampling-tenant {
  padding: 3px var(--sp-2);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.sampling-tenant { max-width: 42%; overflow: hidden; text-overflow: ellipsis; }
.sampling-field { display: grid; gap: var(--sp-1); color: var(--text-primary); font-size: var(--text-sm); font-weight: 600; }
.sampling-field :is(select, input), .sampling-field :deep(.ac-input) {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  font-weight: 400;
}
.sampling-preview-controls > .sampling-field { flex: 1 1 130px; }
.sampling-check { display: flex; gap: var(--sp-2); align-items: center; font-size: var(--text-sm); cursor: pointer; }
.sampling-check input { margin: 0; accent-color: var(--accent); }
.sampling-preview-controls { display: flex; flex-wrap: wrap; align-items: end; gap: var(--sp-2) var(--sp-3); padding-top: var(--sp-3); border-top: 1px solid var(--border-subtle); }
.sampling-preview-controls p { flex-basis: 100%; }
.sampling-run {
  min-height: 36px;
  padding-inline: var(--sp-3);
  border: 1px solid var(--accent);
  border-radius: var(--r-sm);
  background: var(--accent);
  color: var(--text-inverse);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 650;
  cursor: pointer;
}
.sampling-run:hover:not(:disabled) { background: var(--accent-hover); }
.sampling-run:disabled { opacity: 0.65; cursor: wait; }
.sampling-note, .sampling-range {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.sampling-results { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: var(--sp-3); }
.sampling-range { font-variant-numeric: tabular-nums; }
.sampling-total { display: flex; gap: var(--sp-2) var(--sp-3); flex-wrap: wrap; align-items: baseline; color: var(--text-secondary); font-size: var(--text-sm); }
.sampling-total strong { color: var(--text-primary); font-size: 36px; line-height: 1.05; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.sampling-total .sampling-no-traces { font-size: var(--text-md); letter-spacing: normal; }
.sampling-total-copy { display: grid; gap: var(--sp-1); }
.sampling-total-label { color: var(--text-primary); font-weight: 650; }
.sampling-coverage, .sampling-error, .sampling-stale {
  padding: var(--sp-2) var(--sp-3);
  margin: 0;
  border-radius: var(--r-sm);
  border-inline-start: 2px solid var(--accent);
  background: var(--accent-soft);
  font-size: var(--text-xs);
  line-height: 1.55;
}
.sampling-coverage p { margin: 2px 0 0; }
.sampling-coverage.limited, .sampling-stale { border-color: var(--warning); background: var(--warning-dim); }
.sampling-error { border-color: var(--error); background: var(--error-dim); }
.sampling-table { position: relative; }
.sampling-table :deep(.data-table) { min-width: 0; }
.sampling-table :deep(th), .sampling-table :deep(td) { padding: var(--sp-2); white-space: normal; }
.sampling-table :deep(.sampling-numeric) { text-align: end; font-variant-numeric: tabular-nums; }
.sampling-percent { display: inline-flex; width: 100%; align-items: center; justify-content: flex-end; gap: var(--sp-2); }
.sampling-bar { display: inline-flex; width: clamp(25px, 6cqi, 72px); height: 4px; border-radius: 2px; background: var(--border-default); }
.sampling-bar > span { border-radius: inherit; background: var(--accent); }
.sampling-route-details { padding-block: var(--sp-2); border-block: 1px solid var(--border-default); }
.sampling-route-details summary { cursor: pointer; font-size: var(--text-sm); font-weight: 650; }
.sampling-route-details .sampling-note, .sampling-routes-table { margin-top: var(--sp-2); }
.sampling-risk { margin-inline-start: var(--sp-1); padding: 2px var(--sp-1); background: var(--warning-dim); color: var(--text-primary); font-size: var(--text-xs); font-weight: 500; }
.sampling-route-name { display: block; overflow-wrap: anywhere; font-family: var(--font-mono); font-weight: 500; }
.sampling-route-service { display: block; overflow-wrap: anywhere; }
.sampling-sr-only { position: absolute; inset-inline-start: 0; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@media (max-width: 960px) {
  .sampling-preview { grid-template-columns: minmax(0, 1fr); }
  .sampling-draft { border-inline-end: 0; border-bottom: 1px solid var(--border-default); }
}
@media (max-width: 480px) {
  .sampling-draft, .sampling-results { padding: var(--sp-3); }
  .sampling-bar { display: none; }
}
</style>
