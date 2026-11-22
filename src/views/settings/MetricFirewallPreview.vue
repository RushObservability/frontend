<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DataTable from '../../components/DataTable.vue'
import { useApi } from '../../composables/useApi'
import { useTenant } from '../../composables/useTenant'
import type {
  MetricFirewallInput,
  MetricFirewallOutcome,
  MetricFirewallPreviewResult,
  MetricFirewallSample,
} from '../../types'

const props = defineProps<{
  draft: MetricFirewallInput
  ruleId: string | null
  canTest: boolean
  policyChanged: boolean
}>()
const emit = defineEmits<{ revision: [value: string | null]; testing: [value: boolean] }>()
const api = useApi()
const { activeTenant } = useTenant()

const examples = [
  { metric_name: 'http_requests_total', service_name: 'payments', labels: { route: '/charge', pod_uid: 'p-15' } },
  { metric_name: 'http_requests_total', service_name: 'payments', labels: { route: '/charge', pod_uid: 'p-47' } },
  { metric_name: 'http_requests_total', service_name: 'payments', labels: { route: '/refund', pod_uid: 'p-15' } },
  { metric_name: 'http_requests_total', service_name: 'orders', labels: { route: '/orders', pod_uid: 'o-31' } },
  { metric_name: 'http_requests_total', service_name: 'gateway', labels: { route: '/health' } },
  { metric_name: 'process_cpu_seconds_total', service_name: 'payments', labels: { pod_uid: 'p-15' } },
]
const exampleText = JSON.stringify(examples, null, 2)
const sampleText = ref(exampleText)
const result = ref<MetricFirewallPreviewResult | null>(null)
const stale = ref(false)
const loading = ref(false)
const error = ref('')
let request: AbortController | undefined
watch(loading, value => emit('testing', value), { flush: 'sync' })

function invalidateResult() {
  request?.abort()
  request = undefined
  loading.value = false
  stale.value = result.value !== null
  error.value = ''
  emit('revision', null)
}

watch([() => props.draft, sampleText, activeTenant], invalidateResult)
watch(() => props.policyChanged, changed => {
  if (changed) invalidateResult()
})
onBeforeUnmount(() => request?.abort())

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSample(value: unknown): value is MetricFirewallSample {
  return isRecord(value)
    && typeof value.metric_name === 'string' && !!value.metric_name.trim()
    && (value.service_name === undefined || typeof value.service_name === 'string')
    && (value.labels === undefined || (
      isRecord(value.labels) && Object.values(value.labels).every(label => typeof label === 'string')
    ))
}

async function testRule() {
  if (!props.canTest || loading.value) return
  error.value = ''
  if (new TextEncoder().encode(sampleText.value).length > 128 * 1024) {
    error.value = 'Sample input must be smaller than 128 KiB.'
    return
  }
  let samples: unknown
  try {
    samples = JSON.parse(sampleText.value)
  } catch {
    error.value = 'Paste a JSON array of sample series.'
    return
  }
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 100 || !samples.every(isSample)) {
    error.value = 'Provide 1 to 100 series with a metric name and string label values.'
    return
  }
  const controller = new AbortController()
  request = controller
  loading.value = true
  try {
    const preview = await api.previewMetricFirewall(props.draft, props.ruleId, samples, controller.signal)
    if (controller.signal.aborted) return
    result.value = preview
    stale.value = false
    emit('revision', preview.policy_revision)
  } catch (cause: unknown) {
    if (controller.signal.aborted) return
    const status = (cause as { status?: number })?.status
    error.value = status === 400 || status === 413 || status === 422
      ? 'Query API could not evaluate this rule or sample. Check the fields and sample size.'
      : 'Could not test the rule. Try again or reload the firewall settings.'
  } finally {
    if (request === controller) {
      request = undefined
      loading.value = false
    }
  }
}

function formatLabels(labels: Record<string, string> = {}): string {
  return Object.entries(labels).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')
}

function collisionKey(identity: Record<string, string>): string {
  const { __name__: metricName, ...labels } = identity
  return `${metricName}{${formatLabels(labels)}}`
}

const previewRows = computed(() => result.value?.rows.map(row => ({
  ...row,
  outcomes: [row.current, row.proposed].map((outcome: MetricFirewallOutcome) => {
    const labels = outcome.labels
    return {
      ...outcome,
      removed: labels === null ? [] : Object.keys(row.input.labels ?? {}).filter(key => !Object.hasOwn(labels, key)),
    }
  }),
})) ?? [])
const newCollisions = computed(() => result.value?.collisions.filter(collision => collision.introduced).length ?? 0)
</script>

<template>
  <section class="fw-test-panel" aria-label="Test firewall rule">
    <header class="fw-test-header">
      <div>
        <h3>Sample preview</h3>
        <p>Firewall rules apply to every tenant. Testing a draft leaves active rules in effect.</p>
      </div>
      <button type="button" class="fw-test-button fw-test-run" :disabled="!canTest || loading" @click="testRule">
        {{ loading ? 'Testing…' : 'Test rule' }}
      </button>
    </header>

    <details class="fw-test-sample">
      <summary>
        Sample input
        <span>{{ sampleText === exampleText ? '6 example series' : 'Pasted series' }}</span>
      </summary>
      <div class="fw-test-sample-fields">
        <label for="fw-sample-input">
          Paste up to 100 pre-firewall series. Each needs <code>metric_name</code> and can include
          <code>service_name</code> and a <code>labels</code> object.
        </label>
        <textarea id="fw-sample-input" v-model="sampleText" class="form-input mono" rows="8" spellcheck="false" />
        <button type="button" class="fw-test-button" @click="sampleText = exampleText">Load example sample</button>
      </div>
    </details>

    <p v-if="error" class="fw-test-error" role="alert">{{ error }}</p>
    <p v-if="stale" class="fw-test-feedback" role="status">Test the draft again to refresh the sample results.</p>
    <p v-else-if="!result && !error" class="fw-test-feedback">
      {{ canTest ? 'Test the draft to compare its effect with the current rules.' : 'Complete the rule fields to test the draft.' }}
    </p>

    <template v-if="result && !stale">
      <dl class="fw-test-stats" aria-live="polite">
        <div><dt>Sampled</dt><dd>{{ result.sampled }}</dd></div>
        <div><dt>Changed</dt><dd>{{ result.changed }}</dd></div>
        <div><dt>Blocked</dt><dd>{{ result.blocked }}</dd></div>
        <div><dt>Output series</dt><dd>{{ result.output_identities }}</dd></div>
      </dl>
      <p v-if="result.duplicates" class="fw-test-feedback">
        Duplicate sample entries skipped ({{ result.duplicates }}).
      </p>
      <section v-if="result.collisions.length" class="fw-test-collisions" aria-label="Series collisions">
        <p>
          <strong>{{ newCollisions }} new collision {{ newCollisions === 1 ? 'group' : 'groups' }}</strong>
        </p>
        <ul>
          <li v-for="collision in result.collisions" :key="collision.id">
            <span>Group {{ collision.id }} · {{ collision.series_count }} inputs {{ collision.introduced ? 'would share' : 'already share' }} one output</span>
            <code>{{ collisionKey(collision.identity) }}</code>
          </li>
        </ul>
      </section>

      <DataTable bare class="fw-test-table">
        <thead>
          <tr><th scope="col">Input series</th><th scope="col">Current rules</th><th scope="col">With draft</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in previewRows" :key="index" :class="{ 'fw-test-collision-row': row.collision_id !== null }">
            <td>
              <strong class="mono">{{ row.input.metric_name }}</strong>
              <small v-if="row.input.service_name">{{ row.input.service_name }}</small>
              <code v-if="row.input.labels">{{ formatLabels(row.input.labels) }}</code>
            </td>
            <td v-for="(outcome, column) in row.outcomes" :key="column">
              <strong v-if="column === 1 && row.collision_id" class="fw-test-collision-text">
                Collision {{ row.collision_id }}
              </strong>
              <strong v-else-if="outcome.labels === null" class="fw-test-error">Blocked</strong>
              <strong v-else>Kept</strong>
              <small v-if="outcome.removed.length">
                Stripped <code>{{ outcome.removed.join(', ') }}</code>
              </small>
              <small v-if="outcome.matched_rules.length">{{ outcome.matched_rules.join(', ') }}</small>
            </td>
          </tr>
        </tbody>
      </DataTable>
    </template>
  </section>
</template>

<style scoped>
.fw-test-panel { padding: var(--sp-4); min-width: 0; }
.fw-test-header { display: flex; gap: var(--sp-3); flex-wrap: wrap; align-items: flex-start; justify-content: space-between; }
.fw-test-header div { flex: 1 1 200px; }
.fw-test-header h3 { color: var(--text-primary); font-size: var(--text-md); margin: 0; }
.fw-test-header p, .fw-test-feedback { color: var(--text-secondary); font-size: var(--text-sm); line-height: 1.5; }
.fw-test-header p { margin: var(--sp-1) 0 0; }
.fw-test-button {
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
}
.fw-test-run { color: var(--accent); background: var(--accent-soft); }
.fw-test-button:hover:not(:disabled) { border-color: var(--accent); }
.fw-test-button:disabled { opacity: .5; cursor: not-allowed; }
.fw-test-feedback { margin: var(--sp-3) 0 0; }
.fw-test-sample { margin-top: var(--sp-4); border-block: 1px solid var(--border-default); }
.fw-test-sample summary { cursor: pointer; padding: var(--sp-2) 0; font-size: var(--text-sm); }
.fw-test-sample summary span { color: var(--text-secondary); margin-inline-start: var(--sp-2); }
.fw-test-sample-fields { display: grid; gap: var(--sp-2); padding-bottom: var(--sp-3); justify-items: start; }
.fw-test-sample-fields label { color: var(--text-secondary); font-size: var(--text-sm); }
.fw-test-sample-fields textarea { resize: vertical; width: 100%; }
.fw-test-error { color: var(--error); font-size: var(--text-sm); }
.fw-test-stats { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); margin: var(--sp-4) 0; }
.fw-test-stats div { display: inline-flex; gap: var(--sp-1); align-items: baseline; }
.fw-test-stats dt { color: var(--text-secondary); font-size: var(--text-sm); order: 1; }
.fw-test-stats dd { margin: 0; color: var(--text-primary); font-size: var(--text-sm); font-variant-numeric: tabular-nums; font-weight: 600; }
.fw-test-collisions { margin-bottom: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-radius: var(--r-sm); background: var(--warning-dim); }
.fw-test-collisions p { margin: 0; color: var(--text-primary); font-size: var(--text-sm); }
.fw-test-collisions ul { display: grid; gap: var(--sp-2); padding: 0; margin: var(--sp-1) 0 0; list-style: none; }
.fw-test-collisions li { font-size: var(--text-sm); color: var(--text-secondary); }
.fw-test-collisions code { display: block; overflow-wrap: anywhere; }
.fw-test-collision-text { color: var(--text-primary); }
.fw-test-table :deep(.data-table) { min-width: 0; table-layout: fixed; }
.fw-test-table :deep(th) { white-space: normal; }
.fw-test-table :deep(th:first-child) { width: 47%; }
.fw-test-table :deep(td) { padding-block: var(--sp-2); white-space: normal; overflow-wrap: anywhere; vertical-align: top; }
.fw-test-table :deep(.fw-test-collision-row td) { background-color: var(--warning-dim); }
.fw-test-table td > code, .fw-test-table small { display: block; margin-top: var(--sp-1); color: var(--text-secondary); font-size: inherit; }
</style>
